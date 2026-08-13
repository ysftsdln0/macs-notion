import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: { id: string } | null } = { current: null }

vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current.id },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { archiveBudgetEntry, createBudgetEntry, updateBudgetEntry } = await import('@/server/budget')
const {
  budgetChannelIds, canReadBudgetOfChannel, listBudgetEntries, summarizeBudget,
} = await import('@/server/budget-query')
const { createEvent } = await import('@/server/events')

let admin: { id: string }
let lead: { id: string }
let member: { id: string }
let channel: { id: string }
let otherChannel: { id: string }

async function actorOf(id: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id },
    include: {
      memberships: true,
      roles: { select: { role: { select: { permissions: true } } } },
    },
  })
  return {
    id: user.id, globalRole: user.globalRole, isActive: user.isActive,
    memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
    permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
  }
}

beforeEach(async () => {
  await resetDb()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  lead = await db.user.create({ data: { name: 'Lider' } })
  member = await db.user.create({ data: { name: 'Üye' } })

  channel = await db.channel.create({
    data: {
      name: 'Bütçe', slug: 'butce', visibility: 'OPEN', createdById: admin.id,
      members: {
        create: [
          { userId: lead.id, channelRole: 'LEAD' },
          { userId: member.id, channelRole: 'MEMBER' },
        ],
      },
    },
  })
  otherChannel = await db.channel.create({
    data: { name: 'Diğer', slug: 'diger', visibility: 'OPEN', createdById: admin.id },
  })
})

