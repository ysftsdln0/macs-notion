import { describe, expect, it } from 'vitest'
import {
  formatMonthKey, isSameDay, monthGrid, monthRange, parseMonthKey, shiftMonth,
} from '@/lib/calendar'

describe('parseMonthKey', () => {
  const today = new Date(2026, 7, 12) // 12 Ağustos 2026

  it('geçerli anahtarı ayrıştırır', () => {
    expect(parseMonthKey('2026-03', today)).toEqual({ year: 2026, month: 3 })
  })

  it('bozuk ya da eksik girdide bugünün ayına döner', () => {
    expect(parseMonthKey(undefined, today)).toEqual({ year: 2026, month: 8 })
    expect(parseMonthKey('abc', today)).toEqual({ year: 2026, month: 8 })
    expect(parseMonthKey('2026-13', today)).toEqual({ year: 2026, month: 8 })
    expect(parseMonthKey('2026-00', today)).toEqual({ year: 2026, month: 8 })
  })
})

describe('shiftMonth', () => {
  it('yıl sınırını doğru geçer', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 })
  })
})

describe('monthRange', () => {
  it('ayın ilk gününden bir sonraki ayın ilk gününe kadar', () => {
    const { from, to } = monthRange({ year: 2026, month: 2 })
    expect(formatMonthKey({ year: from.getFullYear(), month: from.getMonth() + 1 })).toBe('2026-02')
    expect(from.getDate()).toBe(1)
    expect(to.getMonth()).toBe(2)
    expect(to.getDate()).toBe(1)
  })
})

describe('monthGrid', () => {
  it('tam haftalardan oluşur ve pazartesiyle başlar', () => {
    for (const key of [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 8 },
      { year: 2024, month: 2 }, // artık yıl
    ]) {
      const weeks = monthGrid(key)
      expect(weeks.length).toBeGreaterThanOrEqual(4)
      expect(weeks.length).toBeLessThanOrEqual(6)
      for (const week of weeks) {
        expect(week).toHaveLength(7)
        expect(week[0]?.getDay()).toBe(1) // Pazartesi
      }
    }
  })

  it('ayın her gününü tam bir kez içerir', () => {
    const key = { year: 2026, month: 8 }
    const days = monthGrid(key)
      .flat()
      .filter((d) => d.getMonth() === key.month - 1)
      .map((d) => d.getDate())
    expect(days).toEqual([...Array(31).keys()].map((i) => i + 1))
  })
})

describe('isSameDay', () => {
  it('saat farkını yok sayar, tarih farkını yakalar', () => {
    expect(isSameDay(new Date(2026, 7, 12, 9), new Date(2026, 7, 12, 23))).toBe(true)
    expect(isSameDay(new Date(2026, 7, 12), new Date(2026, 7, 13))).toBe(false)
    expect(isSameDay(new Date(2026, 7, 12), new Date(2025, 7, 12))).toBe(false)
  })
})
