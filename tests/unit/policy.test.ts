import { describe, expect, it } from 'vitest'
import { type Resource, can } from '@/lib/auth/policy'
import { makeActor } from '../helpers/make-actor'

const admin = makeActor({ id: 'admin', globalRole: 'ADMIN' })
const lead = makeActor({
  id: 'lead', memberships: [{ channelId: 'c1', channelRole: 'LEAD' }],
})
const member = makeActor({
  id: 'member', memberships: [{ channelId: 'c1', channelRole: 'MEMBER' }],
})
const outsider = makeActor({
  id: 'outsider', memberships: [{ channelId: 'c2', channelRole: 'MEMBER' }],
})
const inactive = makeActor({ ...member, id: 'inactive', isActive: false })

const openChannel: Resource = {
  kind: 'channel', id: 'c1', visibility: 'OPEN', archivedAt: null,
}
const privateChannel: Resource = {
  kind: 'channel', id: 'c1', visibility: 'PRIVATE', archivedAt: null,
}
const openContent: Resource = {
  kind: 'content', channelId: 'c1', channelVisibility: 'OPEN', channelArchivedAt: null,
  ownerId: 'member', assigneeIds: [],
}
const privateContent: Resource = {
  kind: 'content', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
  ownerId: 'member', assigneeIds: [],
}

describe('can() — pasif kullanıcı', () => {
  it('pasif kullanıcı hiçbir şey yapamaz', () => {
    expect(can(inactive, 'channel:read', openChannel)).toBe(false)
    expect(can(inactive, 'content:read', openContent)).toBe(false)
    expect(can({ ...admin, isActive: false }, 'invite:create', { kind: 'invite' })).toBe(false)
  })
})

describe('can() — kanal', () => {
  it('OPEN kanalı herkes okur, PRIVATE kanalı sadece üyesi okur', () => {
    expect(can(outsider, 'channel:read', openChannel)).toBe(true)
    expect(can(outsider, 'channel:read', privateChannel)).toBe(false)
    expect(can(member, 'channel:read', privateChannel)).toBe(true)
    expect(can(admin, 'channel:read', privateChannel)).toBe(true)
  })

  it('kanal açmayı LEAD ve admin yapabilir, düz üye yapamaz', () => {
    expect(can(lead, 'channel:create', { kind: 'channel:new' })).toBe(true)
    expect(can(admin, 'channel:create', { kind: 'channel:new' })).toBe(true)
    expect(can(member, 'channel:create', { kind: 'channel:new' })).toBe(false)
  })

  it('kanal ayarlarını ve üyelerini LEAD ile admin yönetir', () => {
    expect(can(lead, 'channel:update', openChannel)).toBe(true)
    expect(can(lead, 'channel:manageMembers', openChannel)).toBe(true)
    expect(can(member, 'channel:manageMembers', openChannel)).toBe(false)
    expect(can(admin, 'channel:manageMembers', openChannel)).toBe(true)
  })

  it('kanalı yalnızca admin arşivler', () => {
    expect(can(lead, 'channel:archive', openChannel)).toBe(false)
    expect(can(admin, 'channel:archive', openChannel)).toBe(true)
  })

  it('düz üye kanal ayarlarını güncelleyemez ve arşivleyemez', () => {
    expect(can(member, 'channel:update', openChannel)).toBe(false)
    expect(can(member, 'channel:archive', openChannel)).toBe(false)
  })

  it('arşivlenmiş kanalda yazma işlemi yapılamaz', () => {
    const archived: Resource = { ...openChannel, archivedAt: new Date() }
    expect(can(lead, 'channel:update', archived)).toBe(false)
    expect(can(admin, 'channel:update', archived)).toBe(false)
    expect(can(member, 'channel:read', archived)).toBe(true)
  })
})

