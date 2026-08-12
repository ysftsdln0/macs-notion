'use server'

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { can, type Actor } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'
import { loadBudgetEntryContext } from '@/server/budget-query'

const kindEnum = z.enum(['INCOME', 'EXPENSE'])
const statusEnum = z.enum(['PLANNED', 'COMMITTED', 'PAID'])
const currencyEnum = z.enum(['TRY', 'USD', 'EUR'])

/**
 * Tutar istemciden dize gelir ve doğrudan `Decimal`e çevrilir. Number
 * üzerinden geçirmek kuruşları float yuvarlamasına açardı — para alanları
 * bu projede baştan sona Decimal(12,2).
 */
const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}([.,]\d{1,2})?$/, 'Tutar en fazla iki ondalık basamaklı bir sayı olmalı.')
  .transform((value) => new Prisma.Decimal(value.replace(',', '.')))
  .refine((value) => value.greaterThan(0), 'Tutar sıfırdan büyük olmalı.')

async function authorizeBudgetWriteOnChannel(actor: Actor, channelId: string) {
  const channel = await db.channel.findUnique({ where: { id: channelId } })
  if (!channel) return { allowed: false as const, code: 'NOT_FOUND' as const }
  return {
    allowed: can(actor, 'budget:write', {
      kind: 'budget',
      channelId: channel.id,
      channelVisibility: channel.visibility,
      channelArchivedAt: channel.archivedAt,
    }),
  }
}

async function assertRelationsInChannel(
  channelId: string,
  eventId: string | null | undefined,
  sponsorId: string | null | undefined,
): Promise<void> {
  if (eventId) {
    const event = await db.event.findUnique({ where: { id: eventId } })
    if (!event || event.archivedAt) throw actionError('NOT_FOUND')
    if (event.channelId !== channelId) {
      throw actionError('VALIDATION', { eventId: 'Etkinlik başka bir kanalda.' })
    }
  }
  if (sponsorId) {
    const sponsor = await db.sponsor.findUnique({ where: { id: sponsorId } })
    if (!sponsor || sponsor.archivedAt) throw actionError('NOT_FOUND')
    if (sponsor.channelId !== channelId) {
      throw actionError('VALIDATION', { sponsorId: 'Sponsor başka bir kanalda.' })
    }
  }
}

/**
 * Fiş eki, kalemin KENDİSİNE yüklenmiş bir ek olmalı. Kontrol edilmezse
 * başka bir varlığın (ör. başka kanalın bütçesinin) eki bu kaleme
 * bağlanıp yetkisiz bir dosya indirme yolu açılırdı — indirme route'u
 * yetkiyi ekin `entityId`'sinden çözüyor.
 */
async function assertReceiptBelongsToEntry(
  attachmentId: string | null | undefined,
  entryId: string,
): Promise<void> {
  if (!attachmentId) return
  const attachment = await db.attachment.findUnique({ where: { id: attachmentId } })
  if (!attachment) throw actionError('NOT_FOUND')
  if (attachment.entityType !== 'BudgetEntry' || attachment.entityId !== entryId) {
    throw actionError('VALIDATION', { receiptAttachmentId: 'Bu ek bu kaleme ait değil.' })
  }
}

export const createBudgetEntry = defineAction({
  input: z.object({
    kind: kindEnum,
    title: z.string().trim().min(1, 'Başlık boş olamaz.').max(160),
    amount: amountSchema,
    currency: currencyEnum.default('TRY'),
    category: z.string().trim().min(1, 'Kategori boş olamaz.').max(60),
    date: z.coerce.date().optional(),
    status: statusEnum.default('PLANNED'),
    channelId: z.string().cuid(),
    eventId: z.string().cuid().nullable().default(null),
    sponsorId: z.string().cuid().nullable().default(null),
  }),
  getActor,
  authorize: async ({ actor, input }) => authorizeBudgetWriteOnChannel(actor, input.channelId),
  handler: async ({ actor, input }) => {
    await assertRelationsInChannel(input.channelId, input.eventId, input.sponsorId)

    const entry = await db.budgetEntry.create({
      data: {
        kind: input.kind,
        title: input.title,
        amount: input.amount,
        currency: input.currency,
        category: input.category,
        ...(input.date ? { date: input.date } : {}),
        status: input.status,
        channelId: input.channelId,
        eventId: input.eventId,
        sponsorId: input.sponsorId,
        createdById: actor.id,
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'budget.created',
      entityType: 'BudgetEntry',
      entityId: entry.id,
      channelId: input.channelId,
      meta: { title: entry.title, kind: entry.kind },
    })
    return { id: entry.id }
  },
})

export const updateBudgetEntry = defineAction({
  input: z.object({
    id: z.string().cuid(),
    kind: kindEnum.optional(),
    title: z.string().trim().min(1, 'Başlık boş olamaz.').max(160).optional(),
    amount: amountSchema.optional(),
    currency: currencyEnum.optional(),
    category: z.string().trim().min(1, 'Kategori boş olamaz.').max(60).optional(),
    date: z.coerce.date().optional(),
    status: statusEnum.optional(),
    eventId: z.string().cuid().nullable().optional(),
    sponsorId: z.string().cuid().nullable().optional(),
    receiptAttachmentId: z.string().cuid().nullable().optional(),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    const context = await loadBudgetEntryContext(input.id)
    if (!context || context.entry.archivedAt) {
      return { allowed: false as const, code: 'NOT_FOUND' as const }
    }
    return { allowed: can(actor, 'budget:write', context.resource) }
  },
  handler: async ({ actor, input }) => {
    const context = await loadBudgetEntryContext(input.id)
    if (!context) throw actionError('NOT_FOUND')
    await assertRelationsInChannel(context.entry.channelId, input.eventId, input.sponsorId)
    await assertReceiptBelongsToEntry(input.receiptAttachmentId, input.id)

    const entry = await db.budgetEntry.update({
      where: { id: input.id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
        ...(input.sponsorId !== undefined ? { sponsorId: input.sponsorId } : {}),
        ...(input.receiptAttachmentId !== undefined
          ? { receiptAttachmentId: input.receiptAttachmentId }
          : {}),
      },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'budget.updated',
      entityType: 'BudgetEntry',
      entityId: entry.id,
      channelId: entry.channelId,
    })
    return { id: entry.id }
  },
})

export const archiveBudgetEntry = defineAction({
  input: z.object({ id: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => {
    const context = await loadBudgetEntryContext(input.id)
    if (!context || context.entry.archivedAt) {
      return { allowed: false as const, code: 'NOT_FOUND' as const }
    }
    return { allowed: can(actor, 'budget:write', context.resource) }
  },
  handler: async ({ actor, input }) => {
    const entry = await db.budgetEntry.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })
    await recordActivity(db, {
      actorId: actor.id,
      verb: 'budget.archived',
      entityType: 'BudgetEntry',
      entityId: input.id,
      channelId: entry.channelId,
    })
    return { id: input.id }
  },
})
