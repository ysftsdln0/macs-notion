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
 * Daveti ATOMİK olarak sahiplenir. Tek `updateMany`, tüm geçerlilik koşulları
 * `where` içinde: iki eşzamanlı istekten yalnızca biri `count === 1` alır.
 * Ayrı bir "önce oku, sonra yaz" adımı bırakılmaz — aradaki boşluk bir daveti
 * birden çok hesaba açar.
 */
export async function claimInvite(tokenHash: string): Promise<boolean> {
  const claimed = await db.invite.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  })
  return claimed.count === 1
}

/**
 * Sahiplenilmiş davetin etkilerini uygular. Sahiplenme ile ayrı tutulur:
 * kullanıcı satırı ancak kabul kararından SONRA var olur. Bu fonksiyon
 * kendi başına bir yetki sınırı DEĞİLDİR — yalnızca `claimInvite` daveti
 * gerçekten sahiplendikten sonra çağrılmalıdır.
 */
export async function applyInvite(
  inviteId: string,
  userId: string,
): Promise<Result<{ channelId: string | null }>> {
  const invite = await db.invite.findUnique({ where: { id: inviteId } })
  if (!invite) return fail('NOT_FOUND')

  await db.$transaction(async (tx) => {
    await tx.invite.update({ where: { id: invite.id }, data: { usedByUserId: userId } })
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
  })

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
