-- Existing media URLs and still-image rows remain valid.
ALTER TABLE "Media"
  ADD COLUMN "animated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "frames" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "posterKey" VARCHAR(128);
