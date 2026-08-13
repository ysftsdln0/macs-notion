/**
 * Bu dosya BİLEREK 'use server' taşımaz. `listVisibleChannels` bir Actor
 * parametresi almaz; kimliği kendisi çözer. 'use server' bu dosyada olsaydı
 * export edilen her fonksiyon herkese açık bir RPC uç noktası olurdu — çağıran
 * `actor` nesnesini tel üzerinden (POST gövdesinde) kendisi seçip
 * `{ globalRole: 'ADMIN', memberships: [] }` gönderebilir, PRIVATE kanalları
 * dahil tüm kanalları döndürtebilirdi. `requireActor()` yalnızca sayfa
 * render'ında çalışır; Server Action'lar sayfa render'ından ÖNCE çalışır ve bu
 * korumayı atlar. Bkz. `invite-service.ts`'teki aynı gerekçe — bu projede
 * daha önce de yapılmış bir hata.
 */

import { db } from '@/lib/db'
import { getActor } from '@/lib/auth/session'
import { has } from '@/lib/auth/policy'
import type { Channel } from '@prisma/client'

export async function listVisibleChannels(): Promise<Channel[]> {
  const actor = await getActor()
  if (!actor) return []

  const memberChannelIds = actor.memberships.map((m) => m.channelId)
  return db.channel.findMany({
    where: {
      archivedAt: null,
      ...(has(actor, 'CONTENT_READ_ALL')
        ? {}
        : { OR: [{ visibility: 'OPEN' }, { id: { in: memberChannelIds } }] }),
    },
    orderBy: { name: 'asc' },
  })
}
