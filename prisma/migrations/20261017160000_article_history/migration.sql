CREATE TABLE "ArticleVersion" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "content" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "showViewCount" BOOLEAN NOT NULL DEFAULT true,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ArticleVersion_bytes_check" CHECK ("bytes" >= 0),
    CONSTRAINT "ArticleVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("internalId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ArticleVersion_articleId_version_key" ON "ArticleVersion"("articleId", "version");
CREATE INDEX "ArticleVersion_articleId_createdAt_idx" ON "ArticleVersion"("articleId", "createdAt");
