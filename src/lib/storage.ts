import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

/**
 * Yerel disk depolaması. Yükleme dizini `UPLOAD_DIR` ile ayarlanır
 * (production'da bir Docker volume'u, bkz. compose.yml `macs_uploads`).
 *
 * Dosya adı ASLA disk yolunu belirlemez: yol `randomUUID()` ile üretilir.
 * Kullanıcının verdiği ad yalnızca `Attachment.fileName`'de saklanır ve
 * indirmede `Content-Disposition`'da kullanılır — böylece `../../etc/passwd`
 * gibi bir ad yazma yolunu etkileyemez.
 */
function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

export async function saveFile(data: Buffer): Promise<string> {
  const dir = uploadDir()
  await mkdir(dir, { recursive: true })
  const storagePath = path.join(dir, randomUUID())
  await writeFile(storagePath, data)
  return storagePath
}

export async function loadFile(storagePath: string): Promise<Buffer | null> {
  try {
    return await readFile(storagePath)
  } catch {
    // Kayıt var ama dosya yok (elle silinmiş, yedekten dönmemiş): çağıran
    // bunu 404'a çevirir, istisna olarak sürüklemez.
    return null
  }
}

export async function deleteFile(storagePath: string): Promise<void> {
  await unlink(storagePath).catch(() => {})
}

/**
 * İndirme başlığı için güvenli dosya adı: satır sonu ve tırnak karakterleri
 * başlık enjeksiyonuna açık kapı bırakır.
 */
export function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[\r\n"\\]/g, '_').trim()
  return base.length > 0 ? base.slice(0, 200) : 'dosya'
}
