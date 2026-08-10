import { PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { createInviteToken } from '../src/lib/auth/invite-token'

const db = new PrismaClient()

const INVITE_TTL_DAYS = 7

type SeedResult =
  | { ok: true; token: string; url: string }
  | { ok: false; reason: string }

/**
 * Kurulum daveti: sahipsiz (`createdById: null`), ADMIN yetkili, kanalsız.
 * Davetli linki açıp Google ile girer; `events.createUser` onu ADMIN yapar
 * ve ilk kanalı kendisi açar. Böylece ilk kullanıcı da herkesle aynı
 * yoldan girer — giriş akışında kuruluma özel bir istisna yoktur.
 */
export async function seedBootstrapInvite(): Promise<SeedResult> {
  // Canlı bir sistemde çalıştırılırsa sessizce admin daveti üretmemeli.
  if ((await db.user.count()) > 0) {
    return { ok: false, reason: 'Sistemde zaten kullanıcı var; kurulum daveti üretilmedi.' }
  }

  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: {
      tokenHash,
      globalRole: 'ADMIN',
      channelId: null,
      createdById: null,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5),
    },
  })

  const base = process.env.AUTH_URL ?? 'http://localhost:3100'
  return { ok: true, token, url: `${base}/invite/${token}` }
}

async function main() {
  const result = await seedBootstrapInvite()
  if (!result.ok) {
    console.log(result.reason)
    return
  }
  console.log('\nKurulum daveti üretildi. Bu link bir kez gösterilir:\n')
  console.log(`  ${result.url}\n`)
  console.log('Linki aç, Google ile gir, profilini tamamla. Yönetici olacaksın.\n')
}

// `tsx prisma/seed.ts` ile çalıştırıldığında bu dosya doğrudan giriş
// noktasıdır ve `main()` çalışmalıdır. Testler bu modülü sadece
// `seedBootstrapInvite`'ı almak için import eder — o zaman `process.argv[1]`
// test çalıştırıcısına (vitest) işaret eder, bu dosyaya değil, bu yüzden
// import'un kendisi `main()`'i tetiklemez.
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().finally(() => db.$disconnect())
}
