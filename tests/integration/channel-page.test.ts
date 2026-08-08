import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: { id: string; globalRole: 'ADMIN' | 'MEMBER' } | null } = { current: null }

async function resolveMockedActor() {
  if (!actorRef.current) return null
  const user = await db.user.findUniqueOrThrow({
    where: { id: actorRef.current.id },
    include: { memberships: true },
  })
  return {
    id: user.id, globalRole: user.globalRole, isActive: user.isActive,
    memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
  }
}

// `requireActor`'ın gerçek implementasyonu kendi modülü içindeki `getActor`'ı
// çağırır; yalnızca `getActor`'ı mock'lamak `requireActor`'ı etkilemez (ESM
// kapanışı orijinal fonksiyona bağlı kalır). Bu yüzden ikisi de burada
// doğrudan mock'lanır.
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: resolveMockedActor,
  requireActor: async () => {
    const actor = await resolveMockedActor()
    if (!actor) throw new Error('test ortamında oturum yok')
    return actor
  },
}))

const { createChannel } = await import('@/server/channels')
const { default: ChannelPage } = await import('@/app/(app)/c/[slug]/page')

let admin: { id: string }
let plain: { id: string }

beforeEach(async () => {
  await resetDb()
  admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
  plain = await db.user.create({ data: { name: 'Üye' } })
})

describe('ChannelPage', () => {
  it('üye olmayan biri PRIVATE kanal için notFound alır, varlığı sızmaz', async () => {
    actorRef.current = { id: admin.id, globalRole: 'ADMIN' }
    const created = await createChannel({ name: 'Gizli Sayfa', visibility: 'PRIVATE' })
    if (!created.ok) throw new Error('beklenmedik hata')

    actorRef.current = { id: plain.id, globalRole: 'MEMBER' }
    await expect(
      ChannelPage({ params: Promise.resolve({ slug: created.data.slug }) }),
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
  })
})
