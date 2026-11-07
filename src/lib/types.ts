export type DocumentMark = { type: string; attrs?: Record<string, unknown> };
export type DocumentNode = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: DocumentMark[];
  content?: DocumentNode[];
};
export type EditorDocument = DocumentNode & { type: "doc"; content: DocumentNode[] };

export type PublicArticle = {
  id: string;
  title: string;
  content: EditorDocument;
  html: string;
  schemaVersion: 1;
  version: number;
  createdAt: string;
  updatedAt: string;
  showViewCount: boolean;
  viewCount?: number;
  readingMinutes: number;
};

export type ArticleMutation = {
  title: string;
  content: EditorDocument;
  schemaVersion: 1;
  showViewCount?: boolean;
  markdown?: string;
  version?: number;
};

export type ApiError = { error: { code: string; message: string } };

export type ArticleRevision = {
  version: number;
  title: string;
  content: EditorDocument;
  schemaVersion: 1;
  showViewCount: boolean;
  createdAt: string;
};
export type ArticleRevisionSummary = Pick<ArticleRevision, "version" | "title" | "createdAt">;
