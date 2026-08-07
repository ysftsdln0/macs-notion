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
    // Bu action bir Server Action olarak doğrudan POST edilebilir; bayat bir
    // sekme, tekrarlanan istek ya da eşzamanlı iki gönderim (iki sekme) ikinci
    // bir çağrıya yol açabilir. "Önce oku, sonra yaz" iki eşzamanlı çağrının
    // ikisine de "ilk" dedirtir (TOCTOU) — invite akışındaki claimInvite ile
    // aynı desen: tek koşullu UPDATE, iki eşzamanlı istekten yalnızca birine
    // count === 1 verir. Sahiplenme, profil yazımından ayrı ve önce çalışır;
    // profil yazımı (ya da activity kaydı) sonradan başarısız olursa kullanıcı
    // isim değişmeden onboarded işaretlenmiş kalır — bu, activity satırının
    // çoğalmasına izin vermekten daha güvenli yöndür.
    const claimed = await db.user.updateMany({
      where: { id: actor.id, onboardedAt: null },
      data: { onboardedAt: new Date() },
    })
    const isFirstOnboarding = claimed.count === 1

    const user = await db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: actor.id },
        data: { name: input.name, title: input.title || null },
      })
      if (isFirstOnboarding) {
        await recordActivity(tx, {
          actorId: actor.id, verb: 'member.joined',
          entityType: 'User', entityId: updated.id,
        })
      }
      return updated
    })

    return { id: user.id }
  },
})
