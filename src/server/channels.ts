'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { type Actor, can } from '@/lib/auth/policy'
import { recordActivity } from '@/lib/activity'

import { slugify } from '@/lib/slug'

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let suffix = 1
  while (await db.channel.findUnique({ where: { slug: candidate } })) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

export const createChannel = defineAction({
  input: z.object({
    name: z.string().trim().min(2, 'Kanal adı en az 2 karakter.').max(60, 'Kanal adı en fazla 60 karakter.'),
    visibility: z.enum(['OPEN', 'PRIVATE']).default('OPEN'),
    description: z.string().trim().max(200).default(''),
  }),
  getActor,
  authorize: async ({ actor }) => ({ allowed: can(actor, 'channel:create', { kind: 'channel:new' }) }),
  handler: async ({ actor, input }) => {
    const slug = await uniqueSlug(slugify(input.name))
    const channel = await db.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          name: input.name,
          slug,
          visibility: input.visibility,
          description: input.description || null,
          createdById: actor.id,
          members: { create: { userId: actor.id, channelRole: 'LEAD' } },
        },
      })
      await recordActivity(tx, {
        actorId: actor.id, verb: 'channel.created',
        entityType: 'Channel', entityId: created.id, meta: { name: created.name },
      })
      return created
    })
    return { id: channel.id, slug: channel.slug }
  },
})

export const addChannelMember = defineAction({
  input: z.object({
    channelId: z.string().cuid(),
    userId: z.string().cuid(),
    channelRole: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
  }),
  getActor,
  authorize: async ({ actor, input }) => {
    const channel = await db.channel.findUnique({ where: { id: input.channelId } })
    if (!channel) return { allowed: false, code: 'NOT_FOUND' as const }
    return {
      allowed: can(actor, 'channel:manageMembers', {
        kind: 'channel', id: channel.id,
        visibility: channel.visibility, archivedAt: channel.archivedAt,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    const member = await db.channelMember.upsert({
      where: { channelId_userId: { channelId: input.channelId, userId: input.userId } },
      create: { channelId: input.channelId, userId: input.userId, channelRole: input.channelRole },
      update: { channelRole: input.channelRole },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'channel.memberAdded',
      entityType: 'Channel', entityId: input.channelId, meta: { userId: input.userId },
    })
    return { id: member.id }
  },
})

export const removeChannelMember = defineAction({
  input: z.object({ channelId: z.string().cuid(), userId: z.string().cuid() }),
  getActor,
  authorize: async ({ actor, input }) => {
    const channel = await db.channel.findUnique({ where: { id: input.channelId } })
    if (!channel) return { allowed: false, code: 'NOT_FOUND' as const }
    return {
      allowed: can(actor, 'channel:manageMembers', {
        kind: 'channel', id: channel.id,
        visibility: channel.visibility, archivedAt: channel.archivedAt,
      }),
    }
  },
  handler: async ({ actor, input }) => {
    await db.channelMember.deleteMany({
      where: { channelId: input.channelId, userId: input.userId },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'channel.memberRemoved',
      entityType: 'Channel', entityId: input.channelId, meta: { userId: input.userId },
    })
    return { ok: true as const }
  },
})

export async function listVisibleChannels(actor: Actor) {
  const memberChannelIds = actor.memberships.map((m) => m.channelId)
  return db.channel.findMany({
    where: {
      archivedAt: null,
      ...(actor.globalRole === 'ADMIN'
        ? {}
        : { OR: [{ visibility: 'OPEN' }, { id: { in: memberChannelIds } }] }),
    },
    orderBy: { name: 'asc' },
  })
}
