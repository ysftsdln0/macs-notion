'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'

/**
 * Bildirimler kişiye özeldir: yetki `authorize`'da değil, `where`
 * cümlesindeki `userId: actor.id` koşulunda. Başkasının bildirimini
 * okundu işaretlemeye çalışan istek FORBIDDEN almaz — sıfır satır
 * günceller, ki sonuç aynı ve varlık bilgisi sızmaz.
 */
export const markNotificationsRead = defineAction({
  input: z.object({ ids: z.array(z.string().cuid()).max(200).optional() }),
  getActor,
  authorize: async () => ({ allowed: true as const }),
  handler: async ({ actor, input }) => {
    const result = await db.notification.updateMany({
      where: {
        userId: actor.id,
        readAt: null,
        ...(input.ids && input.ids.length > 0 ? { id: { in: input.ids } } : {}),
      },
      data: { readAt: new Date() },
    })
    return { count: result.count }
  },
})
