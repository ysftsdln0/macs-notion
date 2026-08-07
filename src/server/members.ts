'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'

export const deactivateMember = defineAction({
  input: z.object({ userId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => ({
    allowed: can(actor, 'member:deactivate', { kind: 'member', id: input.userId }),
  }),
  handler: async ({ actor, input }) => {
    await db.$transaction(async (tx) => {
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

// Sistemin son AKTİF ADMIN'i MEMBER'a düşürülemez — aksi halde kimse
// yönetim işlemi yapamaz hale gelir (bkz. member:deactivate'teki "admin
// kendini pasife alamaz" kuralıyla aynı gerekçe). Pasif ADMIN'ler sayılmaz:
// isActive gate'i (policy.ts) onları zaten her yetkiden mahrum bırakıyor,
// dolayısıyla onları "hâlâ yönetebilen admin" saymak yanlış güvenlik hissi
// verir ve gerçek bir açık bırakır.
//
// `tx` alması bilinçli: sayım ve yazım AYNI transaction içinde olmalı —
// aksi halde son iki aktif admin'i aynı anda birbirini düşürmeye çalışan
// iki istek ikisi de "count > 1" okuyup ikisi de geçebilir (bkz.
// channels.ts'teki assertNotLastLead ile aynı yarış deseni).
async function assertNotLastActiveAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
  nextRole: 'ADMIN' | 'MEMBER',
): Promise<void> {
  if (nextRole === 'ADMIN') return
  const target = await tx.user.findUnique({ where: { id: userId } })
  if (!target || target.globalRole !== 'ADMIN' || !target.isActive) return
  const activeAdminCount = await tx.user.count({ where: { globalRole: 'ADMIN', isActive: true } })
  if (activeAdminCount <= 1) {
    throw actionError('CONFLICT', { globalRole: 'Sistemde en az bir aktif admin kalmalı.' })
  }
}

// Serializable izolasyon, iki eş zamanlı rol değişikliği çakıştığında
// Postgres'in birini commit'te reddetmesini sağlar (kaybeden P2034 alır).
// Bu, assertNotLastActiveAdmin'in "count <= 1" kontrolünün kaçırabileceği
// yarışları veritabanı seviyesinde kapatır (bkz. channels.ts'teki
// runMembershipChange).
async function runRoleChange<T>(
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

export const updateMemberRole = defineAction({
  input: z.object({ userId: z.string().cuid(), globalRole: z.enum(['ADMIN', 'MEMBER']) }),
  getActor,
  authorize: async ({ actor, input }) => ({
    allowed: can(actor, 'member:updateRole', { kind: 'member', id: input.userId }),
  }),
  handler: async ({ actor, input }) => {
    await runRoleChange(async (tx) => {
      await assertNotLastActiveAdmin(tx, input.userId, input.globalRole)
      await tx.user.update({ where: { id: input.userId }, data: { globalRole: input.globalRole } })
      await recordActivity(tx, {
        actorId: actor.id, verb: 'member.roleChanged',
        entityType: 'User', entityId: input.userId, meta: { globalRole: input.globalRole },
      })
    })
    return { id: input.userId }
  },
})
