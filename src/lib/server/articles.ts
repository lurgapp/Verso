import { Prisma, type Article } from "@prisma/client";
import { z } from "zod";
import { MAX_DOCUMENT_TEXT, validateDocument } from "../document";
import { readingMinutes } from "../article-stats";
import type { EditorDocument, PublicArticle } from "../types";
import { db } from "./db";
import { HttpError, requirePublicId } from "./http";
import { renderDocument } from "./render";
import { hashEditKey, newEditKey, newPublicId, verifyEditKey } from "./security";

export const MAX_ARTICLE_JSON_BYTES = 2 * 1024 * 1024;

const mutationSchema = z.object({
  title: z.string().trim().min(1).max(240).refine((value) => !/[\u0000]/u.test(value)),
  content: z.unknown(),
  schemaVersion: z.literal(1),
  markdown: z.string().max(MAX_DOCUMENT_TEXT).optional(),
  showViewCount: z.boolean().optional(),
  version: z.number().int().min(1).max(2_000_000_000).optional(),
}).strict();

export function parseArticleMutation(input: unknown, update = false) {
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success || (update && !parsed.data.version)) throw new HttpError(400, "INVALID_INPUT", update ? "Provide a title, document, schemaVersion 1 and the current publication version." : "Provide a title, document and schemaVersion 1.");
  const content = validateDocument(parsed.data.content);
  return { title: parsed.data.title, content, html: renderDocument(content), schemaVersion: 1 as const, version: parsed.data.version, showViewCount: parsed.data.showViewCount };
}

export function publicArticle(article: Article): PublicArticle {
  return { id: article.publicId, title: article.title, content: article.content as EditorDocument, html: renderDocument(article.content as EditorDocument), schemaVersion: 1, version: article.version, createdAt: article.createdAt.toISOString(), updatedAt: article.updatedAt.toISOString(), showViewCount: article.showViewCount !== false, ...(article.showViewCount === false ? {} : { viewCount: article.viewCount ?? 0 }), readingMinutes: readingMinutes(article.content as EditorDocument) };
}

export async function getPublicArticle(id: string): Promise<PublicArticle | null> {
  if (!/^[A-Za-z0-9]{12}$/u.test(id)) return null;
  const article = await db.article.findFirst({ where: { publicId: id, status: "PUBLISHED" } });
  return article ? publicArticle(article) : null;
}

export async function getArticleRecord(id: string): Promise<Article> {
  requirePublicId(id);
  const article = await db.article.findFirst({ where: { publicId: id, status: "PUBLISHED" } });
  if (!article) throw new HttpError(404, "NOT_FOUND", "This article could not be found.");
  return article;
}

export function requireOwner(article: Pick<Article, "editKeyHash">, key: string | null): void {
  if (!verifyEditKey(key, article.editKeyHash)) throw new HttpError(401, "UNAUTHORIZED", "A valid editing key is required.");
}

export async function createWithUniqueId<T>(insert: (id: string) => Promise<T>, generate: () => string = newPublicId): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return await insert(generate()); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002" || !String(error.meta?.target).includes("publicId")) throw error;
    }
  }
  throw new HttpError(503, "UNAVAILABLE", "Please try publishing again.");
}

export async function createArticle(input: unknown): Promise<{ article: PublicArticle; editKey: string }> {
  const document = parseArticleMutation(input);
  const editKey = newEditKey();
  const article = await createWithUniqueId((id) => db.article.create({ data: { publicId: id, title: document.title, content: document.content as Prisma.InputJsonValue, html: document.html, schemaVersion: 1, showViewCount: document.showViewCount ?? true, editKeyHash: hashEditKey(editKey) } }));
  return { article: publicArticle(article), editKey };
}

export const MAX_ARTICLE_VERSIONS = 50;
export const MAX_ARTICLE_HISTORY_BYTES = 16 * 1024 * 1024;
export const ARTICLE_HISTORY_DAYS = 90;

