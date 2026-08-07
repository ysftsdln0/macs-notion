import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Session } from 'next-auth'
import { db } from '@/lib/db'

vi.mock('@/lib/auth/config', () => ({ auth: vi.fn() }))

import { auth } from '@/lib/auth/config'
import { getActor, toActor } from '@/lib/auth/session'

// `auth`'un gerçek tipi Next.js middleware imzalarıyla aşırı yüklenmiş
// (overloaded); test amaçlı sahtesi tek imzalı basit bir fonksiyondur.
const mockedAuth = auth as unknown as Mock<() => Promise<Session | null>>

beforeEach(async () => {
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
  mockedAuth.mockReset()
})

describe('toActor', () => {
  it('kullanıcı ve üyeliklerinden Actor üretir', async () => {
    const user = await db.user.create({
      data: { name: 'Efe', globalRole: 'ADMIN' },
    })
    const channel = await db.channel.create({
      data: { name: 'Proje', slug: 'proje', createdById: user.id },
    })
    await db.channelMember.create({
      data: { userId: user.id, channelId: channel.id, channelRole: 'LEAD' },
    })

    const loaded = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: true },
    })

    expect(toActor(loaded)).toEqual({
      id: user.id,
      globalRole: 'ADMIN',
      isActive: true,
      memberships: [{ channelId: channel.id, channelRole: 'LEAD' }],
    })
  })
})

describe('getActor', () => {
  it('pasif kullanıcı için null döner', async () => {
    const user = await db.user.create({
      data: { name: 'Pasif Kullanıcı', isActive: false },
    })
    const session: Session = {
      user: { id: user.id, name: user.name, email: user.email, image: user.avatarUrl },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    }
    mockedAuth.mockResolvedValue(session)

    await expect(getActor()).resolves.toBeNull()
  })
})
