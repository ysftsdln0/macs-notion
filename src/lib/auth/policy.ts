export type GlobalRole = 'ADMIN' | 'MEMBER'
export type ChannelRole = 'LEAD' | 'MEMBER'
export type Visibility = 'OPEN' | 'PRIVATE'
export type DocumentVisibility = 'PUBLIC' | 'CHANNEL' | 'PRIVATE'

export type Actor = {
  id: string
  globalRole: GlobalRole
  isActive: boolean
  memberships: { channelId: string; channelRole: ChannelRole }[]
}

export type Action =
  | 'channel:create'
  | 'channel:read'
  | 'channel:update'
  | 'channel:archive'
  | 'channel:manageMembers'
  | 'content:read'
  | 'content:write'
  | 'content:delete'
  | 'invite:create'
  | 'invite:revoke'
  | 'invite:list'
  | 'member:list'
  | 'member:updateRole'
  | 'member:deactivate'
  | 'member:reactivate'
  | 'document:create'
  | 'document:read'
  | 'document:write'
  | 'document:share'
  | 'document:delete'
  | 'budget:read'
  | 'budget:write'

export type Resource =
  | { kind: 'channel:new' }
  | { kind: 'channel'; id: string; visibility: Visibility; archivedAt: Date | null }
  | {
      kind: 'content'
      channelId: string
      channelVisibility: Visibility
      channelArchivedAt: Date | null
      ownerId?: string | null
      assigneeIds?: string[]
    }
  | { kind: 'invite' }
  | { kind: 'member'; id: string }
  | {
      kind: 'document'
      channelId: string
      channelVisibility: Visibility
      channelArchivedAt: Date | null
      documentVisibility: DocumentVisibility
      ownerId?: string | null
      shared?: boolean
      sharedEdit?: boolean
    }
  | { kind: 'document:new'; channelId: string; channelVisibility: Visibility }
  | {
      kind: 'budget'
      channelId: string
      channelVisibility: Visibility
      channelArchivedAt: Date | null
    }

function membership(actor: Actor, channelId: string) {
  return actor.memberships.find((m) => m.channelId === channelId)
}

function isAdmin(actor: Actor) {
  return actor.globalRole === 'ADMIN'
}

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  // Pasif kullanıcı hiçbir yetkiye sahip değildir. Tek ve mutlak kural.
  if (!actor.isActive) return false

  switch (action) {
    case 'channel:create':
      return resource.kind === 'channel:new' &&
        (isAdmin(actor) || actor.memberships.some((m) => m.channelRole === 'LEAD'))

    case 'channel:read':
      if (resource.kind !== 'channel') return false
      return resource.visibility === 'OPEN' || isAdmin(actor) || !!membership(actor, resource.id)

    case 'channel:update':
    case 'channel:manageMembers': {
      if (resource.kind !== 'channel' || resource.archivedAt) return false
      return isAdmin(actor) || membership(actor, resource.id)?.channelRole === 'LEAD'
    }

    case 'channel:archive':
      return resource.kind === 'channel' && isAdmin(actor)

    case 'content:read': {
      if (resource.kind !== 'content') return false
      return resource.channelVisibility === 'OPEN' ||
        isAdmin(actor) ||
        !!membership(actor, resource.channelId)
    }

    case 'content:write': {
      if (resource.kind !== 'content') return false
      // Arşivlenmiş kanal salt-okunur: içeriği de kapsar.
      if (resource.channelArchivedAt) return false
      if (isAdmin(actor)) return true
      if (membership(actor, resource.channelId)) return true
      // Atama, PRIVATE kanalda üyeliğin yerine geçmez. Geçseydi kişi
      // yazabildiği içeriği okuyamazdı.
      if (resource.channelVisibility !== 'OPEN') return false
      return resource.assigneeIds?.includes(actor.id) ?? false
    }

    case 'content:delete': {
      if (resource.kind !== 'content') return false
      if (resource.channelArchivedAt) return false
      if (isAdmin(actor)) return true
      if (resource.ownerId === actor.id) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'
    }

    case 'invite:create':
    case 'invite:revoke':
    case 'invite:list':
      return resource.kind === 'invite' && isAdmin(actor)

    case 'member:list':
      return resource.kind === 'member'

    case 'member:updateRole':
      return resource.kind === 'member' && isAdmin(actor)

    case 'member:deactivate':
      // Admin kendini pasife alamaz: sistemde admin kalmama riski.
      return resource.kind === 'member' && isAdmin(actor) && resource.id !== actor.id

    case 'member:reactivate':
      // Havuzu yalnızca büyütür, admin tavanı riske girmez — kendi kendini
      // etkinleştirme senaryosu zaten pasif aktörün hiçbir yetkisi olmaması
      // (bkz. dosya başındaki isActive kapısı) yüzünden erişilemez.
      return resource.kind === 'member' && isAdmin(actor)

    case 'document:create':
      if (resource.kind !== 'document:new') return false
      if (resource.channelVisibility === 'PRIVATE' && !isAdmin(actor)) {
        return !!membership(actor, resource.channelId)
      }
      return isAdmin(actor) || !!membership(actor, resource.channelId)

    case 'document:read': {
      if (resource.kind !== 'document') return false
      if (resource.channelArchivedAt) return false
      if (isAdmin(actor)) return true
      if (resource.documentVisibility === 'PUBLIC') return true
      if (resource.documentVisibility === 'CHANNEL') {
        return !!membership(actor, resource.channelId)
      }
      // PRIVATE: sahip + paylaşılan + admin
      return resource.ownerId === actor.id || !!resource.shared
    }

    case 'document:write': {
      if (resource.kind !== 'document') return false
      if (resource.channelArchivedAt) return false
      if (isAdmin(actor)) return true
      if (resource.ownerId === actor.id) return true
      if (!!resource.sharedEdit) return true
      // CHANNEL/OPEN üyeler kanal içinde yazar; PRIVATE dokümanda kanal üyeliği
      // yazma vermez (paylaşılan değilse görünmüyor zaten).
      if (resource.documentVisibility === 'PRIVATE') return false
      return !!membership(actor, resource.channelId)
    }

    case 'document:share':
      if (resource.kind !== 'document') return false
      if (isAdmin(actor)) return true
      if (resource.ownerId === actor.id) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'

    case 'document:delete':
      if (resource.kind !== 'document') return false
      if (isAdmin(actor)) return true
      if (resource.ownerId === actor.id) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'

    // Para kalemleri içerikten daha kapalı: kanal üyeliği yetmez.
    case 'budget:read':
      if (resource.kind !== 'budget') return false
      if (isAdmin(actor)) return true
      return membership(actor, resource.channelId)?.channelRole === 'LEAD'

    case 'budget:write':
      // Yazma yalnızca admin'de. LEAD bütçeyi görür, değiştiremez —
      // kulübün parasal kaydını tek elde tutmak bilinçli bir karar.
      if (resource.kind !== 'budget') return false
      if (resource.channelArchivedAt) return false
      return isAdmin(actor)

    default: {
      const exhaustive: never = action
      void exhaustive
      return false
    }
  }
}
