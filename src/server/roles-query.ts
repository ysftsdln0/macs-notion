/**
 * Bu dosya BİLEREK 'use server' taşımaz — `channels-query.ts`'teki gerekçenin
 * aynısı: 'use server' olsaydı export edilen her fonksiyon herkese açık bir RPC
 * uç noktası olurdu ve çağıran, yetki kararını POST gövdesinde kendisi
 * uydurabilirdi. Yetki kontrolü çağıran sayfada, `can(actor, 'role:manage', …)`
 * ile yapılır.
 */

import { db } from '@/lib/db'
import type { Permission } from '@/lib/auth/policy'

export type RoleSummary = {
  id: string
  name: string
  slug: string
  color: string | null
  permissions: Permission[]
  isSystem: boolean
  position: number
  memberCount: number
}

export type RoleDetail = RoleSummary & {
  members: { id: string; name: string }[]
}

export async function listRoles(): Promise<RoleSummary[]> {
  const roles = await db.role.findMany({
    orderBy: { position: 'asc' },
    include: { _count: { select: { members: true } } },
  })
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    slug: role.slug,
    color: role.color,
    permissions: role.permissions,
    isSystem: role.isSystem,
    position: role.position,
    memberCount: role._count.members,
  }))
}

export async function loadRole(id: string): Promise<RoleDetail | null> {
  const role = await db.role.findUnique({
    where: { id },
    include: {
      members: {
        // Pasif üyeler de listelenir: rolü kimden alacağını bilmek yönetim işidir.
        select: { user: { select: { id: true, name: true } } },
        orderBy: { grantedAt: 'asc' },
      },
    },
  })
  if (!role) return null

  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    color: role.color,
    permissions: role.permissions,
    isSystem: role.isSystem,
    position: role.position,
    memberCount: role.members.length,
    members: role.members.map((assignment) => assignment.user),
  }
}
