/**
 * Ay görünümü için saf takvim yardımcıları. Harici takvim kütüphanesi
 * kullanılmaz (plan kararı) — ihtiyaç duyulan tek şey haftaya bölünmüş
 * gün ızgarası.
 */

export type MonthKey = { year: number; month: number } // month: 1-12

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/

export function parseMonthKey(value: string | undefined, today: Date = new Date()): MonthKey {
  const match = value ? MONTH_PATTERN.exec(value) : null
  if (!match) return { year: today.getFullYear(), month: today.getMonth() + 1 }
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return { year: today.getFullYear(), month: today.getMonth() + 1 }
  return { year, month }
}

export function formatMonthKey({ year, month }: MonthKey): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function shiftMonth({ year, month }: MonthKey, delta: number): MonthKey {
  const zeroBased = month - 1 + delta
  return {
    year: year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  }
}

export function monthRange(key: MonthKey): { from: Date; to: Date } {
  return {
    from: new Date(key.year, key.month - 1, 1),
    to: new Date(key.year, key.month, 1),
  }
}

/**
 * Ayı, pazartesiyle başlayan tam haftalara böler. Izgara her zaman
 * eksiksiz haftalardan oluşur; komşu ayların günleri de yer alır.
 */
export function monthGrid(key: MonthKey): Date[][] {
  const first = new Date(key.year, key.month - 1, 1)
  // getDay(): 0 = Pazar. Pazartesi başlangıcı için kaydırılır.
  const offset = (first.getDay() + 6) % 7
  const start = new Date(key.year, key.month - 1, 1 - offset)

  const weeks: Date[][] = []
  const cursor = new Date(start)
  while (true) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    const exceededMonth = cursor.getMonth() !== key.month - 1 && cursor > first
    if (exceededMonth && weeks.length >= 4) break
    if (weeks.length === 6) break
  }
  return weeks
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const

export function describeMonth({ year, month }: MonthKey): string {
  return new Date(year, month - 1, 1).toLocaleDateString('tr-TR', {
    month: 'long',
    year: 'numeric',
  })
}
