import { describe, expect, it, beforeEach } from 'vitest'
import { PrismaClient } from '../generated/prisma/client.js'
import { signCollabToken } from '../../src/lib/auth/collab-token.ts'
import { authorizeDocument } from '../src/authorize-document.ts'
import { resolveActor } from '../src/auth.ts'
import { resetCollabDb } from './helpers/reset-db.ts'

const db = new PrismaClient()

// resolveActor sırrı process.env.AUTH_SECRET'tan okur; testte de aynı yerden
// gelmeli, yoksa imza doğrulaması hep başarısız olur.
process.env.AUTH_SECRET ??= 'collab-test-secret'

function makeToken(userId: string): string {
  return signCollabToken(userId, process.env.AUTH_SECRET as string)
}

let owner: { id: string }
let outsider: { id: string }
let channelId: string

beforeEach(async () => {
  await resetCollabDb(db)

  owner = await db.user.create({ data: { name: 'Sahip', onboardedAt: new Date() } })
  outsider = await db.user.create({ data: { name: 'Yabancı', onboardedAt: new Date() } })
  const channel = await db.channel.create({
    data: { name: 'Proje', slug: 'proje', createdById: owner.id },
  })
  channelId = channel.id
})

describe('authorizeDocument', () => {
  it('geçerli collab token + OPEN kanal üyeliği: yazma izni verilir', async () => {
    const token = makeToken(owner.id)
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
    const token = makeToken(outsider.id)
    const doc = await db.document.create({
      data: { title: 'Gizli', channelId, visibility: 'PRIVATE', createdById: owner.id },
    })
    const r = await authorizeDocument(token, doc.id)
    expect(r).toEqual({ ok: false, reason: 'permission' })
  })

  it('PRIVATE dokümana EDIT paylaşımı yazma izni verir', async () => {
    const token = makeToken(outsider.id)
    const doc = await db.document.create({
      data: { title: 'Gizli', channelId, visibility: 'PRIVATE', createdById: owner.id },
    })
    await db.documentShare.create({
      data: { documentId: doc.id, userId: outsider.id, permission: 'EDIT' },
    })
    const r = await authorizeDocument(token, doc.id)
    expect(r.ok).toBe(true)
  })

  it('pasife alınan üye, token süresi dolmasa da reddedilir', async () => {
    const token = makeToken(owner.id)
    const doc = await db.document.create({
      data: { title: 'Not', channelId, createdById: owner.id },
    })
    await db.user.update({ where: { id: owner.id }, data: { isActive: false } })

    const r = await authorizeDocument(token, doc.id)
    expect(r).toEqual({ ok: false, reason: 'session' })
  })

  it('arşivlenmiş doküman reddedilir', async () => {
    const token = makeToken(owner.id)
    const doc = await db.document.create({
      data: { title: 'Silik', channelId, createdById: owner.id, archivedAt: new Date() },
    })
    const r = await authorizeDocument(token, doc.id)
    expect(r).toEqual({ ok: false, reason: 'document' })
  })
})

describe('rol izinleri collab tarafında', () => {
  // NOT: Task 2 kapsamı bilinçli olarak can()'e dokunmuyor (bkz. Task 3) —
  // bu yüzden burada authorizeDocument yerine resolveActor doğrudan
  // doğrulanıyor. CONTENT_WRITE_ALL taşımak bugün document:write kararını
  // henüz DEĞİŞTİRMİYOR (can() permissions'a hiç bakmıyor); can()'in
  // rolleri de dinlemesi Task 3'ün işi. Burada kanıtlanan tek şey,
  // resolveActor'ün rolleri gerçekten yükleyip actor.permissions'a
  // taşıdığı — Task 3 zamanı geldiğinde can() bu alanı okumaya başlayınca
  // otomatik olarak doğru sonucu üretecek.
  it('CONTENT_WRITE_ALL taşıyan rolün izni resolveActor ile actor.permissions\'a taşınır', async () => {
    const role = await db.role.create({
      data: {
        name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1,
        permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL'],
      },
    })
    await db.userRole.create({ data: { userId: outsider.id, roleId: role.id } })

    const actor = await resolveActor(makeToken(outsider.id))

    expect(actor?.permissions.slice().sort()).toEqual(['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL'])
  })

  it('rolsüz yabancı aynı dokümana bağlanamaz', async () => {
    const doc = await db.document.create({
      data: { title: 'Not', channelId, createdById: owner.id },
    })

    const r = await authorizeDocument(makeToken(outsider.id), doc.id)

    expect(r).not.toEqual({ ok: true, actorId: outsider.id })
  })
})
