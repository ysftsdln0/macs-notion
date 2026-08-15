'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, type Actor, type Permission } from '@/lib/auth/policy'
import { slugify } from '@/lib/slug'
import { recordActivity } from '@/lib/activity'

const permissionSchema = z.enum([
  'CONTENT_READ_ALL',
  'CONTENT_WRITE_ALL',
  'BUDGET_READ_ALL',
  'BUDGET_WRITE_ALL',
  'MEMBER_MANAGE',
  'INVITE_MANAGE',
  'CHANNEL_CREATE',
  'CHANNEL_MANAGE_ALL',
  'TRASH_MANAGE',
])

// Kataloğa yeni bir izin eklenip yukarıdaki listeye yazılmazsa bu satır
// derlenmez: `Permission` artık enum'un çıkarımını kapsamaz ve tip `never`
// olur. Panelden dağıtılamayan bir izin sessizce ortada kalamaz.
const permissionsAreExhaustive: Permission extends z.infer<typeof permissionSchema>
  ? true
  : never = true
void permissionsAreExhaustive

const nameSchema = z.string().trim().min(2, 'Rol adı en az 2 karakter olmalı').max(40)
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Renk #rrggbb biçiminde olmalı')
  .nullable()

/**
 * Rol yönetimi bir izin DEĞİL, `globalRole === 'SUPERADMIN'` kapısıdır
 * (`policy.ts`'teki `role:manage`). İzinleri dağıtan yetkinin kendisi
 * ayarlanabilir bir izin olsaydı, onu taşıyan herkes kendine her şeyi
 * yazabilirdi — sistemi tanımlayan kural sistemin dışında durmalı.
 */
async function authorizeRoleManage({ actor }: { actor: Actor }) {
  return { allowed: can(actor, 'role:manage', { kind: 'role' }) }
}

/**
 * `name` ve `slug` tekil kısıtları kullanıcı için aynı hatayı üretir: aynı adla
 * ikinci bir rol. P2002 dışındaki her şey olduğu gibi yukarı gider.
 */
function toRoleError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return actionError('CONFLICT', { name: 'Bu adda bir rol zaten var.' })
  }
  return error
}

export const createRole = defineAction({
  input: z.object({
    name: nameSchema,
    color: colorSchema,
    permissions: z.array(permissionSchema),
  }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    let role
    try {
      role = await db.$transaction(
        async (tx) => {
          // position tekil kısıt taşıyor: sayım ve yazım aynı transaction'da
          // olmalı, yoksa iki eş zamanlı oluşturma aynı sayıyı alır.
          const last = await tx.role.findFirst({
            orderBy: { position: 'desc' },
            select: { position: true },
          })
          return tx.role.create({
            data: {
              name: input.name,
              slug: slugify(input.name),
              color: input.color,
              permissions: input.permissions,
              position: (last?.position ?? 0) + 1,
            },
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      throw toRoleError(error)
    }

    await recordActivity(db, {
      actorId: actor.id,
      verb: 'role.created',
      entityType: 'Role',
      entityId: role.id,
      meta: { name: role.name },
    })
    return { id: role.id }
  },
})

export const updateRole = defineAction({
  input: z.object({
    roleId: z.string().cuid(),
    name: nameSchema,
    color: colorSchema,
    permissions: z.array(permissionSchema),
  }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const existing = await db.role.findUnique({ where: { id: input.roleId } })
    if (!existing) throw actionError('NOT_FOUND')
    // Sistem rolünün izinleri değişebilir — kulübün YK'ya ne verdiğini zamanla
    // değiştirmesi meşru. Adı değişemez: kod ve seed onu adıyla tanıyor.
    if (existing.isSystem && input.name !== existing.name) {
      throw actionError('CONFLICT', { name: 'Sistem rolünün adı değiştirilemez.' })
    }

    try {
      await db.role.update({
        where: { id: input.roleId },
        data: {
          name: input.name,
          slug: slugify(input.name),
          color: input.color,
          permissions: input.permissions,
        },
      })
    } catch (error) {
      throw toRoleError(error)
    }

    await recordActivity(db, {
      actorId: actor.id,
      verb: 'role.updated',
      entityType: 'Role',
      entityId: input.roleId,
      meta: { name: input.name },
    })
    return { id: input.roleId }
  },
})

export const deleteRole = defineAction({
  input: z.object({ roleId: z.string().cuid() }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const existing = await db.role.findUnique({ where: { id: input.roleId } })
    if (!existing) throw actionError('NOT_FOUND')
    if (existing.isSystem) {
      throw actionError('CONFLICT', { name: 'Sistem rolü silinemez.' })
    }

    // UserRole.roleId onDelete: Cascade — atamalar rolle birlikte gider.
    await db.role.delete({ where: { id: input.roleId } })

    await recordActivity(db, {
      actorId: actor.id,
      verb: 'role.deleted',
      entityType: 'Role',
      entityId: input.roleId,
      meta: { name: existing.name },
    })
    return { id: input.roleId }
  },
})

export const assignRole = defineAction({
  input: z.object({ userId: z.string().cuid(), roleId: z.string().cuid() }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const [user, role] = await Promise.all([
      db.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
      db.role.findUnique({ where: { id: input.roleId }, select: { id: true, name: true } }),
    ])
    if (!user || !role) throw actionError('NOT_FOUND')

    // Aynı rolü ikinci kez vermek hata değil, sonuçsuz bir işlemdir: arayüzde
    // çift tıklama kullanıcıya kırmızı bir mesaj göstermemeli.
    await db.userRole.upsert({
      where: { userId_roleId: { userId: input.userId, roleId: input.roleId } },
      create: { userId: input.userId, roleId: input.roleId, grantedById: actor.id },
      update: {},
    })

    await recordActivity(db, {
      actorId: actor.id,
      verb: 'role.assigned',
      entityType: 'User',
      entityId: input.userId,
      meta: { role: role.name },
    })
    return { id: input.userId }
  },
})

export const unassignRole = defineAction({
  input: z.object({ userId: z.string().cuid(), roleId: z.string().cuid() }),
  getActor,
  authorize: authorizeRoleManage,
  handler: async ({ actor, input }) => {
    const role = await db.role.findUnique({
      where: { id: input.roleId },
      select: { name: true },
    })
    if (!role) throw actionError('NOT_FOUND')

    await db.userRole.deleteMany({
      where: { userId: input.userId, roleId: input.roleId },
    })

    await recordActivity(db, {
      actorId: actor.id,
      verb: 'role.unassigned',
      entityType: 'User',
      entityId: input.userId,
      meta: { role: role.name },
    })
    return { id: input.userId }
  },
})
