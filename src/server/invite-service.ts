import { Prisma } from '@prisma/client'
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

export const INVITE_RESERVATION_TTL_MS = 5 * 60 * 1000

/**
 * Davete bir kullanım slotu REZERVE eder — kalıcı sahiplenme değildir.
 *
 * Kontenjan kontrolü "say, sonra ekle" olduğu için tek bir koşullu updateMany
 * ile ifade edilemez; iki eşzamanlı istek aynı boş slotu okuyabilirdi. Bu
 * yüzden transaction Invite satırını FOR UPDATE ile kilitler: aynı davete
 * gelen istekler serileşir, farklı davetler birbirini beklemez.
 *
 * Rezervasyonun TTL'i ayrı bir alan ya da temizlik işi değil, aşağıdaki sayım
 * sorgusunun WHERE'idir: uçuşta olmayan (TTL'i geçmiş) ve kalıcılaşmamış bir
 * satır kontenjandan otomatik düşer. Denormalize bir sayaç bunu yapamazdı —
 * hangi artışın hangi rezervasyona ait olduğunu bilmediği için TTL dolduğunda
 * neyi geri düşüreceğini de bilemezdi.
 */
export async function claimInvite(
  tokenHash: string,
): Promise<Result<{ redemptionId: string; inviteId: string }>> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Invite" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
    `
    const lockedId = locked[0]?.id
    if (!lockedId) return fail('NOT_FOUND')

    const invite = await tx.invite.findUniqueOrThrow({ where: { id: lockedId } })
    const now = new Date()
    if (invite.disabledAt) return fail('CONFLICT')
    if (invite.expiresAt && invite.expiresAt <= now) return fail('CONFLICT')

    if (invite.maxUses !== null) {
      const cutoff = new Date(now.getTime() - INVITE_RESERVATION_TTL_MS)
      const live = await tx.inviteRedemption.count({
        where: {
          inviteId: invite.id,
          OR: [{ redeemedAt: { not: null } }, { reservedAt: { gt: cutoff } }],
        },
      })
      if (live >= invite.maxUses) return fail('CONFLICT')
    }

    const redemption = await tx.inviteRedemption.create({
      data: { inviteId: invite.id, reservedAt: now },
    })
    return ok({ redemptionId: redemption.id, inviteId: invite.id })
  })
}

/**
 * Rezerve edilmiş bir slotu kalıcı tüketime çevirir VE davetin etkilerini
 * (kademe, kanal üyeliği, activity) aynı transaction içinde uygular. Biri
 * başarısız olursa slot da kalıcılaşmaz; rezervasyon TTL sonunda serbest
 * kalır, davet yanmaz.
 *
 * `redemptionId` verilmezse satır aranır: `signIn` ile `createUser` arasında
 * çerezdeki token dışında taşınabilen bir durum yok, çok kullanımlı davette
 * ise aynı anda birden çok açık rezervasyon olabilir. Koşullu updateMany
 * (`userId: null`) hangi çağrının hangi satırı kazandığını belirler.
 *
 * Bu fonksiyon kendi başına bir yetki sınırı DEĞİLDİR — yalnızca `claimInvite`
 * slotu gerçekten rezerve ettikten sonra çağrılmalıdır.
 */
export async function applyInvite(
  inviteId: string,
  userId: string,
  redemptionId?: string,
): Promise<Result<{ channelId: string | null }>> {
  const invite = await db.invite.findUnique({ where: { id: inviteId } })
  if (!invite) return fail('NOT_FOUND')

  try {
    const confirmed = await db.$transaction(async (tx) => {
      const candidates = redemptionId
        ? [{ id: redemptionId }]
        : await tx.inviteRedemption.findMany({
            where: {
              inviteId,
              userId: null,
              redeemedAt: null,
              reservedAt: { gt: new Date(Date.now() - INVITE_RESERVATION_TTL_MS) },
            },
            orderBy: { reservedAt: 'asc' },
            select: { id: true },
          })

      let claimed = false
      for (const candidate of candidates) {
        const result = await tx.inviteRedemption.updateMany({
          where: { id: candidate.id, userId: null, redeemedAt: null },
          data: { userId, redeemedAt: new Date() },
        })
        if (result.count === 1) {
          claimed = true
          break
        }
      }
      if (!claimed) return false

      // Davetin taşıdığı kademe ne ise o uygulanır. Tek bir enum değerini
      // isimle kontrol etmek (`=== 'ADMIN'`), enum üçüncü kademeyi kazandığında
      // sessizce yetki düşüren bir desendi.
      if (invite.globalRole !== 'MEMBER') {
        await tx.user.update({
          where: { id: userId },
          data: { globalRole: invite.globalRole },
        })
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
  } catch (error) {
    // Aynı kullanıcı için ikinci bir slot: @@unique([inviteId, userId]).
    // Eşzamanlı çift tıkta düşer; çağıran zaten daveti kullanmış demektir.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return ok({ channelId: invite.channelId })
    }
    throw error
  }
}

/**
 * Zaten giriş yapmış kullanıcı için davet kullanımı (ikinci bir kanala davet).
 * Action değildir: yetki kontrolü token'ın kendisidir.
 *
 * Kullanıcı bu daveti daha önce kullandıysa slot yakılmadan başarı döner —
 * çift tık kontenjan tüketmemeli. Uygulama başarısız olursa rezervasyon
 * TTL'i beklemeden serbest bırakılır.
 */
export async function consumeInvite(
  token: string,
  userId: string,
): Promise<Result<{ channelId: string | null }>> {
  const tokenHash = hashInviteToken(token)
  const invite = await db.invite.findUnique({ where: { tokenHash } })
  if (!invite) return fail('NOT_FOUND')

  const existing = await db.inviteRedemption.findUnique({
    where: { inviteId_userId: { inviteId: invite.id, userId } },
  })
  if (existing) return ok({ channelId: invite.channelId })

  const claimed = await claimInvite(tokenHash)
  if (!claimed.ok) return claimed

  const applied = await applyInvite(invite.id, userId, claimed.data.redemptionId)
  if (!applied.ok) {
    await db.inviteRedemption.deleteMany({
      where: { id: claimed.data.redemptionId, userId: null },
    })
  }
  return applied
}
