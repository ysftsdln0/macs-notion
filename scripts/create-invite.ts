import { loadEnvFile } from 'node:process'
// tsx (ya da node) .env.local'i kendiliğinden yüklemez — bu script'in
// doğru veritabanına yazması için (dev DB'yi `.env.local` tanımlar)
// açıkça yüklenir. Yüklenmezse PrismaClient `DATABASE_URL` bulamaz ve
// davet ya hiç oluşmaz ya da başka bir ortamın DB'sine gider.
import { existsSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { createInviteToken, inviteExpiry } from '../src/lib/auth/invite-token'

if (existsSync('.env.local')) {
  loadEnvFile('.env.local')
}

const db = new PrismaClient()

/**
 * `prisma/seed.ts`'teki `seedBootstrapInvite()` BİLEREK kullanılmıyor: o
 * yalnızca boş bir veritabanında (`user.count() === 0`) çalışır ve tek bir
 * bekleyen kurulum daveti olmasını şart koşar. Bu script ise dolu bir dev
 * veritabanına ek admin daveti basmak içindir. Ortak olan parçalar
 * (`createInviteToken`, `inviteExpiry`) paylaşılıyor.
 */
async function main() {
  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: {
      tokenHash,
      globalRole: 'ADMIN',
      channelId: null,
      channelRole: 'MEMBER',
      expiresAt: inviteExpiry(),
    },
  })
  const base = process.env.AUTH_URL ?? 'http://localhost:3100'
  console.log(`\nGiriş daveti üretildi (yalnızca bir kez gösterilir):\n\n  ${base}/invite/${token}\n`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
