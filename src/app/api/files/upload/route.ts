import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getActor } from '@/lib/auth/session'
import { saveFile } from '@/lib/storage'
import { ATTACHABLE_ENTITY_TYPES, resolveEntityAccess } from '@/server/entity-access'
import { errorMessages } from '@/lib/errors'

// İç kullanım için üst sınır. Mime whitelist'i yoktur (plan kararı: kulüp
// içi dosyalar), ama sınırsız yükleme diski doldurabileceği için boyut
// sınırlıdır.
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await getActor()
  if (!actor) {
    return NextResponse.json({ error: errorMessages.UNAUTHENTICATED }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: errorMessages.VALIDATION }, { status: 400 })
  }

  const file = form.get('file')
  const entityType = form.get('entityType')
  const entityId = form.get('entityId')

  if (
    !(file instanceof File) ||
    typeof entityType !== 'string' ||
    typeof entityId !== 'string' ||
    !(ATTACHABLE_ENTITY_TYPES as readonly string[]).includes(entityType)
  ) {
    return NextResponse.json({ error: errorMessages.VALIDATION }, { status: 400 })
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'Dosya boş.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Dosya 10 MB sınırını aşıyor.' }, { status: 413 })
  }

  // Yetki kontrolü diske YAZMADAN önce: yetkisiz bir istek dosyayı hiç
  // bırakmamalı. BudgetEntry budget:write, diğerleri content:write ister —
  // ayrım resolveEntityAccess içinde.
  const access = await resolveEntityAccess(actor, entityType, entityId)
  if (!access) {
    return NextResponse.json({ error: errorMessages.NOT_FOUND }, { status: 404 })
  }
  if (!access.canWrite) {
    // Okuyabildiği ama yazamadığı varlıkta 403; hiç göremediğinde 404 —
    // aksi halde 403 varlığın var olduğunu doğrulardı.
    const status = access.canRead ? 403 : 404
    return NextResponse.json(
      { error: access.canRead ? errorMessages.FORBIDDEN : errorMessages.NOT_FOUND },
      { status },
    )
  }

  const storagePath = await saveFile(Buffer.from(await file.arrayBuffer()))
  const attachment = await db.attachment.create({
    data: {
      fileName: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      storagePath,
      entityType,
      entityId,
      uploadedById: actor.id,
    },
  })

  // `storagePath` BİLEREK dönmez: dosya yalnızca id üzerinden, yetki
  // kontrollü route'tan servis edilir.
  return NextResponse.json({
    id: attachment.id,
    fileName: attachment.fileName,
    size: attachment.size,
  })
}
