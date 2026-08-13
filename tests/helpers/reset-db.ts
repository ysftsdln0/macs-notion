import { db } from '@/lib/db'

/**
 * Test veritabanındaki (bkz. `test-database-url.ts` — geliştirme
 * veritabanı DEĞİL) bütün tabloları boşaltır.
 *
 * Elle yazılmış bir `deleteMany()` sırası yerine TRUNCATE ... CASCADE
 * kullanılır: sıra bakımı gerektiren bir listeydi ve her yeni tablo
 * (Task, Event, Sponsor, BudgetEntry, Attachment…) unutulduğunda ilgisiz
 * testler foreign key ihlaliyle kırılıyordu. CASCADE bağımlılıkları kendi
 * çözer, dolayısıyla yeni bir model eklerken burada yapılacak bir şey yok.
 *
 * Tablo listesi süreç başına BİR KEZ okunur (her testte katalog sorgusu
 * atmak takımı gözle görülür yavaşlatıyordu); `_prisma_migrations`
 * dışarıda bırakılır — silinirse Prisma şemayı uygulanmamış sayar.
 */
let truncateStatement: Promise<string> | null = null

function loadTruncateStatement(): Promise<string> {
  truncateStatement ??= db
    .$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
    .then((rows) => {
      const tables = rows.map((row) => `"public"."${row.tablename}"`)
      const last = tables.pop()
      if (!last) return 'SELECT 1'
      // TEK ifade: veri değiştiren CTE'ler aynı ifadenin parçası olduğu
      // için foreign key kontrolleri ifadenin SONUNDA yapılır — silme
      // sırasının doğru olması gerekmez. TRUNCATE de sıradan bağımsızdır
      // ama her tabloyu dosya seviyesinde kısaltıp ACCESS EXCLUSIVE kilidi
      // aldığı için test başına ~45 ms ekliyordu (takımda ~14 sn).
      const ctes = tables.map((table, index) => `d${index} AS (DELETE FROM ${table})`)
      return `WITH ${ctes.join(', ')} DELETE FROM ${last}`
    })
  return truncateStatement
}

export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(await loadTruncateStatement())
}
