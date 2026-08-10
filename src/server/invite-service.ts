import { db } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { recordActivity } from '@/lib/activity'
import { fail, ok, type Result } from '@/lib/result'

/**
 * Bu dosya BİLEREK 'use server' taşımaz. `claimInvite`/`applyInvite` token
 * veya oturum kontrolü yapmadan davranır — sahiplenme ve uygulama kararı
 * çağıranın sorumluluğundadır. 'use server' bu dosyada olsaydı her ikisi de
 * herkese açık bir RPC uç noktası olur, `applyInvite(inviteId, userId)`
 * çağıranın seçtiği herhangi bir userId'yi ADMIN yapabilirdi.
 */

/**
 * Rezervasyon TTL'i. `signIn` daveti bu süre için dolaşımdan çıkarır ama
 * KALICI olarak tüketmez — `createUser` bu pencere içinde hiç çalışmazsa
 * (adaptör hatası, ağ kopması, kullanıcı Google ekranında vazgeçer) davet
 * TTL sonunda kendiliğinden yeniden rezerve edilebilir hale gelir. 5 dakika,
 * gerçekçi bir OAuth gidiş-dönüşü için bolca pay bırakırken bir başarısızlığı
 * sonsuza kadar kilitlememek için yeterince kısa.
 */
export const INVITE_RESERVATION_TTL_MS = 5 * 60 * 1000

/**
 * Daveti ATOMİK olarak REZERVE eder — KALICI sahiplenme değildir. Tek
 * `updateMany`, tüm geçerlilik koşulları `where` içinde: iki eşzamanlı
 * istekten yalnızca biri `count === 1` alır, davet o an itibariyle
 * dolaşımdan çıkar. Ayrı bir "önce oku, sonra yaz" adımı bırakılmaz —
 * aradaki boşluk bir daveti birden çok hesaba açar.
 *
 * Kalıcı tüketim burada YAPILMAZ: `signIn` callback'i bu fonksiyonu
 * `createUser`'dan ÖNCE çağırır ve `createUser` (adaptör hatası dahil)
 * hiç tamamlanmayabilir. Rezervasyon `applyInvite` çağrılıp
 * `usedAt` set edilene kadar geçicidir; TTL'i geçmiş, hiç kalıcı hale
 * gelmemiş bir rezervasyon aşağıdaki `OR` koşulu sayesinde yeniden
 * rezerve edilebilir — davet kalıcı olarak yanmaz.
 */
export async function claimInvite(tokenHash: string): Promise<boolean> {
  const now = new Date()
  const reservationCutoff = new Date(now.getTime() - INVITE_RESERVATION_TTL_MS)
  const reserved = await db.invite.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
      OR: [{ reservedAt: null }, { reservedAt: { lt: reservationCutoff } }],
    },
    data: { reservedAt: now },
  })
  return reserved.count === 1
}

/**
 * Rezerve edilmiş davetin etkilerini uygular VE rezervasyonu kalıcı
 * tüketime çevirir (`usedAt`). Bu iki adım aynı transaction içinde: rol/
 * kanal/activity yazımlarından biri başarısız olursa `usedAt` da set
 * edilmez, davet TTL sonunda yeniden rezerve edilebilir kalır.
 *
 * `usedAt: null` koşullu `updateMany`, `claimInvite` ile aynı atomik
 * desenle korunur: iki eşzamanlı `applyInvite` çağrısından (ör. TTL
 * sona erip davet yeniden rezerve edildikten sonra gecikmiş bir eski
 * çağrı buraya geç ulaşırsa) yalnızca biri kalıcı tüketimi kazanır,
 * diğeri `CONFLICT` alır. Bu fonksiyon kendi başına bir yetki sınırı
 * DEĞİLDİR — yalnızca `claimInvite` daveti gerçekten rezerve ettikten
 * sonra çağrılmalıdır.
 */
export async function applyInvite(
  inviteId: string,
  userId: string,
): Promise<Result<{ channelId: string | null }>> {
  const invite = await db.invite.findUnique({ where: { id: inviteId } })
  if (!invite) return fail('NOT_FOUND')

  const confirmed = await db.$transaction(async (tx) => {
    const claim = await tx.invite.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedByUserId: userId, usedAt: new Date() },
    })
    if (claim.count !== 1) return false

    if (invite.globalRole === 'ADMIN') {
      await tx.user.update({ where: { id: userId }, data: { globalRole: 'ADMIN' } })
    }
    if (invite.channelId) {
      await tx.channelMember.upsert({
        where: { channelId_userId: { channelId: invite.channelId, userId } },
        create: { channelId: invite.channelId, userId, channelRole: invite.channelRole },
        update: {},
      })
    }
    await recordActivity(tx, {
      actorId: userId, verb: 'invite.accepted',
      entityType: 'Invite', entityId: invite.id,
    })
    return true
  })

  if (!confirmed) return fail('CONFLICT')
  return ok({ channelId: invite.channelId })
}

/**
 * Zaten giriş yapmış kullanıcı için davet kullanımı (ikinci bir kanala davet).
 * Action değildir: yetki kontrolü token'ın kendisidir. Önce sahiplenir,
 * sonra uygular — sahiplenme başarısız olursa (CONFLICT) `applyInvite` hiç
 * çağrılmaz.
 */
export async function consumeInvite(
  token: string,
  userId: string,
): Promise<Result<{ channelId: string | null }>> {
  const tokenHash = hashInviteToken(token)
  const invite = await db.invite.findUnique({ where: { tokenHash } })
  if (!invite) return fail('NOT_FOUND')
  if (!(await claimInvite(tokenHash))) return fail('CONFLICT')
  return applyInvite(invite.id, userId)
}