describe('can() — kanal içeriği', () => {
  it('OPEN kanal içeriğini tüm kulüp okur', () => {
    expect(can(outsider, 'content:read', openContent)).toBe(true)
  })

  it('PRIVATE kanal içeriğini yalnızca üyeler ve admin okur', () => {
    expect(can(outsider, 'content:read', privateContent)).toBe(false)
    expect(can(member, 'content:read', privateContent)).toBe(true)
    expect(can(admin, 'content:read', privateContent)).toBe(true)
  })

  it('yazma yetkisi kanal üyeliğine bağlıdır, okuma yetmez', () => {
    expect(can(outsider, 'content:write', openContent)).toBe(false)
    expect(can(member, 'content:write', openContent)).toBe(true)
  })

  it('atanan kişi üye olmasa da yazabilir', () => {
    const assigned: Resource = {
      kind: 'content', channelId: 'c1', channelVisibility: 'OPEN', channelArchivedAt: null,
      ownerId: 'member', assigneeIds: ['outsider'],
    }
    expect(can(outsider, 'content:write', assigned)).toBe(true)
  })

  it('silmeyi sahip, kanal LEAD ve admin yapar', () => {
    expect(can(member, 'content:delete', openContent)).toBe(true)
    expect(can(lead, 'content:delete', openContent)).toBe(true)
    expect(can(admin, 'content:delete', openContent)).toBe(true)
    expect(can(outsider, 'content:delete', openContent)).toBe(false)
  })

  it('admin, kanala üye olmasa da içerik yazabilir', () => {
    expect(can(admin, 'content:write', openContent)).toBe(true)
  })

  it('PRIVATE kanalda üye olmayan atanan kişi yazamaz ve okuyamaz', () => {
    const assignedPrivate: Resource = {
      kind: 'content', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
      ownerId: 'member', assigneeIds: ['outsider'],
    }
    expect(can(outsider, 'content:write', assignedPrivate)).toBe(false)
    expect(can(outsider, 'content:read', assignedPrivate)).toBe(false)
  })

  it('arşivlenmiş kanalın içeriği okunur ama yazılamaz ve silinemez', () => {
    const archivedContent: Resource = {
      ...openContent, channelArchivedAt: new Date(),
    }
    expect(can(member, 'content:write', archivedContent)).toBe(false)
    expect(can(member, 'content:delete', archivedContent)).toBe(false)
    expect(can(member, 'content:read', archivedContent)).toBe(true)
  })
})

