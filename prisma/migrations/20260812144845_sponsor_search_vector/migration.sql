-- Sponsor için full-text arama: generated tsvector + GIN index.
-- Document/Task/Event ile aynı desen; ayrı bir migration olması bilinçli
-- (uygulanmış bir migration'ı sonradan düzenlemek checksum'ı bozar).
ALTER TABLE "Sponsor"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('turkish', coalesce("name", '') || ' ' || coalesce("notes", ''))
  ) STORED;

CREATE INDEX "Sponsor_searchVector_idx" ON "Sponsor" USING GIN ("searchVector");
