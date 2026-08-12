import { describe, expect, it } from 'vitest'
import { type Actor, can } from '@/lib/auth/policy'

const admin: Actor = { id: 'a', globalRole: 'ADMIN', isActive: true, memberships: [] }
const member: Actor = {
  id: 'm', globalRole: 'MEMBER', isActive: true,
  memberships: [{ channelId: 'c1', channelRole: 'MEMBER' }],
}
const outsider: Actor = { id: 'o', globalRole: 'MEMBER', isActive: true, memberships: [] }

const base = {
  kind: 'document' as const,
  channelId: 'c1',
  channelVisibility: 'OPEN' as const,
  channelArchivedAt: null,
  documentVisibility: 'PUBLIC' as const,
  ownerId: 'm',
  shared: false,
}

describe('can() — doküman', () => {
  it('PUBLIC dokümanı tüm kulüp okur, kanal üyeleri yazar', () => {
    expect(can(outsider, 'document:read', base)).toBe(true)
    expect(can(outsider, 'document:write', base)).toBe(false)
    expect(can(member, 'document:write', base)).toBe(true)
  })

  it('CHANNEL dokümanı yalnızca kanal üyeleri ve admin okur', () => {
    const r = { ...base, documentVisibility: 'CHANNEL' as const }
    expect(can(outsider, 'document:read', r)).toBe(false)
    expect(can(member, 'document:read', r)).toBe(true)
    expect(can(admin, 'document:read', r)).toBe(true)
  })

  it('PRIVATE dokümanı sahibi, paylaşılanlar ve admin okur', () => {
    const r = { ...base, documentVisibility: 'PRIVATE' as const }
    expect(can(member, 'document:read', r)).toBe(true) // sahip
    expect(can(outsider, 'document:read', r)).toBe(false)
    expect(can(outsider, 'document:read', { ...r, shared: true })).toBe(true)
    expect(can(admin, 'document:read', r)).toBe(true)
  })

  it('VIEW paylaşımı okuma verir, yazma vermez; EDIT yazma verir', () => {
    const r = { ...base, documentVisibility: 'PRIVATE' as const, shared: true }
    expect(can(outsider, 'document:write', r)).toBe(false)
    expect(can(outsider, 'document:write', { ...r, sharedEdit: true })).toBe(true)
  })

  it('paylaşımı sahip, kanal LEAD ve admin yönetir', () => {
    const lead: Actor = {
      id: 'l', globalRole: 'MEMBER', isActive: true,
      memberships: [{ channelId: 'c1', channelRole: 'LEAD' }],
    }
    const leadNotOwner = { ...base, ownerId: 'someone-else' }
    expect(can(admin, 'document:share', base)).toBe(true)
    expect(can(lead, 'document:share', leadNotOwner)).toBe(true)
    expect(can(member, 'document:share', leadNotOwner)).toBe(false)
    expect(can(member, 'document:share', base)).toBe(true) // sahip
  })

  it('silmeyi sahip, LEAD ve admin yapar; arşivli kanalda yazılamaz', () => {
    expect(can(member, 'document:delete', base)).toBe(true)
    const lead: Actor = {
      id: 'l', globalRole: 'MEMBER', isActive: true,
      memberships: [{ channelId: 'c1', channelRole: 'LEAD' }],
    }
    expect(can(lead, 'document:delete', { ...base, ownerId: 'x' })).toBe(true)
    expect(can(outsider, 'document:delete', { ...base, ownerId: 'x' })).toBe(false)
    expect(can(member, 'document:write', { ...base, channelArchivedAt: new Date() })).toBe(false)
  })

  it('doküman oluşturmayı kanal üyeleri yapabilir', () => {
    const r = { kind: 'document:new' as const, channelId: 'c1', channelVisibility: 'OPEN' as const }
    expect(can(member, 'document:create', r)).toBe(true)
    expect(can(outsider, 'document:create', r)).toBe(false)
    expect(can(admin, 'document:create', r)).toBe(true)
  })
})
