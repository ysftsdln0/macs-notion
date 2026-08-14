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

const { addComment, deleteComment, editComment } = await import('@/server/comments')
const { listComments } = await import('@/server/comments-query')

let admin: { id: string; name: string }
let member: { id: string; name: string }
let other: { id: string; name: string }
let outsider: { id: string; name: string }
let channelId: string
let publicDoc: { id: string }
let privateDoc: { id: string }

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
  member = await db.user.create({ data: { name: 'Efe Taşdelen' } })
  other = await db.user.create({ data: { name: 'Şule Işık' } })
  outsider = await db.user.create({ data: { name: 'Dışarıdaki' } })

  const channel = await db.channel.create({
    data: {
      name: 'Proje', slug: 'proje', visibility: 'PRIVATE', createdById: member.id,
      members: {
        create: [
          { userId: member.id, channelRole: 'LEAD' },
          { userId: other.id, channelRole: 'MEMBER' },
        ],
      },
    },
  })
  channelId = channel.id
  publicDoc = await db.document.create({
    data: { title: 'Açık', channelId, createdById: member.id, visibility: 'PUBLIC' },
  })
  privateDoc = await db.document.create({
    data: { title: 'Gizli', channelId, createdById: member.id, visibility: 'PRIVATE' },
  })
})

