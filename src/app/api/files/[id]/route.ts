import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getActor } from '@/lib/auth/session'
import { loadFile, sanitizeFileName } from '@/lib/storage'
import { resolveEntityAccess } from '@/server/entity-access'
import { errorMessages } from '@/lib/errors'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await getActor()
  if (!actor) {
    return NextResponse.json({ error: errorMessages.UNAUTHENTICATED }, { status: 401 })
  }

  const { id } = await params
  const attachment = await db.attachment.findUnique({ where: { id } })
  if (!attachment) {
    return NextResponse.json({ error: errorMessages.NOT_FOUND }, { status: 404 })
  }

  // Ekin yetkisi bağlı olduğu varlığın yetkisidir: bir bütçe fişi ancak
  // o bütçeyi okuyabilenlere açıktır. Erişilemeyen ek 404 döner — 403,
  // ekin var olduğunu doğrulardı.
  const access = await resolveEntityAccess(actor, attachment.entityType, attachment.entityId)
  if (!access?.canRead) {
    return NextResponse.json({ error: errorMessages.NOT_FOUND }, { status: 404 })
  }

  const data = await loadFile(attachment.storagePath)
  if (!data) {
    return NextResponse.json({ error: errorMessages.NOT_FOUND }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': attachment.mime,
      'Content-Length': String(data.byteLength),
      'Content-Disposition': `attachment; filename="${sanitizeFileName(attachment.fileName)}"`,
      // Yetki kontrollü içerik: paylaşılan bir önbellekte durmamalı.
      'Cache-Control': 'private, no-store',
    },
  }) as NextResponse
}
