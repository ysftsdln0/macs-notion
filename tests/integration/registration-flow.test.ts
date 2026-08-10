import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterUser } from 'next-auth/adapters'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'
import { createInviteToken } from '@/lib/auth/invite-token'
import { INVITE_COOKIE } from '@/lib/auth/invite-cookie'

/**
 * BU DOSYA `@/lib/auth/config`'İ BİLEREK MOCK'LAMAZ. Repodaki her diğer test
 * `vi.mock('@/lib/auth/config', () => ({ auth: vi.fn() }))` yapıyor — final
 * whole-branch review'ın C3 bulgusu tam olarak bu: `signIn`/`createUser`
 * callback'leri hiçbir testte hiç çalışmadı, bu yüzden C1 (şema/adaptör
 * uyumsuzluğu) ve C2 (/onboarding 500) 15 task review + 107 yeşil testten
 * kaçtı.
 *
 * Mock'lanan TEK şey `next/headers`'ın `cookies()`'i: bu bir platform
 * ilkeli, gerçek bir Next.js isteği/render'ı dışında (bu vitest süreci
 * gibi) çağrılamaz — test edilen modül (`@/lib/auth/config`) DEĞİL.
 */
const { cookieStore } = vi.hoisted(() => ({ cookieStore: new Map<string, string>() }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      cookieStore.set(name, value)
    },
    delete: (name: string) => {
      cookieStore.delete(name)
    },
  }),
}))

const { authConfig, adapter } = await import('@/lib/auth/config')

beforeEach(async () => {
  await resetDb()
  cookieStore.clear()
})

describe('kayıt yolu — signIn + adapter.createUser + events.createUser (C1 + C3: hiçbir şey mock değil)', () => {
  it('geçerli davetle Google profili gönderildiğinde gerçek bir User satırı, doğru rol ve kanal üyeliği oluşur', async () => {
    const founder = await db.user.create({ data: { name: 'Kurucu', globalRole: 'ADMIN' } })
    const channel = await db.channel.create({
      data: { name: 'Genel', slug: 'genel', createdById: founder.id },
    })
    const { token, tokenHash } = createInviteToken()
    await db.invite.create({
      data: {
        tokenHash,
        globalRole: 'ADMIN',
        channelId: channel.id,
        expiresAt: new Date(Date.now() + 7 * 864e5),
        createdById: founder.id,
      },
    })
    cookieStore.set(INVITE_COOKIE, token)

    // @auth/core'un bir OIDC sağlayıcı profilinden ürettiği ham şekil.
    const googleProfile: AdapterUser = {
      id: 'google-sub-123',
      name: 'Yeni Üye',
      email: 'yeni@x.com',
      image: 'https://lh3.googleusercontent.com/a/probe',
      emailVerified: null,
    }

    // 1) signIn callback'i — GERÇEK, mock değil. Daveti rezerve eder
    // (kalıcı tüketmez — bkz. invite-service.ts `claimInvite`).
    const signInResult = await authConfig.callbacks?.signIn?.({
      user: googleProfile,
      account: null,
    })
    expect(signInResult).toBe(true)

    // 2) @auth/core'un `handle-login.js`'te GERÇEKTEN yaptığı çağrı (final
    // whole-branch review, C1): `user = await createUser({ ...profile,
    // emailVerified: null })`. Düzeltilmemiş şemada (avatarUrl var, image/
    // emailVerified yok) bu satır `PrismaClientValidationError: Unknown
    // argument 'image'` fırlatır — bu test o hatayı gerçek şemaya karşı
    // tetikler, mock'lamaz.
    const createdUser = await adapter.createUser?.(googleProfile)
    if (!createdUser) throw new Error('adapter.createUser tanımsız döndü')
    expect(createdUser.id).toBeTruthy()

    // 3) events.createUser — GERÇEK, mock değil. Rezervasyonu kalıcı
    // tüketime çevirir, rolü ve kanal üyeliğini bağlar.
    await authConfig.events?.createUser?.({ user: createdUser })

    const dbUser = await db.user.findUniqueOrThrow({ where: { id: createdUser.id } })
    expect(dbUser.email).toBe('yeni@x.com')
    expect(dbUser.image).toBe(googleProfile.image)
    expect(dbUser.globalRole).toBe('ADMIN')

    const membership = await db.channelMember.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: createdUser.id } },
    })
    expect(membership).not.toBeNull()

    const invite = await db.invite.findUniqueOrThrow({ where: { tokenHash } })
    expect(invite.usedByUserId).toBe(createdUser.id)
    expect(invite.usedAt).not.toBeNull()
  })

  it('davet çerezi yoksa signIn reddeder ve hiçbir kullanıcı oluşmaz', async () => {
    const noInviteProfile: AdapterUser = {
      id: 'x', name: 'Kimliksiz', email: 'yok@x.com', emailVerified: null,
    }

    const result = await authConfig.callbacks?.signIn?.({ user: noInviteProfile, account: null })

    expect(result).toBe(false)
    expect(await db.user.count()).toBe(0)
  })

  it('davet TTL sonunda serbest kalır: rezervasyon sonrası kayıt tamamlanmazsa ikinci deneme yine de girebilir', async () => {
    const founder = await db.user.create({ data: { name: 'Kurucu', globalRole: 'ADMIN' } })
    const { token, tokenHash } = createInviteToken()
    await db.invite.create({
      data: { tokenHash, expiresAt: new Date(Date.now() + 7 * 864e5), createdById: founder.id },
    })
    cookieStore.set(INVITE_COOKIE, token)

    const firstAttempt: AdapterUser = {
      id: 'sub-1', name: 'İlk Deneme', email: 'ilk@x.com', emailVerified: null,
    }
    const reserved = await authConfig.callbacks?.signIn?.({ user: firstAttempt, account: null })
    expect(reserved).toBe(true)

    // createUser hiç çalışmaz (adaptör hatası, ağ kopması...). Davet kalıcı
    // tüketilmemiş kalır.
    let invite = await db.invite.findUniqueOrThrow({ where: { tokenHash } })
    expect(invite.usedAt).toBeNull()

    // TTL'i geçmiş gibi göster.
    await db.invite.updateMany({
      where: { tokenHash },
      data: { reservedAt: new Date(Date.now() - 6 * 60 * 1000) },
    })

    const secondAttempt: AdapterUser = {
      id: 'sub-2', name: 'İkinci Deneme', email: 'ikinci@x.com', emailVerified: null,
    }
    const reservedAgain = await authConfig.callbacks?.signIn?.({ user: secondAttempt, account: null })
    expect(reservedAgain).toBe(true)

    const createdUser = await adapter.createUser?.(secondAttempt)
    if (!createdUser) throw new Error('adapter.createUser tanımsız döndü')
    await authConfig.events?.createUser?.({ user: createdUser })

    invite = await db.invite.findUniqueOrThrow({ where: { tokenHash } })
    expect(invite.usedByUserId).toBe(createdUser.id)
    expect(invite.usedAt).not.toBeNull()
    expect(await db.user.count()).toBe(2) // founder + ikinci deneme
  })
})
