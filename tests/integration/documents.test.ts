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
      include: { memberships: true },
    })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
    }
  },
}))

const {
  archiveDocument, createDocument, permanentlyDeleteDocument, removeShare,
  restoreDocument, updateDocumentMeta, upsertShare,
} = await import('@/server/documents')
const {
  canReadDocument, listArchivedDocuments, listVisibleDocuments, getDocumentTree,
} = await import('@/server/documents-query')

let admin: { id: string }
let lead: { id: string }
let member: { id: string }
let outsider: { id: string }
let channel: { id: string }

async function actorOf(id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id }, include: { memberships: true } })
  return {
    id: user.id, globalRole: user.globalRole, isActive: user.isActive,
    memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
  }
}

beforeEach(async () => {
  await resetDb()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  lead = await db.user.create({ data: { name: 'Lider' } })
  member = await db.user.create({ data: { name: 'Üye' } })
  outsider = await db.user.create({ data: { name: 'Dışarıdaki' } })
  channel = await db.channel.create({
    data: {
      name: 'Proje', slug: 'proje', createdById: lead.id,
      members: {
        create: [
          { userId: lead.id, channelRole: 'LEAD' },
          { userId: member.id, channelRole: 'MEMBER' },
        ],
      },
    },
  })
})

describe('createDocument', () => {
  it('kanal üyesi doküman açar ve hareket kaydı düşer', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({ title: 'Toplantı notları', channelId: channel.id })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const doc = await db.document.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(doc.visibility).toBe('PUBLIC')
    expect(doc.createdById).toBe(member.id)

    const activity = await db.activity.findFirstOrThrow({ where: { entityId: doc.id } })
    expect(activity.verb).toBe('document.created')
    expect(activity.channelId).toBe(channel.id)
  })

  it('kanal dışından biri PRIVATE kanalda doküman açamaz', async () => {
    const secret = await db.channel.create({
      data: { name: 'Gizli', slug: 'gizli', visibility: 'PRIVATE', createdById: admin.id },
    })
    actorRef.current = { id: outsider.id }
    const r = await createDocument({ title: 'Sızıntı', channelId: secret.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('başka kanaldaki bir dokümanı ebeveyn yapamaz', async () => {
    const other = await db.channel.create({
      data: {
        name: 'Diğer', slug: 'diger', createdById: member.id,
        members: { create: { userId: member.id, channelRole: 'LEAD' } },
      },
    })
    actorRef.current = { id: member.id }
    const parent = await createDocument({ title: 'Ana', channelId: other.id })
    if (!parent.ok) throw new Error('beklenmedik hata')

    const child = await createDocument({
      title: 'Alt', channelId: channel.id, parentId: parent.data.id,
    })
    expect(child.ok).toBe(false)
    if (!child.ok) expect(child.error.code).toBe('VALIDATION')
  })
})

describe('görünürlük ve okuma', () => {
  it('PRIVATE doküman sahibi dışındakine görünmez', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({
      title: 'Kişisel', channelId: channel.id, visibility: 'PRIVATE',
    })
    if (!r.ok) throw new Error('beklenmedik hata')

    expect(await canReadDocument(await actorOf(member.id), r.data.id)).toBe(true)
    expect(await canReadDocument(await actorOf(lead.id), r.data.id)).toBe(false)
    expect(await canReadDocument(await actorOf(admin.id), r.data.id)).toBe(true)

    actorRef.current = { id: lead.id }
    expect((await listVisibleDocuments()).map((d) => d.title)).not.toContain('Kişisel')
  })

  it('CHANNEL dokümanı yalnızca kanal üyelerinin listesinde çıkar', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({
      title: 'Kanal içi', channelId: channel.id, visibility: 'CHANNEL',
    })
    if (!r.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: lead.id }
    expect((await listVisibleDocuments()).map((d) => d.title)).toContain('Kanal içi')
    actorRef.current = { id: outsider.id }
    expect((await listVisibleDocuments()).map((d) => d.title)).not.toContain('Kanal içi')
  })

  it('VIEW paylaşımı okuma verir, yazma vermez', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({
      title: 'Paylaşılan', channelId: channel.id, visibility: 'PRIVATE',
    })
    if (!r.ok) throw new Error('beklenmedik hata')
    const shared = await upsertShare({
      documentId: r.data.id, userId: outsider.id, permission: 'VIEW',
    })
    expect(shared.ok).toBe(true)

    expect(await canReadDocument(await actorOf(outsider.id), r.data.id)).toBe(true)
    actorRef.current = { id: outsider.id }
    expect((await listVisibleDocuments()).map((d) => d.title)).toContain('Paylaşılan')

    const write = await updateDocumentMeta({ id: r.data.id, title: 'Ele geçirildi' })
    expect(write.ok).toBe(false)
    if (!write.ok) expect(write.error.code).toBe('FORBIDDEN')
  })

  it('EDIT paylaşımı yazma verir; paylaşım kaldırılınca erişim biter', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({
      title: 'Ortak', channelId: channel.id, visibility: 'PRIVATE',
    })
    if (!r.ok) throw new Error('beklenmedik hata')
    await upsertShare({ documentId: r.data.id, userId: outsider.id, permission: 'EDIT' })

    actorRef.current = { id: outsider.id }
    const write = await updateDocumentMeta({ id: r.data.id, title: 'Ortak taslak' })
    expect(write.ok).toBe(true)

    actorRef.current = { id: member.id }
    await removeShare({ documentId: r.data.id, userId: outsider.id })
    expect(await canReadDocument(await actorOf(outsider.id), r.data.id)).toBe(false)
  })

  it('düz üye başkasının dokümanını paylaşamaz, LEAD paylaşabilir', async () => {
    actorRef.current = { id: lead.id }
    const r = await createDocument({ title: 'Liderin dokümanı', channelId: channel.id })
    if (!r.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: member.id }
    const denied = await upsertShare({
      documentId: r.data.id, userId: outsider.id, permission: 'VIEW',
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: lead.id }
    const allowed = await upsertShare({
      documentId: r.data.id, userId: outsider.id, permission: 'VIEW',
    })
    expect(allowed.ok).toBe(true)
  })
})

