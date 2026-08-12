'use server'

import { z } from 'zod'
import { defineAction } from '@/lib/action'
import { getActor } from '@/lib/auth/session'
import { searchDocuments, type DocumentSearchHit } from '@/server/search'

/**
 * Arayüzden çağrılabilen tek arama uç noktası. Aktörü `getActor` ile kendisi
 * çözer — `searchDocuments`'ı doğrudan 'use server' yapmak, çağıranın
 * `actor`'ü tel üzerinden uydurmasına izin verirdi.
 *
 * Yetki kontrolü `authorize`'da değil sorgunun içinde: oturumu olan herkes
 * arama yapabilir, ama sonuç kümesi her zaman okuyabildikleriyle sınırlıdır.
 */
export const searchDocumentsAction = defineAction({
  input: z.object({ query: z.string().max(200) }),
  getActor,
  authorize: async () => ({ allowed: true as const }),
  handler: async ({ actor, input }): Promise<DocumentSearchHit[]> =>
    searchDocuments(input.query, actor),
})
