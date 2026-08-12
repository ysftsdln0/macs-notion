/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe).
 */

import type { EventStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { can, type Actor, type Visibility } from '@/lib/auth/policy'

export type EventView = {
  id: string
  title: string
  description: string | null
  startsAt: Date
  endsAt: Date | null
  location: string | null
  status: EventStatus
  createdById: string
  channel: { id: string; name: string }
}

const eventSelect = {
  id: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  location: true,
  status: true,
  createdById: true,
  channel: { select: { id: true, name: true } },
} satisfies Prisma.EventSelect

/** `can(actor, 'content:read', …)` dallarının sorgu karşılığı. */
function readableChannelFilter(actor: Actor): Prisma.EventWhereInput {
  if (actor.globalRole === 'ADMIN') return {}
  return {
    OR: [
      { channel: { visibility: 'OPEN' } },
      { channelId: { in: actor.memberships.map((m) => m.channelId) } },
    ],
  }
}

export async function listEvents(
  actor: Actor,
  range: { from?: Date; to?: Date } = {},
): Promise<EventView[]> {
  return db.event.findMany({
    where: {
      archivedAt: null,
      channel: { archivedAt: null },
      ...(range.from || range.to
        ? { startsAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } }
        : {}),
      ...readableChannelFilter(actor),
    },
    select: eventSelect,
    orderBy: { startsAt: 'asc' },
  })
}

export type EventContext = {
  event: EventView & { archivedAt: Date | null }
  resource: {
    kind: 'content'
    channelId: string
    channelVisibility: Visibility
    channelArchivedAt: Date | null
    ownerId: string
  }
}

export async function loadEventContext(eventId: string): Promise<EventContext | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      ...eventSelect,
      archivedAt: true,
      channel: { select: { id: true, name: true, visibility: true, archivedAt: true } },
    },
  })
  if (!event) return null
  return {
    event: { ...event, channel: { id: event.channel.id, name: event.channel.name } },
    resource: {
      kind: 'content',
      channelId: event.channel.id,
      channelVisibility: event.channel.visibility,
      channelArchivedAt: event.channel.archivedAt,
      ownerId: event.createdById,
    },
  }
}

export async function canReadEvent(actor: Actor, eventId: string): Promise<boolean> {
  const context = await loadEventContext(eventId)
  if (!context || context.event.archivedAt) return false
  return can(actor, 'content:read', context.resource)
}
