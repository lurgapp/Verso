ALTER TABLE "Article" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "showViewCount" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Article" ADD CONSTRAINT "Article_viewCount_nonnegative" CHECK ("viewCount" >= 0);
