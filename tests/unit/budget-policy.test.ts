import { describe, expect, it } from 'vitest'
import { can, type Actor } from '@/lib/auth/policy'

const admin: Actor = { id: 'a', globalRole: 'ADMIN', isActive: true, memberships: [] }
const lead: Actor = {
  id: 'l', globalRole: 'MEMBER', isActive: true,
  memberships: [{ channelId: 'c1', channelRole: 'LEAD' }],
}
const member: Actor = {
  id: 'm', globalRole: 'MEMBER', isActive: true,
  memberships: [{ channelId: 'c1', channelRole: 'MEMBER' }],
}
const outsider: Actor = { id: 'o', globalRole: 'MEMBER', isActive: true, memberships: [] }

const budget = {
  kind: 'budget' as const,
  channelId: 'c1',
  channelVisibility: 'OPEN' as const,
  channelArchivedAt: null,
}

describe('can() — bütçe', () => {
  it('okuma: admin ve ilgili kanalın LEAD\'i görür', () => {
    expect(can(admin, 'budget:read', budget)).toBe(true)
    expect(can(lead, 'budget:read', budget)).toBe(true)
  })

  it('okuma: düz üye ve kanal dışı göremez — OPEN kanalda bile', () => {
    expect(can(member, 'budget:read', budget)).toBe(false)
    expect(can(outsider, 'budget:read', budget)).toBe(false)
  })

  it('başka kanalın LEAD\'i bu kanalın bütçesini göremez', () => {
    const otherLead: Actor = {
      id: 'x', globalRole: 'MEMBER', isActive: true,
      memberships: [{ channelId: 'c2', channelRole: 'LEAD' }],
    }
    expect(can(otherLead, 'budget:read', budget)).toBe(false)
  })

  it('yazma: yalnızca admin', () => {
    expect(can(admin, 'budget:write', budget)).toBe(true)
    expect(can(lead, 'budget:write', budget)).toBe(false)
    expect(can(member, 'budget:write', budget)).toBe(false)
  })

  it('arşivlenmiş kanalda admin de yazamaz', () => {
    const archived = { ...budget, channelArchivedAt: new Date() }
    expect(can(admin, 'budget:write', archived)).toBe(false)
    // Okuma arşivden sonra da mümkün: geçmiş kayıt görüntülenebilir olmalı.
    expect(can(admin, 'budget:read', archived)).toBe(true)
  })

  it('pasif admin hiçbir şey yapamaz', () => {
    const inactive: Actor = { ...admin, isActive: false }
    expect(can(inactive, 'budget:read', budget)).toBe(false)
    expect(can(inactive, 'budget:write', budget)).toBe(false)
  })

  it('yanlış resource türü reddedilir', () => {
    expect(can(admin, 'budget:read', { kind: 'invite' })).toBe(false)
    expect(can(admin, 'budget:write', { kind: 'invite' })).toBe(false)
  })
})

describe('can() — sponsor (content:* kuralları)', () => {
  const sponsor = {
    kind: 'content' as const,
    channelId: 'c1',
    channelVisibility: 'OPEN' as const,
    channelArchivedAt: null,
    ownerId: 'm',
  }

  it('kanal üyesi görür ve yazar', () => {
    expect(can(member, 'content:read', sponsor)).toBe(true)
    expect(can(member, 'content:write', sponsor)).toBe(true)
  })

  it('silme sahibi, LEAD ve admin', () => {
    expect(can(member, 'content:delete', sponsor)).toBe(true)
    expect(can(lead, 'content:delete', { ...sponsor, ownerId: 'other' })).toBe(true)
    expect(can(admin, 'content:delete', { ...sponsor, ownerId: 'other' })).toBe(true)
    expect(can(outsider, 'content:delete', { ...sponsor, ownerId: 'other' })).toBe(false)
  })

  it('PRIVATE kanalda üye olmayan göremez', () => {
    const priv = { ...sponsor, channelVisibility: 'PRIVATE' as const }
    expect(can(outsider, 'content:read', priv)).toBe(false)
    expect(can(member, 'content:read', priv)).toBe(true)
  })
})
