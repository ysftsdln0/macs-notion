import { describe, expect, it } from 'vitest'
import { FIRST_RANK, rankBetween, rebalanceRanks } from '@/lib/rank'

describe('rankBetween', () => {
  it('boş liste için aralığın ortasından bir anahtar verir', () => {
    expect(FIRST_RANK.length).toBeGreaterThan(0)
    expect(FIRST_RANK).not.toBe('0')
    // Hem öncesine hem sonrasına yer kalmalı.
    expect(rankBetween('', FIRST_RANK) < FIRST_RANK).toBe(true)
    expect(rankBetween(FIRST_RANK, '') > FIRST_RANK).toBe(true)
  })

  it('iki anahtarın arasına yerleşir', () => {
    const mid = rankBetween('1', '2')
    expect(mid > '1' && mid < '2').toBe(true)
  })

  it('komşu basamaklar arasına da yerleşir (bir derine iner)', () => {
    const mid = rankBetween('a0i', 'a1')
    expect(mid > 'a0i' && mid < 'a1').toBe(true)
  })

  it('sona ekleme her zaman büyür, en büyük basamakta da', () => {
    expect(rankBetween('z', '') > 'z').toBe(true)
    expect(rankBetween('zz', '') > 'zz').toBe(true)
  })

  it('başa ekleme sınırsız tekrarlanabilir — her adım bir öncekinden küçük', () => {
    let current = FIRST_RANK
    for (let i = 0; i < 60; i++) {
      const next = rankBetween('', current)
      expect(next < current).toBe(true)
      expect(next).not.toBe('')
      current = next
    }
  })

  it('sona ekleme sınırsız tekrarlanabilir', () => {
    let current = FIRST_RANK
    for (let i = 0; i < 60; i++) {
      const next = rankBetween(current, '')
      expect(next > current).toBe(true)
      current = next
    }
  })

  it('aynı iki anahtarın arasına ekleme deterministik ve büyüktür', () => {
    // Kopya rank'lar bir veri anomalisi: sonuç yine deterministik olmalı.
    const first = rankBetween('k', 'k')
    const second = rankBetween('k', 'k')
    expect(first).toBe(second)
    expect(first > 'k').toBe(true)
  })

  it('hiçbir anahtar "0" ile bitmez — bitse arasına bir daha değer sığmazdı', () => {
    let current = FIRST_RANK
    for (let i = 0; i < 40; i++) {
      current = rankBetween('', current)
      expect(current.endsWith('0')).toBe(false)
    }
  })

  it('araya tekrar tekrar ekleme sıralamayı korur', () => {
    let low = rankBetween('', '')
    let high = rankBetween(low, '')
    for (let i = 0; i < 50; i++) {
      const mid = rankBetween(low, high)
      expect(low < mid && mid < high).toBe(true)
      // Sırayla bir kez alta, bir kez üste yaklaş.
      if (i % 2 === 0) high = mid
      else low = mid
    }
  })
})

describe('rebalanceRanks', () => {
  it('istenen sayıda, kesin artan anahtar üretir', () => {
    for (const count of [1, 2, 5, 20, 35]) {
      const ranks = rebalanceRanks(count)
      expect(ranks).toHaveLength(count)
      for (let i = 1; i < ranks.length; i++) {
        expect((ranks[i] as string) > (ranks[i - 1] as string)).toBe(true)
      }
    }
  })

  it('sıfır ya da negatif sayı boş liste döner', () => {
    expect(rebalanceRanks(0)).toEqual([])
    expect(rebalanceRanks(-3)).toEqual([])
  })

  it('yeniden dengelenen listenin başına ve sonuna hâlâ ekleme yapılabilir', () => {
    const ranks = rebalanceRanks(5)
    const first = ranks[0] as string
    const last = ranks[ranks.length - 1] as string
    expect(rankBetween('', first) < first).toBe(true)
    expect(rankBetween(last, '') > last).toBe(true)
  })
})