describe('addComment', () => {
  it('okuma yetkisi olan yorum ekler; yazar ve tarih doğrulanır', async () => {
    actorRef.current = { id: other.id }
    const r = await addComment({ entityType: 'Document', entityId: publicDoc.id, body: 'Katılıyorum' })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const comment = await db.comment.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(comment.authorId).toBe(other.id)
    expect(comment.entityType).toBe('Document')
    expect(comment.deletedAt).toBeNull()
    expect(comment.createdAt).toBeInstanceOf(Date)
  })

  it('okuyamadığı dokümana yorum ekleyemez', async () => {
    actorRef.current = { id: other.id }
    const r = await addComment({ entityType: 'Document', entityId: privateDoc.id, body: 'Sızıntı' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('arşivlenmiş dokümana yorum eklenemez', async () => {
    await db.document.update({ where: { id: publicDoc.id }, data: { archivedAt: new Date() } })
    actorRef.current = { id: member.id }
    const r = await addComment({ entityType: 'Document', entityId: publicDoc.id, body: 'Geç kaldım' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('boş yorum reddedilir', async () => {
    actorRef.current = { id: member.id }
    const r = await addComment({ entityType: 'Document', entityId: publicDoc.id, body: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })

  it('hareket kaydı kanal kapsamıyla düşer', async () => {
    actorRef.current = { id: member.id }
    await addComment({ entityType: 'Document', entityId: publicDoc.id, body: 'Not' })
    const activity = await db.activity.findFirstOrThrow({ where: { verb: 'comment.added' } })
    expect(activity.channelId).toBe(channelId)
  })
})

describe('mention bildirimleri', () => {
  it('adı geçen kişiye mention bildirimi üretilir', async () => {
    actorRef.current = { id: member.id }
    const r = await addComment({
      entityType: 'Document', entityId: publicDoc.id,
      body: '@Şule Işık bunu bakar mısın',
    })
    expect(r.ok).toBe(true)

    const notification = await db.notification.findFirstOrThrow({ where: { userId: other.id } })
    expect(notification.kind).toBe('mention')
    expect(notification.entityId).toBe(publicDoc.id)
    expect(notification.actorId).toBe(member.id)
    expect(notification.readAt).toBeNull()
  })

  it('kişi kendini etiketlerse bildirim üretilmez', async () => {
    actorRef.current = { id: member.id }
    await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: '@Efe Taşdelen kendine not',
    })
    expect(await db.notification.count()).toBe(0)
  })

  it('dokümanı okuyamayan biri etiketlenirse bildirim üretilmez', async () => {
    // privateDoc'u yalnızca sahibi (member) ve admin okuyabilir; outsider
    // etiketlense bile bildirim almamalı — aksi halde göremeyeceği bir
    // dokümanın varlığı ona sızardı.
    actorRef.current = { id: member.id }
    await addComment({
      entityType: 'Document', entityId: privateDoc.id, body: '@Dışarıdaki bak',
    })
    expect(await db.notification.count({ where: { userId: outsider.id } })).toBe(0)
  })
})

describe('editComment / deleteComment', () => {
  it('yalnızca yazar düzenler; admin bile düzenleyemez', async () => {
    actorRef.current = { id: other.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'İlk hali',
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: admin.id }
    const denied = await editComment({ id: created.data.id, body: 'Adminden' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: other.id }
    const allowed = await editComment({ id: created.data.id, body: 'İkinci hali' })
    expect(allowed.ok).toBe(true)
    const comment = await db.comment.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(comment.body).toBe('İkinci hali')
    expect(comment.editedAt).not.toBeNull()
  })

  it('silme soft: satır kalır, deletedAt dolar', async () => {
    actorRef.current = { id: other.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'Silinecek',
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    expect((await deleteComment({ id: created.data.id })).ok).toBe(true)
    const comment = await db.comment.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(comment.deletedAt).not.toBeNull()
    expect(comment.body).toBe('Silinecek')
  })

  it('başkasının yorumunu düz üye silemez, admin siler', async () => {
    actorRef.current = { id: other.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'Korunan',
    })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const denied = await deleteComment({ id: created.data.id })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: admin.id }
    expect((await deleteComment({ id: created.data.id })).ok).toBe(true)
  })

  it('silinmiş yorum ikinci kez silinemez', async () => {
    actorRef.current = { id: member.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'Tek sefer',
    })
    if (!created.ok) throw new Error('beklenmedik hata')
    await deleteComment({ id: created.data.id })
    const second = await deleteComment({ id: created.data.id })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('NOT_FOUND')
  })
})

describe('listComments', () => {
  it('okuyamayan boş liste alır, okuyan sırayla görür', async () => {
    actorRef.current = { id: member.id }
    await addComment({ entityType: 'Document', entityId: publicDoc.id, body: 'Birinci' })
    await addComment({ entityType: 'Document', entityId: publicDoc.id, body: 'İkinci' })

    const visible = await listComments(await actorOf(other.id), 'Document', publicDoc.id)
    expect(visible.map((c) => c.body)).toEqual(['Birinci', 'İkinci'])

    await addComment({ entityType: 'Document', entityId: privateDoc.id, body: 'Gizli yorum' })
    const hidden = await listComments(await actorOf(other.id), 'Document', privateDoc.id)
    expect(hidden).toEqual([])
  })
})

describe('yorum moderasyonu', () => {
  it('CONTENT_WRITE_ALL taşıyan başkasının yorumunu silebilir', async () => {
    const role = await db.role.create({
      data: {
        name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1,
        permissions: ['CONTENT_READ_ALL', 'CONTENT_WRITE_ALL'],
      },
    })
    const moderator = await db.user.create({ data: { name: 'YK Üyesi' } })
    await db.userRole.create({ data: { userId: moderator.id, roleId: role.id } })

    actorRef.current = { id: other.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'silinecek',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // Moderatör kanala üye DEĞİL; yetkisi yalnızca rolünden geliyor.
    actorRef.current = { id: moderator.id }
    const removed = await deleteComment({ id: created.data.id })

    expect(removed.ok).toBe(true)
  })

  it('izinsiz üye başkasının yorumunu silemez', async () => {
    actorRef.current = { id: other.id }
    const created = await addComment({
      entityType: 'Document', entityId: publicDoc.id, body: 'kalacak',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    actorRef.current = { id: outsider.id }
    const removed = await deleteComment({ id: created.data.id })

    expect(removed.ok).toBe(false)
  })
})
