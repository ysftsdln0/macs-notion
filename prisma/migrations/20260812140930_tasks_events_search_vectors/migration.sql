-- Task ve Event için full-text arama: generated tsvector + GIN index.
--
-- Prisma generated column'ları tanımaz (şemada @ignore ile de tanımlanamaz),
-- bu yüzden bu kolonlar elle yazılan raw SQL ile gelir — Document tablosunda
-- da aynı desen kullanıldı (20260812122616_documents_comments_notifications).
--
-- Ayrı bir migration olması bilinçli: tsvector eklerini önceki migration'ın
-- sonuna eklemek, o migration UYGULANDIKTAN SONRA dosyayı değiştirmek olurdu
-- ve Prisma checksum uyuşmazlığı yüzünden sonraki her `migrate dev`'i
-- kırardı.
ALTER TABLE "Task"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('turkish', coalesce("title", '') || ' ' || coalesce("notes", ''))
  ) STORED;

CREATE INDEX "Task_searchVector_idx" ON "Task" USING GIN ("searchVector");

ALTER TABLE "Event"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('turkish', coalesce("title", '') || ' ' || coalesce("description", ''))
  ) STORED;

CREATE INDEX "Event_searchVector_idx" ON "Event" USING GIN ("searchVector");
