'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, has, type Actor } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'
import { loadSponsorContext } from '@/server/sponsors-query'

const statusEnum = z.enum(['PROSPECT', 'CONTACTED', 'NEGOTIATING', 'SIGNED', 'DECLINED'])
const currencyEnum = z.enum(['TRY', 'USD', 'EUR'])

/**
 * Tutar istemciden dize olarak gelir ve `Decimal`e çevrilir. Number
 * üzerinden geçirmek kuruşları float yuvarlamasına açardı — para alanları
 * bu projede baştan sona Decimal(12,2).
 */
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}([.,]\d{1,2})?$/, 'Tutar en fazla iki ondalık basamaklı bir sayı olmalı.')
  .transform((value) => new Prisma.Decimal(value.replace(',', '.')))
  .refine((value) => value.greaterThan(0), 'Tutar sıfırdan büyük olmalı.')

function authorizeOnSponsor(action: 'content:write' | 'content:delete') {
  return async ({ actor, input }: { actor: Actor; input: { id: string } }) => {
    const context = await loadSponsorContext(input.id)
    if (!context || context.sponsor.archivedAt) {
      return { allowed: false as const, code: 'NOT_FOUND' as const }
    }
    return { allowed: can(actor, action, context.resource) }
  }
}

async function assertEventInChannel(eventId: string | null, channelId: string): Promise<void> {
  if (!eventId) return
  const event = await db.event.findUnique({ where: { id: eventId } })
  if (!event || event.archivedAt) throw actionError('NOT_FOUND')
  if (event.channelId !== channelId) {
    throw actionError('VALIDATION', { eventId: 'Etkinlik başka bir kanalda.' })
  }
}

export const createSponsor = defineAction({
  input: z.object({
    name: z.string().trim().min(1, 'Sponsor adı boş olamaz.').max(160),
    channelId: z.string().cuid(),
    status: statusEnum.default('PROSPECT'),
    amount: amountSchema.nullable().default(null),
    currency: currencyEnum.default('TRY'),
    contactName: z.string().trim().max(160).nullable().default(null),
    contactEmail: z.email('Geçerli bir e-posta gir.').nullable().default(null),
    contactPhone: z.string().trim().max(40).nullable().default(null),
    notes: z.string().trim().max(4000).nullable().default(null),
    eventId: z.string().cuid().nullable().default(null),
    ownerUserId: z.string().cuid().nullable().default(null),
  }),
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
    await assertEventInChannel(input.eventId, input.channelId)
    if (input.ownerUserId) {
      const owner = await db.user.findUnique({ where: { id: input.ownerUserId } })
      if (!owner || !owner.isActive) throw actionError('NOT_FOUND')
    }

    const sponsor = await db.sponsor.create({
      data: {
        name: input.name,
        channelId: input.channelId,
        status: input.status,
        amount: input.amount,
        currency: input.currency,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        notes: input.notes,
        eventId: input.eventId,
        ownerUserId: input.ownerUserId,
        createdById: actor.id,
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'sponsor.created',
      entityType: 'Sponsor',
      entityId: sponsor.id,
      channelId: input.channelId,
      meta: { name: sponsor.name },
    })
    return { id: sponsor.id }
  },
})

export const updateSponsor = defineAction({
  input: z.object({
    id: z.string().cuid(),
    name: z.string().trim().min(1, 'Sponsor adı boş olamaz.').max(160).optional(),
    status: statusEnum.optional(),
    amount: amountSchema.nullable().optional(),
    currency: currencyEnum.optional(),
    contactName: z.string().trim().max(160).nullable().optional(),
    contactEmail: z.email('Geçerli bir e-posta gir.').nullable().optional(),
    contactPhone: z.string().trim().max(40).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    eventId: z.string().cuid().nullable().optional(),
    ownerUserId: z.string().cuid().nullable().optional(),
  }),
  getActor,
  authorize: authorizeOnSponsor('content:write'),
  handler: async ({ actor, input }) => {
    const context = await loadSponsorContext(input.id)
    if (!context) throw actionError('NOT_FOUND')
    if (input.eventId !== undefined) {
      await assertEventInChannel(input.eventId, context.sponsor.channel.id)
    }

    const sponsor = await db.sponsor.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'sponsor.updated',
      entityType: 'Sponsor',
      entityId: sponsor.id,
      channelId: sponsor.channelId,
    })
    return { id: sponsor.id }
  },
})

export const moveSponsor = defineAction({
  input: z.object({ id: z.string().cuid(), status: statusEnum }),
  getActor,
  authorize: authorizeOnSponsor('content:write'),
  handler: async ({ actor, input }) => {
    const sponsor = await db.sponsor.update({
      where: { id: input.id },
      data: { status: input.status },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'sponsor.moved',
      entityType: 'Sponsor',
      entityId: sponsor.id,
      channelId: sponsor.channelId,
      meta: { status: sponsor.status },
    })
    return { id: sponsor.id, status: sponsor.status }
  },
})

export const archiveSponsor = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: authorizeOnSponsor('content:delete'),
  handler: async ({ actor, input }) => {
    const sponsor = await db.sponsor.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'sponsor.archived',
      entityType: 'Sponsor',
      entityId: input.id,
      channelId: sponsor.channelId,
    })
    return { id: input.id }
  },
})

export const restoreSponsor = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: has(actor, 'TRASH_MANAGE') }),
  handler: async ({ actor, input }) => {
    const sponsor = await db.sponsor.findUnique({ where: { id: input.id } })
    if (!sponsor) throw actionError('NOT_FOUND')
    await db.sponsor.update({ where: { id: input.id }, data: { archivedAt: null } })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'sponsor.restored',
      entityType: 'Sponsor',
      entityId: input.id,
      channelId: sponsor.channelId,
    })
    return { id: input.id }
  },
})
