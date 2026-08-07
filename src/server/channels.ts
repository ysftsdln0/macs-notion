'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { actionError, defineAction } from '@/lib/action'
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

// addChannelMember ve removeChannelMember birebir aynı yetki kontrolünü
// paylaşır: kanalı bul, bulunamazsa NOT_FOUND, bulunursa channel:manageMembers
// ile karar ver. Tek yerden yönetilir, ikisi de bu fonksiyonu kullanır.
async function authorizeChannelMembership(
  { actor, input }: { actor: Actor; input: { channelId: string } },
) {
  const channel = await db.channel.findUnique({ where: { id: input.channelId } })
  if (!channel) return { allowed: false as const, code: 'NOT_FOUND' as const }
  if (!can(actor, 'channel:manageMembers', {
    kind: 'channel', id: channel.id,
    visibility: channel.visibility, archivedAt: channel.archivedAt,
  })) {
    return { allowed: false as const }
  }
  return { allowed: true as const }
}

// Bir kanalın son LEAD'i çıkarılamaz ya da MEMBER'a düşürülemez — aksi halde
// kanal sahipsiz kalır. Admin de bu kuraldan muaf değildir: sorun kimin
// yaptığı değil, kanalın liderisiz kalmasıdır (bkz. member:deactivate'teki
// "admin kendini pasife alamaz" kuralıyla aynı gerekçe).
async function assertNotLastLead(
  channelId: string,
  userId: string,
  nextRole: 'LEAD' | 'MEMBER' | null,
): Promise<void> {
  if (nextRole === 'LEAD') return
  const target = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (!target || target.channelRole !== 'LEAD') return
  const leadCount = await db.channelMember.count({ where: { channelId, channelRole: 'LEAD' } })
  if (leadCount <= 1) {
    throw actionError('CONFLICT', { channelRole: 'Kanalın son liderini çıkaramaz veya düşüremezsin.' })
  }
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
        channelId: created.id,
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
  authorize: authorizeChannelMembership,
  handler: async ({ actor, input }) => {
    await assertNotLastLead(input.channelId, input.userId, input.channelRole)
    const member = await db.channelMember.upsert({
      where: { channelId_userId: { channelId: input.channelId, userId: input.userId } },
      create: { channelId: input.channelId, userId: input.userId, channelRole: input.channelRole },
      update: { channelRole: input.channelRole },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'channel.memberAdded',
      entityType: 'Channel', entityId: input.channelId, meta: { userId: input.userId },
      channelId: input.channelId,
    })
    return { id: member.id }
  },
})

export const removeChannelMember = defineAction({
  input: z.object({ channelId: z.string().cuid(), userId: z.string().cuid() }),
  getActor,
  authorize: authorizeChannelMembership,
  handler: async ({ actor, input }) => {
    await assertNotLastLead(input.channelId, input.userId, null)
    await db.channelMember.deleteMany({
      where: { channelId: input.channelId, userId: input.userId },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'channel.memberRemoved',
      entityType: 'Channel', entityId: input.channelId, meta: { userId: input.userId },
      channelId: input.channelId,
    })
    return { ok: true as const }
  },
})
