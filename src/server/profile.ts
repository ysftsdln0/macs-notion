'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { recordActivity } from '@/lib/activity'

export const completeOnboarding = defineAction({
  input: z.object({
    name: z.string().trim().min(1, 'Ad soyad zorunlu.').max(80, 'Ad soyad en fazla 80 karakter.'),
    title: z.string().trim().max(60, 'Ünvan en fazla 60 karakter.').default(''),
  }),
  getActor,
  // Kullanıcı yalnızca kendi profilini kurar; ayrı bir policy kuralı gerekmez.
  authorize: async () => ({ allowed: true }),
  handler: async ({ actor, input }) => {
    const user = await db.user.update({
      where: { id: actor.id },
      data: {
        name: input.name,
        title: input.title || null,
        onboardedAt: new Date(),
      },
    })
    await recordActivity(db, {
      actorId: actor.id, verb: 'member.joined',
      entityType: 'User', entityId: user.id,
    })
    return { id: user.id }
  },
})
