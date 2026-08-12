import { describe, expect, it, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '../generated/prisma/client.js'
import { authorizeDocument } from '../src/authorize-document.ts'

const db = new PrismaClient()

async function makeSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.session.create({
    data: { sessionToken: token, userId, expires: new Date(Date.now() + 864e5) },
  })
  return token
}

let owner: { id: string }
let outsider: { id: string }
let channelId: string

beforeEach(async () => {
  await db.docState.deleteMany()
  await db.documentShare.deleteMany()
  await db.document.deleteMany()
  await db.session.deleteMany()
  await db.activity.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()

  owner = await db.user.create({ data: { name: 'Sahip', onboardedAt: new Date() } })
  outsider = await db.user.create({ data: { name: 'Yabancı', onboardedAt: new Date() } })
  const channel = await db.channel.create({
    data: { name: 'Proje', slug: 'proje', createdById: owner.id },
  })
  channelId = channel.id
})

describe('authorizeDocument', () => {
  it('geçerli oturum + OPEN kanal üyeliği: yazma izni verilir', async () => {
    const token = await makeSession(owner.id)
    const doc = await db.document.create({
      data: { title: 'Not', channelId, createdById: owner.id },
    })
    await db.channelMember.create({
      data: { channelId, userId: owner.id, channelRole: 'MEMBER' },
    })

    const r = await authorizeDocument(token, doc.id)
    expect(r).toEqual({ ok: true, actorId: owner.id })
  })

  it('geçersiz token reddedilir', async () => {
    const doc = await db.document.create({
      data: { title: 'Not', channelId, createdById: owner.id },
    })
    const r = await authorizeDocument('yanlis-token', doc.id)
    expect(r).toEqual({ ok: false, reason: 'session' })
  })

  it('PRIVATE dokümana üye olmayan (paylaşım yok) reddedilir', async () => {
    const token = await makeSession(outsider.id)
    const doc = await db.document.create({
      data: { title: 'Gizli', channelId, visibility: 'PRIVATE', createdById: owner.id },
    })
    const r = await authorizeDocument(token, doc.id)
    expect(r).toEqual({ ok: false, reason: 'permission' })
  })

  it('PRIVATE dokümana EDIT paylaşımı yazma izni verir', async () => {
    const token = await makeSession(outsider.id)
    const doc = await db.document.create({
      data: { title: 'Gizli', channelId, visibility: 'PRIVATE', createdById: owner.id },
    })
    await db.documentShare.create({
      data: { documentId: doc.id, userId: outsider.id, permission: 'EDIT' },
    })
    const r = await authorizeDocument(token, doc.id)
    expect(r.ok).toBe(true)
  })

  it('arşivlenmiş doküman reddedilir', async () => {
    const token = await makeSession(owner.id)
    const doc = await db.document.create({
      data: { title: 'Silik', channelId, createdById: owner.id, archivedAt: new Date() },
    })
    const r = await authorizeDocument(token, doc.id)
    expect(r).toEqual({ ok: false, reason: 'document' })
  })
})
