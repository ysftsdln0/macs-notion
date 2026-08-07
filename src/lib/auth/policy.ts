export type GlobalRole = 'ADMIN' | 'MEMBER'
export type ChannelRole = 'LEAD' | 'MEMBER'
export type Visibility = 'OPEN' | 'PRIVATE'

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

export type Resource =
  | { kind: 'channel:new' }
  | { kind: 'channel'; id: string; visibility: Visibility; archivedAt: Date | null }
  | { kind: 'content'; channelId: string; channelVisibility: Visibility; ownerId?: string | null; assigneeIds?: string[] }
  | { kind: 'invite' }
  | { kind: 'member'; id: string }

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
      if (isAdmin(actor)) return true
      if (membership(actor, resource.channelId)) return true
      return resource.assigneeIds?.includes(actor.id) ?? false
    }

    case 'content:delete': {
      if (resource.kind !== 'content') return false
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

    default: {
      const exhaustive: never = action
      return exhaustive
    }
  }
}