async function retainHistory(tx: Prisma.TransactionClient, articleId: string): Promise<void> {
  const versions = await tx.articleVersion.findMany({ where: { articleId }, orderBy: { version: "desc" }, select: { id: true, bytes: true, createdAt: true } });
  const cutoff = Date.now() - ARTICLE_HISTORY_DAYS * 86400_000;
  let bytes = 0;
  const remove: string[] = [];
  versions.forEach((entry, index) => {
    bytes += entry.bytes;
    if (index >= MAX_ARTICLE_VERSIONS || bytes > MAX_ARTICLE_HISTORY_BYTES || entry.createdAt.getTime() < cutoff) remove.push(entry.id);
  });
  if (remove.length) await tx.articleVersion.deleteMany({ where: { id: { in: remove }, articleId } });
}

export async function updateArticle(id: string, key: string | null, input: unknown): Promise<PublicArticle> {
  requirePublicId(id);
  requireOwner(await getArticleRecord(id), key);
  const mutation = parseArticleMutation(input, true);
  const updated = await db.$transaction(async (tx) => {
    const article = await tx.article.findFirst({ where: { publicId: id, status: "PUBLISHED" } });
    if (!article) throw new HttpError(404, "NOT_FOUND", "This article could not be found.");
    requireOwner(article, key);
    const changes = await tx.article.updateMany({ where: { internalId: article.internalId, status: "PUBLISHED", version: mutation.version }, data: { title: mutation.title, content: mutation.content as Prisma.InputJsonValue, html: mutation.html, ...(mutation.showViewCount === undefined ? {} : { showViewCount: mutation.showViewCount }), version: { increment: 1 } } });
    if (!changes.count) throw new HttpError(409, "VERSION_CONFLICT", "This article changed in another tab. Reload it before saving.");
    // Snapshot and update commit together; a stale writer cannot create a phantom revision.
    await tx.articleVersion.create({ data: { articleId: article.internalId, version: article.version, title: article.title, content: article.content as Prisma.InputJsonValue, schemaVersion: article.schemaVersion, showViewCount: article.showViewCount, bytes: Buffer.byteLength(JSON.stringify(article.content), "utf8") + Buffer.byteLength(article.title, "utf8") } });
    await retainHistory(tx, article.internalId);
    return tx.article.findUniqueOrThrow({ where: { internalId: article.internalId } });
  });
  return publicArticle(updated);
}

export async function listArticleHistory(id: string, key: string | null) {
  const article = await getArticleRecord(id);
  requireOwner(article, key);
  const versions = await db.articleVersion.findMany({ where: { articleId: article.internalId }, orderBy: { version: "desc" }, take: MAX_ARTICLE_VERSIONS, select: { version: true, title: true, createdAt: true } });
  return versions.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }));
}

export async function getArticleRevision(id: string, key: string | null, version: number) {
  const article = await getArticleRecord(id);
  requireOwner(article, key);
  if (!Number.isInteger(version) || version < 1 || version > 2_000_000_000) throw new HttpError(404, "NOT_FOUND", "This version could not be found.");
  const entry = await db.articleVersion.findUnique({ where: { articleId_version: { articleId: article.internalId, version } } });
  if (!entry) throw new HttpError(404, "NOT_FOUND", "This version could not be found.");
  return { version: entry.version, title: entry.title, content: validateDocument(entry.content), schemaVersion: 1 as const, showViewCount: entry.showViewCount, createdAt: entry.createdAt.toISOString() };
}

export async function restoreArticleVersion(id: string, key: string | null, version: number, input: unknown): Promise<PublicArticle> {
  const parsed = z.object({ version: z.number().int().min(1).max(2_000_000_000) }).strict().safeParse(input);
  if (!parsed.success) throw new HttpError(400, "INVALID_INPUT", "Provide the current publication version before restoring.");
  const revision = await getArticleRevision(id, key, version);
  return updateArticle(id, key, { title: revision.title, content: revision.content, schemaVersion: 1, showViewCount: revision.showViewCount, version: parsed.data.version });
}

export async function deleteArticle(id: string, key: string | null): Promise<void> {
  const article = await getArticleRecord(id);
  requireOwner(article, key);
  await db.$transaction(async (tx) => {
    // Keep the public ID reserved; private snapshots are erased with article content.
    await tx.article.updateMany({ where: { internalId: article.internalId, status: "PUBLISHED" }, data: { status: "DELETED", title: "", content: {}, html: "", editKeyHash: "0".repeat(64), version: { increment: 1 } } });
    await tx.articleVersion.deleteMany({ where: { articleId: article.internalId } });
  });
}
