import { beforeEach, describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

let user: { id: string }
let channelId: string

beforeEach(async () => {
  await resetDb()
  user = await db.user.create({ data: { name: 'Sayman' } })
  const channel = await db.channel.create({
    data: { name: 'Sponsorluk', slug: 'sponsorluk', createdById: user.id },
  })
  channelId = channel.id
})

describe('sponsor, bütçe ve ek şeması', () => {
  it('sponsor varsayılanları yerinde', async () => {
    const sponsor = await db.sponsor.create({
      data: { name: 'ACME', channelId, createdById: user.id },
    })
    expect(sponsor.status).toBe('PROSPECT')
    expect(sponsor.currency).toBe('TRY')
    expect(sponsor.amount).toBeNull()
    expect(sponsor.archivedAt).toBeNull()
  })

  it('Decimal(12,2) kuruş hassasiyetini korur — float yuvarlaması yok', async () => {
    const entry = await db.budgetEntry.create({
      data: {
        kind: 'EXPENSE', title: 'Otobüs', category: 'ulasim',
        amount: new Prisma.Decimal('1234.56'), channelId, createdById: user.id,
      },
    })
    const stored = await db.budgetEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(stored.amount.toString()).toBe('1234.56')
    expect(stored.status).toBe('PLANNED')
  })

  it('_sum ile gelir/gider toplanabilir', async () => {
    await db.budgetEntry.createMany({
      data: [
        {
          kind: 'INCOME', title: 'Sponsor geliri', category: 'sponsor-geliri',
          amount: new Prisma.Decimal('5000.00'), channelId, createdById: user.id,
        },
        {
          kind: 'EXPENSE', title: 'Baskı', category: 'tanitim',
          amount: new Prisma.Decimal('1250.75'), channelId, createdById: user.id,
        },
      ],
    })
    const income = await db.budgetEntry.aggregate({
      where: { kind: 'INCOME' }, _sum: { amount: true },
    })
    const expense = await db.budgetEntry.aggregate({
      where: { kind: 'EXPENSE' }, _sum: { amount: true },
    })
    expect(income._sum.amount?.toString()).toBe('5000')
    expect(expense._sum.amount?.toString()).toBe('1250.75')
  })

  it('sponsor silinince bağlı bütçe kalemi silinmez, bağlantısı kopar', async () => {
    const sponsor = await db.sponsor.create({
      data: { name: 'Bağlı', channelId, createdById: user.id },
    })
    const entry = await db.budgetEntry.create({
      data: {
        kind: 'INCOME', title: 'Sponsor ödemesi', category: 'sponsor-geliri',
        amount: new Prisma.Decimal('100.00'), channelId, createdById: user.id,
        sponsorId: sponsor.id,
      },
    })
    await db.sponsor.delete({ where: { id: sponsor.id } })
    const remaining = await db.budgetEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(remaining.sponsorId).toBeNull()
  })

  it('aynı storagePath ikinci kez kaydedilemez', async () => {
    await db.attachment.create({
      data: {
        fileName: 'fis.pdf', mime: 'application/pdf', size: 1024,
        storagePath: '/tmp/uploads/abc', entityType: 'BudgetEntry', entityId: 'x',
        uploadedById: user.id,
      },
    })
    await expect(
      db.attachment.create({
        data: {
          fileName: 'baska.pdf', mime: 'application/pdf', size: 2048,
          storagePath: '/tmp/uploads/abc', entityType: 'BudgetEntry', entityId: 'y',
          uploadedById: user.id,
        },
      }),
    ).rejects.toThrow()
  })

  it('Sponsor tsvector kolonu aranabilir', async () => {
    await db.sponsor.create({
      data: { name: 'Kampüs Kırtasiye', notes: 'baskı desteği', channelId, createdById: user.id },
    })
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Sponsor"
      WHERE "searchVector" @@ plainto_tsquery('turkish', 'baskı')
    `
    expect(rows).toHaveLength(1)
  })
})