describe('createBudgetEntry', () => {
  it('admin kalem oluşturur; varsayılanlar yerinde', async () => {
    actorRef.current = { id: admin.id }
    const r = await createBudgetEntry({
      kind: 'EXPENSE', title: 'Afiş baskısı', amount: '250.00',
      category: 'Tanıtım', channelId: channel.id,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const entry = await db.budgetEntry.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(entry.status).toBe('PLANNED')
    expect(entry.currency).toBe('TRY')
    expect(entry.receiptAttachmentId).toBeNull()
    expect(entry.createdById).toBe(admin.id)
  })

  it('LEAD yalnızca okur, yazamaz', async () => {
    actorRef.current = { id: lead.id }
    const r = await createBudgetEntry({
      kind: 'INCOME', title: 'Bağış', amount: '100', category: 'Bağış', channelId: channel.id,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')

    expect(await canReadBudgetOfChannel(await actorOf(lead.id), channel.id)).toBe(true)
  })

  it('düz üye bütçeyi ne okur ne yazar', async () => {
    actorRef.current = { id: member.id }
    const r = await createBudgetEntry({
      kind: 'INCOME', title: 'Bağış', amount: '100', category: 'Bağış', channelId: channel.id,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')

    expect(await canReadBudgetOfChannel(await actorOf(member.id), channel.id)).toBe(false)
    expect(budgetChannelIds(await actorOf(member.id))).toEqual([])
  })

  it('kuruş hassasiyeti korunur — 0.01 kaybolmaz', async () => {
    actorRef.current = { id: admin.id }
    for (const amount of ['0.01', '1234567.89', '1500,50']) {
      const r = await createBudgetEntry({
        kind: 'EXPENSE', title: `Kalem ${amount}`, amount,
        category: 'Test', channelId: channel.id,
      })
      if (!r.ok) throw new Error(`beklenmedik hata: ${amount}`)
      const entry = await db.budgetEntry.findUniqueOrThrow({ where: { id: r.data.id } })
      expect(entry.amount.toFixed(2)).toBe(amount.replace(',', '.'))
    }
  })

  it('negatif, sıfır ve üç ondalıklı tutar reddedilir', async () => {
    actorRef.current = { id: admin.id }
    for (const amount of ['-100', '0', '0.00', '10.005', 'abc', '']) {
      const r = await createBudgetEntry({
        kind: 'EXPENSE', title: 'Hatalı', amount, category: 'Test', channelId: channel.id,
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('VALIDATION')
    }
  })

  it('başka kanaldaki etkinliğe bağlanamaz', async () => {
    actorRef.current = { id: admin.id }
    const event = await createEvent({
      title: 'Diğer kanal etkinliği', channelId: otherChannel.id,
      startsAt: new Date('2026-11-01T09:00:00Z'),
    })
    if (!event.ok) throw new Error('beklenmedik hata')

    const r = await createBudgetEntry({
      kind: 'EXPENSE', title: 'Yanlış bağlantı', amount: '10', category: 'Test',
      channelId: channel.id, eventId: event.data.id,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.fields?.eventId).toBeDefined()
  })
})

describe('summarizeBudget', () => {
  it('gelir, gider ve bakiye para birimi başına hesaplanır', async () => {
    actorRef.current = { id: admin.id }
    await createBudgetEntry({
      kind: 'INCOME', title: 'Sponsor', amount: '1000.10', category: 'Sponsorluk',
      channelId: channel.id,
    })
    await createBudgetEntry({
      kind: 'EXPENSE', title: 'Baskı', amount: '250.05', category: 'Tanıtım',
      channelId: channel.id,
    })
    await createBudgetEntry({
      kind: 'INCOME', title: 'Yurt dışı sponsor', amount: '500.00', category: 'Sponsorluk',
      channelId: channel.id, currency: 'USD',
    })

    const summary = await summarizeBudget(await actorOf(admin.id), { channelId: channel.id })
    const tryRow = summary.find((s) => s.currency === 'TRY')
    const usdRow = summary.find((s) => s.currency === 'USD')

    expect(tryRow).toEqual({
      currency: 'TRY', income: '1000.10', expense: '250.05', balance: '750.05',
    })
    expect(usdRow).toEqual({
      currency: 'USD', income: '500.00', expense: '0.00', balance: '500.00',
    })
  })

  it('kuruşlar float hatası biriktirmeden toplanır', async () => {
    actorRef.current = { id: admin.id }
    for (let i = 0; i < 10; i += 1) {
      await createBudgetEntry({
        kind: 'EXPENSE', title: `Kalem ${i}`, amount: '0.10',
        category: 'Test', channelId: channel.id,
      })
    }
    const summary = await summarizeBudget(await actorOf(admin.id), { channelId: channel.id })
    expect(summary[0]?.expense).toBe('1.00')
    expect(summary[0]?.balance).toBe('-1.00')
  })

  it('yalnızca yetkili kanallar özete girer', async () => {
    actorRef.current = { id: admin.id }
    await createBudgetEntry({
      kind: 'INCOME', title: 'Görünmez', amount: '999', category: 'Test',
      channelId: otherChannel.id,
    })

    // LEAD sadece kendi kanalını görür; otherChannel'da üyeliği yok.
    const leadEntries = await listBudgetEntries(await actorOf(lead.id))
    expect(leadEntries).toEqual([])
    expect(await summarizeBudget(await actorOf(lead.id))).toEqual([])

    const adminEntries = await listBudgetEntries(await actorOf(admin.id))
    expect(adminEntries.map((e) => e.title)).toContain('Görünmez')
  })

  it('tutar listede dize olarak döner — Decimal istemciye geçmez', async () => {
    actorRef.current = { id: admin.id }
    await createBudgetEntry({
      kind: 'EXPENSE', title: 'Dizeli', amount: '42.50', category: 'Test', channelId: channel.id,
    })
    const list = await listBudgetEntries(await actorOf(admin.id))
    expect(typeof list[0]?.amount).toBe('string')
    expect(list[0]?.amount).toBe('42.5')
  })
})

describe('updateBudgetEntry / arşivleme', () => {
  async function createdEntryId(): Promise<string> {
    actorRef.current = { id: admin.id }
    const r = await createBudgetEntry({
      kind: 'EXPENSE', title: 'Kalem', amount: '100', category: 'Test', channelId: channel.id,
    })
    if (!r.ok) throw new Error('beklenmedik hata')
    return r.data.id
  }

  it('gönderilmeyen alanlar korunur', async () => {
    const id = await createdEntryId()
    const r = await updateBudgetEntry({ id, status: 'PAID' })
    expect(r.ok).toBe(true)

    const entry = await db.budgetEntry.findUniqueOrThrow({ where: { id } })
    expect(entry.title).toBe('Kalem')
    expect(entry.amount.toFixed(2)).toBe('100.00')
    expect(entry.status).toBe('PAID')
  })

  it('fiş eki bağlanabilir', async () => {
    const id = await createdEntryId()
    const attachment = await db.attachment.create({
      data: {
        fileName: 'fis.pdf', mime: 'application/pdf', size: 1024,
        storagePath: 'a/b', entityType: 'BudgetEntry', entityId: id,
        uploadedById: admin.id,
      },
    })

    const r = await updateBudgetEntry({ id, receiptAttachmentId: attachment.id })
    expect(r.ok).toBe(true)
    const entry = await db.budgetEntry.findUniqueOrThrow({ where: { id } })
    expect(entry.receiptAttachmentId).toBe(attachment.id)
  })

  it('başka varlığın eki fiş olarak bağlanamaz', async () => {
    const id = await createdEntryId()
    const other = await createdEntryId()
    const attachment = await db.attachment.create({
      data: {
        fileName: 'baskasinin.pdf', mime: 'application/pdf', size: 10,
        storagePath: 'c/d', entityType: 'BudgetEntry', entityId: other,
        uploadedById: admin.id,
      },
    })

    const r = await updateBudgetEntry({ id, receiptAttachmentId: attachment.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.fields?.receiptAttachmentId).toBeDefined()
  })

  it('LEAD güncelleyemez', async () => {
    const id = await createdEntryId()
    actorRef.current = { id: lead.id }
    const r = await updateBudgetEntry({ id, status: 'PAID' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('arşivlenen kalem listeden ve özetten düşer, güncellenemez', async () => {
    const id = await createdEntryId()
    expect((await archiveBudgetEntry({ id })).ok).toBe(true)

    expect(await listBudgetEntries(await actorOf(admin.id))).toEqual([])
    expect(await summarizeBudget(await actorOf(admin.id))).toEqual([])

    const r = await updateBudgetEntry({ id, status: 'PAID' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })
})
