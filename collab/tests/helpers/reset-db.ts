import type { PrismaClient } from '../../generated/prisma/client.js'

/**
 * Kök `tests/helpers/reset-db.ts` ile aynı teknik, collab paketinin kendi
 * Prisma istemcisiyle: bütün tabloları TEK bir ifadede boşaltır.
 *
 * Elle yazılmış silme sırası bilerek kullanılmaz — bu dosya tam olarak o
 * yüzden var: eski liste kök şemaya yeni tablolar (Task, Event, Sponsor…)
 * eklendikçe eskimişti ve collab testleri `Task_channelId_fkey` ihlaliyle
 * kırılıyordu. Veri değiştiren CTE'ler tek ifade olduğu için foreign key
 * kontrolleri sonda yapılır, sıra önemsizleşir.
 */
export async function resetCollabDb(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `
  const tables = rows.map((row) => `"public"."${row.tablename}"`)
  const last = tables.pop()
  if (!last) return
  const ctes = tables.map((table, index) => `d${index} AS (DELETE FROM ${table})`)
  await db.$executeRawUnsafe(`WITH ${ctes.join(', ')} DELETE FROM ${last}`)
}