describe('updateDocumentMeta', () => {
  it('gönderilmeyen alanları silmez', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({ title: 'Başlık', channelId: channel.id })
    if (!r.ok) throw new Error('beklenmedik hata')
    await updateDocumentMeta({ id: r.data.id, icon: '📌' })

    const doc = await db.document.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(doc.title).toBe('Başlık')
    expect(doc.icon).toBe('📌')
  })

  it('görünürlük değişimi paylaşım yetkisi ister', async () => {
    actorRef.current = { id: lead.id }
    const r = await createDocument({ title: 'Kanal dokümanı', channelId: channel.id })
    if (!r.ok) throw new Error('beklenmedik hata')

    // Düz üye içeriği yazabilir (PUBLIC doküman, kanal üyesi) ama dokümanı
    // kanaldan koparamaz.
    actorRef.current = { id: member.id }
    const rename = await updateDocumentMeta({ id: r.data.id, title: 'Yeni ad' })
    expect(rename.ok).toBe(true)

    const hijack = await updateDocumentMeta({ id: r.data.id, visibility: 'PRIVATE' })
    expect(hijack.ok).toBe(false)
    if (!hijack.ok) expect(hijack.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: lead.id }
    expect((await updateDocumentMeta({ id: r.data.id, visibility: 'PRIVATE' })).ok).toBe(true)
  })

  it('var olmayan doküman NOT_FOUND döner', async () => {
    actorRef.current = { id: admin.id }
    const r = await updateDocumentMeta({ id: 'cnonexistentdoc0000000', title: 'Yok' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })
})

describe('arşiv ve çöp kutusu', () => {
  it('sahibi arşivler, admin geri yükler, listeden düşer', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({ title: 'Eski', channelId: channel.id })
    if (!r.ok) throw new Error('beklenmedik hata')

    expect((await archiveDocument({ id: r.data.id })).ok).toBe(true)
    expect((await listVisibleDocuments()).map((d) => d.title)).not.toContain('Eski')
    expect(await canReadDocument(await actorOf(member.id), r.data.id)).toBe(false)

    // Geri yükleme yalnızca admin ekranı.
    const memberRestore = await restoreDocument({ id: r.data.id })
    expect(memberRestore.ok).toBe(false)
    if (!memberRestore.ok) expect(memberRestore.error.code).toBe('FORBIDDEN')

    actorRef.current = { id: admin.id }
    expect((await listArchivedDocuments()).map((d) => d.title)).toContain('Eski')
    expect((await restoreDocument({ id: r.data.id })).ok).toBe(true)

    actorRef.current = { id: member.id }
    expect((await listVisibleDocuments()).map((d) => d.title)).toContain('Eski')
  })

  it('kanal dışından biri arşivleyemez; kalıcı silme yalnızca admin', async () => {
    actorRef.current = { id: member.id }
    const r = await createDocument({ title: 'Korunan', channelId: channel.id })
    if (!r.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: outsider.id }
    const denied = await archiveDocument({ id: r.data.id })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    const deniedDelete = await permanentlyDeleteDocument({ id: r.data.id })
    expect(deniedDelete.ok).toBe(false)

    actorRef.current = { id: admin.id }
    expect((await permanentlyDeleteDocument({ id: r.data.id })).ok).toBe(true)
    expect(await db.document.findUnique({ where: { id: r.data.id } })).toBeNull()
  })
})

describe('getDocumentTree', () => {
  it('alt sayfaları ebeveynin altına yerleştirir', async () => {
    actorRef.current = { id: member.id }
    const parent = await createDocument({ title: 'Ana', channelId: channel.id })
    if (!parent.ok) throw new Error('beklenmedik hata')
    const child = await createDocument({
      title: 'Alt', channelId: channel.id, parentId: parent.data.id,
    })
    if (!child.ok) throw new Error('beklenmedik hata')

    const tree = await getDocumentTree()
    expect(tree).toHaveLength(1)
    expect(tree[0]?.title).toBe('Ana')
    expect(tree[0]?.children.map((c) => c.title)).toEqual(['Alt'])
  })

  it('ebeveyni görünmeyen alt sayfa kök seviyesine çıkar', async () => {
    actorRef.current = { id: member.id }
    const parent = await createDocument({
      title: 'Gizli ana', channelId: channel.id, visibility: 'PRIVATE',
    })
    if (!parent.ok) throw new Error('beklenmedik hata')
    const child = await createDocument({
      title: 'Açık alt', channelId: channel.id, parentId: parent.data.id,
    })
    if (!child.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: lead.id }
    const tree = await getDocumentTree()
    expect(tree.map((n) => n.title)).toEqual(['Açık alt'])
  })
})
