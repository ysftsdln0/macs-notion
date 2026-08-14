'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, has, type Actor } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'
import { loadEventContext } from '@/server/events-query'

const statusEnum = z.enum(['PLANNED', 'CONFIRMED', 'DONE', 'CANCELLED'])

/**
 * Bitiş tarihi başlangıçtan önce olamaz. Zod'un `refine`'ı ile şemada
 * tutuluyor: handler'a düşseydi hata `VALIDATION` yerine `INTERNAL`
 * olurdu ve kullanıcı hangi alanın hatalı olduğunu göremezdi.
 */
const dateOrder = <T extends { startsAt: Date; endsAt?: Date | null }>(value: T) =>
  !value.endsAt || value.endsAt > value.startsAt

function authorizeOnEvent(action: 'content:write' | 'content:delete') {
  return async ({ actor, input }: { actor: Actor; input: { id: string } }) => {
    const context = await loadEventContext(input.id)
    if (!context) return { allowed: false as const, code: 'NOT_FOUND' as const }
    return { allowed: can(actor, action, context.resource) }
  }
}

export const createEvent = defineAction({
  input: z
    .object({
      title: z.string().trim().min(1, 'Etkinlik adı boş olamaz.').max(160),
      channelId: z.string().cuid(),
      description: z.string().trim().max(4000).nullable().default(null),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date().nullable().default(null),
      location: z.string().trim().max(200).nullable().default(null),
      status: statusEnum.default('PLANNED'),
    })
    .refine(dateOrder, { path: ['endsAt'], message: 'Bitiş, başlangıçtan sonra olmalı.' }),
  getActor,
  authorize: async ({ actor, input }) => {
    const channel = await db.channel.findUnique({ where: { id: input.channelId } })
    if (!channel) return { allowed: false as const, code: 'NOT_FOUND' as const }
    return {
      allowed: can(actor, 'content:write', {
        kind: 'content',
        channelId: channel.id,
        channelVisibility: channel.visibility,
        channelArchivedAt: channel.archivedAt,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    const event = await db.event.create({
      data: {
        title: input.title,
        channelId: input.channelId,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: input.location,
        status: input.status,
        createdById: actor.id,
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'event.created',
      entityType: 'Event',
      entityId: event.id,
      channelId: input.channelId,
      meta: { title: event.title },
    })
    return { id: event.id }
  },
})

export const updateEvent = defineAction({
  input: z
    .object({
      id: z.string().cuid(),
      title: z.string().trim().min(1, 'Etkinlik adı boş olamaz.').max(160).optional(),
      description: z.string().trim().max(4000).nullable().optional(),
      startsAt: z.coerce.date().optional(),
      endsAt: z.coerce.date().nullable().optional(),
      location: z.string().trim().max(200).nullable().optional(),
      status: statusEnum.optional(),
    })
    .refine(
      (value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt,
      { path: ['endsAt'], message: 'Bitiş, başlangıçtan sonra olmalı.' },
    ),
  getActor,
  authorize: authorizeOnEvent('content:write'),
  handler: async ({ actor, input }) => {
    const current = await db.event.findUnique({ where: { id: input.id } })
    if (!current) throw actionError('NOT_FOUND')

    // Tek alan güncellenirken diğerine karşı da doğrulanmalı: yalnızca
    // endsAt gönderen bir istek, kayıtlı startsAt'ten önceye çekemez.
    const startsAt = input.startsAt ?? current.startsAt
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt
    if (endsAt && endsAt <= startsAt) {
      throw actionError('VALIDATION', { endsAt: 'Bitiş, başlangıçtan sonra olmalı.' })
    }

    const event = await db.event.update({
      where: { id: input.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'event.updated',
      entityType: 'Event',
      entityId: event.id,
      channelId: event.channelId,
    })
    return { id: event.id }
  },
})

export const archiveEvent = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: authorizeOnEvent('content:delete'),
  handler: async ({ actor, input }) => {
    const event = await db.event.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'event.archived',
      entityType: 'Event',
      entityId: input.id,
      channelId: event.channelId,
    })
    return { id: input.id }
  },
})

export const restoreEvent = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: has(actor, 'TRASH_MANAGE') }),
  handler: async ({ actor, input }) => {
    const event = await db.event.findUnique({ where: { id: input.id } })
    if (!event) throw actionError('NOT_FOUND')
    await db.event.update({ where: { id: input.id }, data: { archivedAt: null } })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'event.restored',
      entityType: 'Event',
      entityId: input.id,
      channelId: event.channelId,
    })
    return { id: input.id }
  },
})
