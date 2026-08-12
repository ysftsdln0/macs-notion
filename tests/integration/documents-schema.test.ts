import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'

beforeEach(async () => {
  await db.docState.deleteMany()
  await db.documentShare.deleteMany()
  await db.document.deleteMany()
  await db.notification.deleteMany()
  await db.comment.deleteMany()
  await db.activity.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
})

describe('doküman şeması', () => {
  it('iç içe sayfa ve paylaşım kısıtı çalışır', async () => {
    const user = await db.user.create({ data: { name: 'Efe' } })
    const channel = await db.channel.create({
      data: { name: 'Proje', slug: 'proje', createdById: user.id },
    })
    const parent = await db.document.create({
      data: { title: 'Ana', channelId: channel.id, createdById: user.id },
    })
    const child = await db.document.create({
      data: { title: 'Alt', parentId: parent.id, channelId: channel.id, createdById: user.id },
    })

    expect((await db.document.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(parent.id)
    expect(child.visibility).toBe('PUBLIC')

    await db.documentShare.create({ data: { documentId: parent.id, userId: user.id } })
    await expect(
      db.documentShare.create({ data: { documentId: parent.id, userId: user.id } }),
    ).rejects.toThrow()
  })

  it('Comment polymorphic; Notification alanları yerinde', async () => {
    const user = await db.user.create({ data: { name: 'A' } })
    await db.comment.create({
      data: { entityType: 'Document', entityId: 'x', body: 'selam', authorId: user.id },
    })
    const c = await db.comment.findFirstOrThrow()
    expect(c.deletedAt).toBeNull()

    await db.notification.create({
      data: {
        userId: user.id,
        kind: 'comment',
        entityType: 'Document',
        entityId: 'x',
        actorId: user.id,
      },
    })
    const n = await db.notification.findFirstOrThrow()
    expect(n.readAt).toBeNull()
  })

  /**
   * Regresyon testi. `Document.searchVector` şemada DEĞİL, migration'a elle
   * yazılmış generated bir kolondur; bu yüzden Prisma onu her `migrate dev`
   * çıktısında fazlalık sayıp düşürmeyi önerir — bir kez gerçekten de öyle
   * oldu (tasks_events migration'ı kolonu ve GIN index'ini DROP ediyordu) ve
   * doküman araması sessizce çalışmaz hale geldi. Bu test o ifadenin
   * migration'da unutulmasını CI'da yakalar.
   */
  it('Document.searchVector generated kolonu ve GIN index\'i yerinde', async () => {
    const columns = await db.$queryRaw<{ is_generated: string }[]>`
      SELECT is_generated FROM information_schema.columns
      WHERE table_name = 'Document' AND column_name = 'searchVector'
    `
    expect(columns).toHaveLength(1)
    expect(columns[0]?.is_generated).toBe('ALWAYS')

    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Document' AND indexname = 'Document_searchVector_idx'
    `
    expect(indexes).toHaveLength(1)
  })
})
