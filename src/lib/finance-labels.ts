import type { BudgetKind, BudgetStatus, Currency, SponsorStatus } from '@prisma/client'

export const SPONSOR_STATUS_ORDER: SponsorStatus[] = [
  'PROSPECT', 'CONTACTED', 'NEGOTIATING', 'SIGNED', 'DECLINED',
]

const sponsorStatusLabels: Record<SponsorStatus, string> = {
  PROSPECT: 'Aday',
  CONTACTED: 'İletişime geçildi',
  NEGOTIATING: 'Görüşülüyor',
  SIGNED: 'Anlaşıldı',
  DECLINED: 'Olumsuz',
}

export const CURRENCY_ORDER: Currency[] = ['TRY', 'USD', 'EUR']

const currencySymbols: Record<Currency, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
}

export const BUDGET_KIND_ORDER: BudgetKind[] = ['INCOME', 'EXPENSE']

const budgetKindLabels: Record<BudgetKind, string> = {
  INCOME: 'Gelir',
  EXPENSE: 'Gider',
}

export const BUDGET_STATUS_ORDER: BudgetStatus[] = ['PLANNED', 'COMMITTED', 'PAID']

const budgetStatusLabels: Record<BudgetStatus, string> = {
  PLANNED: 'Planlandı',
  COMMITTED: 'Taahhüt edildi',
  PAID: 'Ödendi',
}

export function describeSponsorStatus(status: SponsorStatus): string {
  return sponsorStatusLabels[status]
}

export function describeBudgetKind(kind: BudgetKind): string {
  return budgetKindLabels[kind]
}

export function describeBudgetStatus(status: BudgetStatus): string {
  return budgetStatusLabels[status]
}

/**
 * Tutarlar her yerde dize olarak taşınır (Decimal serileşmez, float
 * kuruşları bozar), bu yüzden biçimlendirme de dize üzerinden yapılır.
 */
export function formatAmount(amount: string | null, currency: Currency): string {
  if (amount === null) return '—'
  const value = Number(amount)
  if (!Number.isFinite(value)) return `${amount} ${currencySymbols[currency]}`
  return `${value.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currencySymbols[currency]}`
}
