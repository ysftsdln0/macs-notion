'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, type GlobalRole } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'

type MemberRow = { id: string; globalRole: GlobalRole; isActive: boolean }

async function assertMemberExists(tx: Prisma.TransactionClient, userId: string): Promise<MemberRow> {
  const target = await tx.user.findUnique({ where: { id: userId } })
  if (!target) throw actionError('NOT_FOUND')
  return target
}

// Bir üyeyi havuzdan çıkarmak (pasifleştirmek ya da SUPERADMIN'den
// düşürmek), sistemin son AKTİF SUPERADMIN'ini kaybetmesine yol açamaz —
// aksi halde kimse rol yönetemez (role:manage, member:updateRole) hale
// gelir ve içeriden kurtarılamaz. Pasif SUPERADMIN'ler sayılmaz: isActive
// gate'i (policy.ts) onları zaten her yetkiden mahrum bırakıyor,
// dolayısıyla onları "hâlâ yönetebilen superadmin" saymak yanlış güvenlik
// hissi verir ve gerçek bir açık bırakır.
//
// `target` zaten aktif bir SUPERADMIN değilse çıkış yapılır: onu havuzdan
// çıkarmak (deaktivasyon ya da düşürme) mevcut aktif superadmin sayısını
// değiştirmez, risk yok.
//
// `tx` alması bilinçli: sayım ve yazım AYNI transaction içinde olmalı —
// aksi halde son iki aktif superadmin'i aynı anda birbirinden çıkarmaya
// çalışan iki istek (deactivateMember + deactivateMember, deactivateMember
// + updateMemberRole, ya da ikisi de updateMemberRole) ikisi de "en az bir
// başka aktif superadmin var" okuyup ikisi de geçebilir — bu klasik "write
// skew": her iki transaction'ın kararı da diğerinin YAZDIĞI satıra bağlı,
// ama hiçbiri diğerinin yazdığı satırı kendi sorgusunda hedef olarak
// hariç tutmaz. Serializable izolasyon (runAdminGuardedChange) bu deseni
// veritabanı seviyesinde yakalar (bkz. channels.ts'teki assertNotLastLead
// ile aynı yarış deseni, iki taraflı hale genelleştirilmiş).
//
// Korunan havuz ADMIN değil SUPERADMIN'dir. Üç değerli enum'da bu ayrım
// zorunlu: ADMIN havuzunun boşalması geri alınabilir (SUPERADMIN yeniden
// atar), SUPERADMIN havuzunun boşalması sistemi rol yönetimi yapılamaz
// halde bırakır.
async function assertActiveSuperadminSurvivesWithout(
  tx: Prisma.TransactionClient,
  target: MemberRow,
): Promise<void> {
  if (target.globalRole !== 'SUPERADMIN' || !target.isActive) return
  const remaining = await tx.user.count({
    where: { globalRole: 'SUPERADMIN', isActive: true, id: { not: target.id } },
  })
  if (remaining === 0) {
    throw actionError('CONFLICT', { globalRole: 'Sistemde en az bir aktif superadmin kalmalı.' })
  }
}

// Serializable izolasyon, iki eş zamanlı superadmin-havuzu değişikliği
// çakıştığında Postgres'in birini commit'te reddetmesini sağlar (kaybeden
// P2034 alır). Bu, assertActiveSuperadminSurvivesWithout'un "count === 0"
// kontrolünün kaçırabileceği yarışları veritabanı seviyesinde kapatır
// (bkz. channels.ts'teki runMembershipChange). deactivateMember ve
// updateMemberRole ikisi de aynı superadmin havuzunu koruduğu için aynı
// sarmalayıcıyı paylaşır.
async function runAdminGuardedChange<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw actionError('CONFLICT', { globalRole: 'Aynı anda başka bir değişiklik yapıldı. Tekrar dene.' })
    }
    throw error
  }
}