describe('can() — davet ve üye yönetimi', () => {
  it('daveti yalnızca admin üretir ve iptal eder', () => {
    expect(can(admin, 'invite:create', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:create', { kind: 'invite' })).toBe(false)
    expect(can(admin, 'invite:revoke', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:revoke', { kind: 'invite' })).toBe(false)
  })

  it('bekleyen davet kodlarını yalnızca admin listeler', () => {
    expect(can(admin, 'invite:list', { kind: 'invite' })).toBe(true)
    expect(can(lead, 'invite:list', { kind: 'invite' })).toBe(false)
  })

  it('üye listesini herkes görür, rol değiştirmeyi yalnızca admin yapar', () => {
    expect(can(member, 'member:list', { kind: 'member', id: 'x' })).toBe(true)
    expect(can(member, 'member:updateRole', { kind: 'member', id: 'x' })).toBe(false)
    expect(can(admin, 'member:updateRole', { kind: 'member', id: 'x' })).toBe(true)
  })

  it('admin kendini pasife alamaz', () => {
    expect(can(admin, 'member:deactivate', { kind: 'member', id: 'other' })).toBe(true)
    expect(can(admin, 'member:deactivate', { kind: 'member', id: 'admin' })).toBe(false)
  })

  it('admin olmayan kimseyi pasife alamaz', () => {
    expect(can(member, 'member:deactivate', { kind: 'member', id: 'other' })).toBe(false)
    expect(can(lead, 'member:deactivate', { kind: 'member', id: 'other' })).toBe(false)
  })

  it('pasif üyeyi yalnızca admin yeniden etkinleştirir', () => {
    expect(can(admin, 'member:reactivate', { kind: 'member', id: 'other' })).toBe(true)
    expect(can(member, 'member:reactivate', { kind: 'member', id: 'other' })).toBe(false)
    expect(can(lead, 'member:reactivate', { kind: 'member', id: 'other' })).toBe(false)
  })
})

describe('can() — kaynak türü uyuşmazlığı kapalı hata verir', () => {
  it('yanlış kaynak türü daima false döner', () => {
    expect(can(admin, 'channel:archive', { kind: 'invite' })).toBe(false)
    expect(can(admin, 'content:delete', { kind: 'member', id: 'x' })).toBe(false)
  })
})

describe('can() — rol izinleri', () => {
  const boardMember = makeActor({
    id: 'yk',
    permissions: [
      'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL',
      'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
      'INVITE_MANAGE', 'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL',
    ],
  })
  const readOnlyBoard = makeActor({ id: 'denetim', permissions: ['CONTENT_READ_ALL'] })

  it('CONTENT_READ_ALL, üye olmadığı PRIVATE kanalın içeriğini açar', () => {
    expect(can(boardMember, 'content:read', privateContent)).toBe(true)
    expect(can(outsider, 'content:read', privateContent)).toBe(false)
  })

  it('CONTENT_READ_ALL tek başına yazma vermez', () => {
    expect(can(readOnlyBoard, 'content:write', privateContent)).toBe(false)
    expect(can(boardMember, 'content:write', privateContent)).toBe(true)
  })

  it('CONTENT_READ_ALL, PRIVATE kanalın kendisini de görünür kılar', () => {
    expect(can(readOnlyBoard, 'channel:read', privateChannel)).toBe(true)
  })

  it('BUDGET_READ_ALL, LEAD olmadan bütçeyi açar', () => {
    const budget: Resource = {
      kind: 'budget', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
    }
    expect(can(readOnlyBoard, 'budget:read', budget)).toBe(false)
    expect(can(boardMember, 'budget:read', budget)).toBe(true)
    expect(can(lead, 'budget:read', budget)).toBe(true)
    expect(can(member, 'budget:read', budget)).toBe(false)
  })

  it('BUDGET_WRITE_ALL olmadan bütçe yazılamaz, arşivli kanalda hiç yazılamaz', () => {
    const budget: Resource = {
      kind: 'budget', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
    }
    const archived: Resource = { ...budget, channelArchivedAt: new Date() }
    expect(can(boardMember, 'budget:write', budget)).toBe(true)
    expect(can(readOnlyBoard, 'budget:write', budget)).toBe(false)
    expect(can(lead, 'budget:write', budget)).toBe(false)
    expect(can(boardMember, 'budget:write', archived)).toBe(false)
  })

  it('INVITE_MANAGE daveti açar, taşımayan role kapalıdır', () => {
    expect(can(boardMember, 'invite:create', { kind: 'invite' })).toBe(true)
    expect(can(readOnlyBoard, 'invite:create', { kind: 'invite' })).toBe(false)
  })

  it('CHANNEL_MANAGE_ALL, üye olmadığı kanalın ayarlarını açar', () => {
    expect(can(boardMember, 'channel:manageMembers', privateChannel)).toBe(true)
    expect(can(readOnlyBoard, 'channel:manageMembers', privateChannel)).toBe(false)
  })

  it('CONTENT_WRITE_ALL, üye olmadığı kanalın dokümanını düzenletir', () => {
    const channelDoc: Resource = {
      kind: 'document', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
      documentVisibility: 'CHANNEL', ownerId: 'member',
    }
    expect(can(boardMember, 'document:write', channelDoc)).toBe(true)
    expect(can(readOnlyBoard, 'document:write', channelDoc)).toBe(false)
    expect(can(readOnlyBoard, 'document:read', channelDoc)).toBe(true)
  })

  it('pasif aktör izin taşısa da hiçbir şey yapamaz', () => {
    const passive = makeActor({ ...boardMember, isActive: false })
    expect(can(passive, 'content:read', privateContent)).toBe(false)
    expect(can(passive, 'budget:read', {
      kind: 'budget', channelId: 'c1', channelVisibility: 'PRIVATE', channelArchivedAt: null,
    })).toBe(false)
  })
})
