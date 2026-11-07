CREATE TYPE "ArticleStatus" AS ENUM ('PUBLISHED', 'DELETED', 'MODERATED');
CREATE TABLE "Article" (
  "internalId" UUID NOT NULL,
  "publicId" VARCHAR(12) NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "content" JSONB NOT NULL,
  "html" TEXT NOT NULL,
  "format" VARCHAR(32) NOT NULL DEFAULT 'tiptap-json',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "editKeyHash" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ArticleStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Article_pkey" PRIMARY KEY ("internalId")
);
CREATE UNIQUE INDEX "Article_publicId_key" ON "Article"("publicId");
CREATE INDEX "Article_status_createdAt_idx" ON "Article"("status", "createdAt");
CREATE TABLE "Media" (
  "id" VARCHAR(64) NOT NULL,
  "objectKey" VARCHAR(128) NOT NULL,
  "mimeType" VARCHAR(64) NOT NULL,
  "bytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Media_objectKey_key" ON "Media"("objectKey");
CREATE TABLE "Report" (
  "id" UUID NOT NULL,
  "articleId" UUID NOT NULL,
  "reason" VARCHAR(32) NOT NULL,
  "details" VARCHAR(2000),
  "reporterDigest" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");
CREATE INDEX "Report_articleId_idx" ON "Report"("articleId");
ALTER TABLE "Report" ADD CONSTRAINT "Report_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("internalId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "RateLimit" (
  "key" VARCHAR(96) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
