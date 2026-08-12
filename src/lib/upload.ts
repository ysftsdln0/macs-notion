/**
 * Dosya yükleme Server Action ile değil `/api/files/upload` route'uyla
 * yapılır: action gövdeleri büyük ikili veriyi taşımak için uygun değil,
 * route ise `FormData` akışını doğrudan alır ve boyut sınırını yazmadan
 * önce uygular.
 *
 * Dönen değer `Result` biçimini taklit eder — çağıranlar action'larla aynı
 * şekilde ele alsın diye.
 */
export type UploadedAttachment = { id: string; fileName: string; size: number }

export type UploadResult =
  | { ok: true; data: UploadedAttachment }
  | { ok: false; error: string }

export async function uploadAttachment(
  file: File,
  entityType: string,
  entityId: string,
): Promise<UploadResult> {
  const body = new FormData()
  body.set('file', file)
  body.set('entityType', entityType)
  body.set('entityId', entityId)

  let response: Response
  try {
    response = await fetch('/api/files/upload', { method: 'POST', body })
  } catch {
    return { ok: false, error: 'Dosya yüklenemedi, bağlantını kontrol et.' }
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Dosya yüklenemedi.'
    return { ok: false, error: message }
  }
  if (!payload || typeof payload !== 'object' || !('id' in payload)) {
    return { ok: false, error: 'Dosya yüklenemedi.' }
  }
  return { ok: true, data: payload as UploadedAttachment }
}
