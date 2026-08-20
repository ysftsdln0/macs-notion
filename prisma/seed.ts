import { Prisma, PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { createInviteToken, inviteExpiry } from '../src/lib/auth/invite-token'

const db = new PrismaClient()

type SeedResult =
  | { ok: true; token: string; url: string }
  | { ok: false; reason: string }

/**
 * Kurulum daveti: sahipsiz (`createdById: null`), SUPERADMIN yetkili, kanalsız.
 * Davetli linki açıp Google ile girer; davet onu SUPERADMIN yapar ve ilk kanalı
 * kendisi açar. Böylece ilk kullanıcı da herkesle aynı yoldan girer — giriş
 * akışında kuruluma özel bir istisna yoktur.
 *
 * Kademe ADMIN değil SUPERADMIN: rol paneli SUPERADMIN kapısında durur, yani
 * ADMIN yetkili bir kurulum daveti kimseye rol yönetimi açmazdı ve sistem
 * kurulur kurulmaz rolsüz kalırdı.
 *
 * Hem "kullanıcı var mı" hem "bekleyen kurulum daveti var mı" kontrolleri
 * ile ekleme aynı Serializable transaction içindedir — READ COMMITTED'da bu
 * check-then-act'ti: iki ayrı await arasında commit olan bir satır kontrolden
 * kaçardı. Bu projede aynı desen (davet sahiplenme, onboarding sahiplenme,
 * son-LEAD koruması) hep aynı şekilde kapatıldı: okuma da yazma da tek
 * transaction'da, çakışan taraf P2034 alır. Burada CLI olduğu için (server
 * action değil) P2034 fırlatılmaz, Türkçe `{ ok: false, reason }` olarak
 * döner.
 */
export async function seedBootstrapInvite(): Promise<SeedResult> {
  const { token, tokenHash } = createInviteToken()

  try {
    return await db.$transaction(
      async (tx) => {
        // Canlı bir sistemde çalıştırılırsa sessizce sahip daveti üretmemeli.
        if ((await tx.user.count()) > 0) {
          return { ok: false, reason: 'Sistemde zaten kullanıcı var; kurulum daveti üretilmedi.' }
        }

        // İkinci bir çalıştırma (ör. her deploy'da seed), ilkini iptal etmeden
        // ikinci bir canlı SUPERADMIN daveti basmamalı — aksi halde 7 gün
        // boyunca birden fazla geçerli sahip kimlik bilgisi ortada kalır.
        const outstanding = await tx.invite.findFirst({
          where: {
            createdById: null,
            disabledAt: null,
            expiresAt: { gt: new Date() },
            redemptions: { none: { redeemedAt: { not: null } } },
          },
        })
        if (outstanding) {
          return {
            ok: false,
            reason:
              'Geçerli bir kurulum daveti zaten var. Onu kullan; yenisini üretmeden önce ' +
              'veritabanında bu daveti iptal etmen (disabledAt) gerekir.',
          }
        }

        await tx.invite.create({
          data: {
            tokenHash,
            globalRole: 'SUPERADMIN',
            channelId: null,
            createdById: null,
            expiresAt: inviteExpiry(),
            // null = sınırsız. Kurulum daveti tek sahibi açar.
            maxUses: 1,
          },
        })

        const base = process.env.AUTH_URL ?? 'http://localhost:3100'
        return { ok: true, token, url: `${base}/invite/${token}` }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return { ok: false, reason: 'Aynı anda başka bir kurulum daveti üretiliyordu. Tekrar dene.' }
    }
    throw error
  }
}

async function main() {
  const result = await seedBootstrapInvite()
  if (!result.ok) {
    console.log(result.reason)
    return
  }
  console.log('\nKurulum daveti üretildi. Bu link bir kez gösterilir:\n')
  console.log(`  ${result.url}\n`)
  console.log('Linki aç, Google ile gir, profilini tamamla. Sistem sahibi olacaksın.\n')
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
