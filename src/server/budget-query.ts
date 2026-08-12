/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe).
 */

import { Prisma, type BudgetKind, type BudgetStatus, type Currency } from '@prisma/client'
import { db } from '@/lib/db'
import { can, type Actor, type Visibility } from '@/lib/auth/policy'

export type BudgetEntryView = {
  id: string
  kind: BudgetKind
  title: string
  amount: string
  currency: Currency
  category: string
  date: Date
  status: BudgetStatus
  channel: { id: string; name: string }
  event: { id: string; title: string } | null
  sponsor: { id: string; name: string } | null
  receipt: { id: string; fileName: string } | null
}

const entrySelect = {
  id: true,
  kind: true,
  title: true,
  amount: true,
  currency: true,
  category: true,
  date: true,
  status: true,
  receiptAttachmentId: true,
  channel: { select: { id: true, name: true } },
  event: { select: { id: true, title: true } },
  sponsor: { select: { id: true, name: true } },
} satisfies Prisma.BudgetEntrySelect

type EntryRow = Prisma.BudgetEntryGetPayload<{ select: typeof entrySelect }>

function toView(row: EntryRow, receipts: Map<string, string>): BudgetEntryView {
  const { receiptAttachmentId, ...rest } = row
  const fileName = receiptAttachmentId ? receipts.get(receiptAttachmentId) : undefined
  return {
    ...rest,
    // Decimal istemci bileşenlerine geçirilemez; dizeye çevrilir.
    amount: row.amount.toString(),
    receipt:
      receiptAttachmentId && fileName ? { id: receiptAttachmentId, fileName } : null,
  }
}

/**
 * Fiş eki `Attachment` tablosunda polimorfik olarak durur (FK yok), bu
 * yüzden isimler ayrı bir toplu sorguyla çözülür — satır başına sorgu
 * atmamak için tek `IN` sorgusu.
 */
async function loadReceiptNames(rows: EntryRow[]): Promise<Map<string, string>> {
  const ids = rows.map((row) => row.receiptAttachmentId).filter((id): id is string => id !== null)
  if (ids.length === 0) return new Map()
  const attachments = await db.attachment.findMany({
    where: { id: { in: ids } },
    select: { id: true, fileName: true },
  })
  return new Map(attachments.map((a) => [a.id, a.fileName]))
}

/**
 * Bütçeyi görebildiği kanallar: admin hepsini, diğerleri yalnızca LEAD
 * olduklarını. `can(actor, 'budget:read', …)` dallarının sorgu karşılığı —
 * kanal üyeliği (MEMBER) yetmez.
 */
export function budgetChannelIds(actor: Actor): string[] | 'all' {
  if (actor.globalRole === 'ADMIN') return 'all'
  return actor.memberships.filter((m) => m.channelRole === 'LEAD').map((m) => m.channelId)
}

export async function listBudgetEntries(
  actor: Actor,
  filters: { channelId?: string; eventId?: string; category?: string } = {},
): Promise<BudgetEntryView[]> {
  const scope = budgetChannelIds(actor)
  if (scope !== 'all' && scope.length === 0) return []

  const rows = await db.budgetEntry.findMany({
    where: {
      archivedAt: null,
      channel: { archivedAt: null },
      ...(scope === 'all' ? {} : { channelId: { in: scope } }),
      ...(filters.channelId ? { channelId: filters.channelId } : {}),
      ...(filters.eventId ? { eventId: filters.eventId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    },
    select: entrySelect,
    orderBy: [{ date: 'desc' }],
  })
  const receipts = await loadReceiptNames(rows)
  return rows.map((row) => toView(row, receipts))
}

/**
 * Kategori serbest metin girildiği için sabit bir liste yok; filtre
 * seçenekleri kullanıcının GÖREBİLDİĞİ kalemlerden türetilir — aksi halde
 * yetkisiz bir kanalın kategori adları sızardı.
 */
export async function listBudgetCategories(actor: Actor): Promise<string[]> {
  const scope = budgetChannelIds(actor)
  if (scope !== 'all' && scope.length === 0) return []

  const rows = await db.budgetEntry.findMany({
    where: {
      archivedAt: null,
      ...(scope === 'all' ? {} : { channelId: { in: scope } }),
    },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  })
  return rows.map((row) => row.category)
}

export type BudgetSummary = {
  currency: Currency
  income: string
  expense: string
  balance: string
}

/**
 * Özet PARA BİRİMİ BAŞINA hesaplanır. Farklı birimleri tek bakiyede
 * toplamak kur bilgisi olmadan anlamsız bir sayı üretirdi; kulüp
 * çoğunlukla TRY kullanıyor ama USD/EUR sponsorluk mümkün.
 *
 * Toplama Decimal ile yapılır — Number'a düşmek kuruş hatası biriktirir.
 */
export async function summarizeBudget(
  actor: Actor,
  filters: { channelId?: string; eventId?: string } = {},
): Promise<BudgetSummary[]> {
  const entries = await listBudgetEntries(actor, filters)
  const byCurrency = new Map<Currency, { income: Prisma.Decimal; expense: Prisma.Decimal }>()

  for (const entry of entries) {
    const current = byCurrency.get(entry.currency) ?? {
      income: new Prisma.Decimal(0),
      expense: new Prisma.Decimal(0),
    }
    const amount = new Prisma.Decimal(entry.amount)
    if (entry.kind === 'INCOME') current.income = current.income.plus(amount)
    else current.expense = current.expense.plus(amount)
    byCurrency.set(entry.currency, current)
  }

  return [...byCurrency.entries()].map(([currency, totals]) => ({
    currency,
    income: totals.income.toFixed(2),
    expense: totals.expense.toFixed(2),
    balance: totals.income.minus(totals.expense).toFixed(2),
  }))
}

export type BudgetEntryContext = {
  entry: { id: string; channelId: string; archivedAt: Date | null }
  resource: {
    kind: 'budget'
    channelId: string
    channelVisibility: Visibility
    channelArchivedAt: Date | null
  }
}

export async function loadBudgetEntryContext(
  entryId: string,
): Promise<BudgetEntryContext | null> {
  const entry = await db.budgetEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true, channelId: true, archivedAt: true,
      channel: { select: { visibility: true, archivedAt: true } },
    },
  })
  if (!entry) return null
  return {
    entry: { id: entry.id, channelId: entry.channelId, archivedAt: entry.archivedAt },
    resource: {
      kind: 'budget',
      channelId: entry.channelId,
      channelVisibility: entry.channel.visibility,
      channelArchivedAt: entry.channel.archivedAt,
    },
  }
}

export async function canReadBudgetOfChannel(actor: Actor, channelId: string): Promise<boolean> {
  const channel = await db.channel.findUnique({ where: { id: channelId } })
  if (!channel) return false
  return can(actor, 'budget:read', {
    kind: 'budget',
    channelId: channel.id,
    channelVisibility: channel.visibility,
    channelArchivedAt: channel.archivedAt,
  })
}
