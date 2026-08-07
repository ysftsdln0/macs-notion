import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'

const actorRef: { current: { id: string } | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () =>
    actorRef.current && {
      id: actorRef.current.id, globalRole: 'MEMBER' as const,
      isActive: true, memberships: [],
    },
}))

const { completeOnboarding } = await import('@/server/profile')

beforeEach(async () => {
  await db.activity.deleteMany()
  await db.channelMember.deleteMany()
  await db.invite.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
})

describe('completeOnboarding', () => {
  it('ad ve ünvanı kaydeder, onboardedAt doldurur', async () => {
    const user = await db.user.create({ data: { name: 'Google Adı', email: 'a@x.com' } })
    actorRef.current = { id: user.id }

    const r = await completeOnboarding({ name: 'Yusuf Efe', title: 'Proje Koordinatörü' })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updated.name).toBe('Yusuf Efe')
    expect(updated.title).toBe('Proje Koordinatörü')
    expect(updated.onboardedAt).not.toBeNull()
  })

  it('boş ad için alan bazlı hata döner', async () => {
    const user = await db.user.create({ data: { name: 'X', email: 'b@x.com' } })
    actorRef.current = { id: user.id }

    const r = await completeOnboarding({ name: ' ', title: '' })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.fields?.name).toBe('Ad soyad zorunlu.')
  })

  it('oturum yoksa UNAUTHENTICATED döner', async () => {
    actorRef.current = null
    const r = await completeOnboarding({ name: 'Efe', title: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('UNAUTHENTICATED')
  })

  it('iki kez çağrılırsa tek member.joined kaydı kalır ve onboardedAt değişmez', async () => {
    const user = await db.user.create({ data: { name: 'Google Adı', email: 'c@x.com' } })
    actorRef.current = { id: user.id }

    const first = await completeOnboarding({ name: 'Yusuf Efe', title: 'Proje Koordinatörü' })
    expect(first.ok).toBe(true)
    const afterFirst = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    const firstOnboardedAt = afterFirst.onboardedAt
    expect(firstOnboardedAt).not.toBeNull()

    const second = await completeOnboarding({ name: 'Yusuf Efe', title: 'Proje Koordinatörü' })
    expect(second.ok).toBe(true)

    const activities = await db.activity.findMany({ where: { entityId: user.id, verb: 'member.joined' } })
    expect(activities).toHaveLength(1)

    const afterSecond = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(afterSecond.onboardedAt?.getTime()).toBe(firstOnboardedAt?.getTime())
  })

  it('ikinci çağrı ad ve ünvanı yine günceller', async () => {
    const user = await db.user.create({ data: { name: 'Google Adı', email: 'd@x.com' } })
    actorRef.current = { id: user.id }

    await completeOnboarding({ name: 'Yusuf Efe', title: 'Proje Koordinatörü' })
    const r = await completeOnboarding({ name: 'Efe Yusuf', title: 'Başkan' })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(updated.name).toBe('Efe Yusuf')
    expect(updated.title).toBe('Başkan')
  })
})
