import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'

describe('db', () => {
  it('veritabanına bağlanır', async () => {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`
    expect(rows[0]?.ok).toBe(1)
  })
})