export const deactivateMember = defineAction({
  input: z.object({ userId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => {
    // Hedefin kademesi bilinmeden karar verilemez: "ADMIN, SUPERADMIN'e
    // dokunamaz" kuralı buna dayanıyor.
    const target = await db.user.findUnique({
      where: { id: input.userId },
      select: { globalRole: true },
    })
    if (!target) return { allowed: false, code: 'NOT_FOUND' }
    return {
      allowed: can(actor, 'member:deactivate', {
        kind: 'member', id: input.userId, targetGlobalRole: target.globalRole,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    await runAdminGuardedChange(async (tx) => {
      const target = await assertMemberExists(tx, input.userId)
      await assertActiveSuperadminSurvivesWithout(tx, target)
      await tx.user.update({ where: { id: input.userId }, data: { isActive: false } })
      // Oturumların silinmesi zorunludur: aksi halde pasife alınan kullanıcı
      // mevcut çerezle çalışmaya devam eder.
      await tx.session.deleteMany({ where: { userId: input.userId } })
      await recordActivity(tx, {
        actorId: actor.id, verb: 'member.deactivated',
        entityType: 'User', entityId: input.userId,
      })
    })
    return { id: input.userId }
  },
})

// deactivateMember'ın tersi. assertMemberExists'i aynen paylaşır (NOT_FOUND
// aynı şekilde davranır), ama assertActiveSuperadminSurvivesWithout'u
// ÇAĞIRMAZ: bu işlem havuzu yalnızca büyütür, aktif superadmin tavanını
// asla ihlal edemez (bkz. policy.ts'teki 'member:reactivate' yorumu). Bu
// yüzden Serializable izolasyona da gerek yok — burada korunacak bir
// invariant yok, iki eş zamanlı etkinleştirme birbirine karışsa bile sonuç
// aynı: isActive: true.
export const reactivateMember = defineAction({
  input: z.object({ userId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => {
    // Hedefin kademesi bilinmeden karar verilemez: "ADMIN, SUPERADMIN'e
    // dokunamaz" kuralı buna dayanıyor.
    const target = await db.user.findUnique({
      where: { id: input.userId },
      select: { globalRole: true },
    })
    if (!target) return { allowed: false, code: 'NOT_FOUND' }
    return {
      allowed: can(actor, 'member:reactivate', {
        kind: 'member', id: input.userId, targetGlobalRole: target.globalRole,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    await db.$transaction(async (tx) => {
      await assertMemberExists(tx, input.userId)
      await tx.user.update({ where: { id: input.userId }, data: { isActive: true } })
      await recordActivity(tx, {
        actorId: actor.id, verb: 'member.reactivated',
        entityType: 'User', entityId: input.userId,
      })
    })
    return { id: input.userId }
  },
})

export const updateMemberRole = defineAction({
  input: z.object({
    userId: z.string().cuid(),
    globalRole: z.enum(['SUPERADMIN', 'ADMIN', 'MEMBER']),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    // Hedefin kademesi bilinmeden karar verilemez: "ADMIN, SUPERADMIN'e
    // dokunamaz" kuralı buna dayanıyor.
    const target = await db.user.findUnique({
      where: { id: input.userId },
      select: { globalRole: true },
    })
    if (!target) return { allowed: false, code: 'NOT_FOUND' }
    return {
      allowed: can(actor, 'member:updateRole', {
        kind: 'member', id: input.userId, targetGlobalRole: target.globalRole,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    await runAdminGuardedChange(async (tx) => {
      const target = await assertMemberExists(tx, input.userId)
      if (input.globalRole === 'MEMBER') {
        await assertActiveSuperadminSurvivesWithout(tx, target)
      }
      await tx.user.update({ where: { id: input.userId }, data: { globalRole: input.globalRole } })
      await recordActivity(tx, {
        actorId: actor.id, verb: 'member.roleChanged',
        entityType: 'User', entityId: input.userId, meta: { globalRole: input.globalRole },
      })
    })
    return { id: input.userId }
  },
})
