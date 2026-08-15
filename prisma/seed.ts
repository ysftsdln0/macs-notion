import { Prisma, PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { createInviteToken, inviteExpiry } from '../src/lib/auth/invite-token'

const db = new PrismaClient()

type SeedResult =
  | { ok: true; token: string; url: string }
  | { ok: false; reason: string }

/**
 * Kulübün örgüt şemasındaki kademeler. `isSystem: true` oldukları için
 * silinemezler ve adları değişmez — bu seed ve kod onları adlarıyla tanır.
 * İzinleri panelden değiştirilebilir: kulübün Yönetim Kurulu'na ne verdiğini
 * zamanla değiştirmesi meşru bir ihtiyaç.
 *
 * Rol YÖNETİMİ bilerek listede yok — o bir izin değil, SUPERADMIN kapısı.
 * İzinleri dağıtan yetkinin kendisi ayarlanabilir olsaydı, onu taşıyan
 * herkes kendine her şeyi yazabilirdi.
 */
const SYSTEM_ROLES = [
  {
    name: 'Yönetim Kurulu',
    slug: 'yonetim-kurulu',
    color: '#2563eb',
    position: 1,
    permissions: [
      'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL',
      'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
      'MEMBER_MANAGE', 'INVITE_MANAGE',
      'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL', 'TRASH_MANAGE',
    ],
  },
  {
    name: 'Genel Sekreter',
    slug: 'genel-sekreter',
    color: '#7c3aed',
    position: 2,
    permissions: ['CONTENT_READ_ALL', 'INVITE_MANAGE', 'TRASH_MANAGE'],
  },
  {
    name: 'İnsan Kaynakları',
    slug: 'insan-kaynaklari',
    color: '#059669',
    position: 3,
    permissions: ['MEMBER_MANAGE', 'INVITE_MANAGE'],
  },
] as const

/**
 * Her deploy'da çalışabilir olmalı: var olan rolün izinlerini EZMEZ, yalnızca
 * eksik olanı ekler. Aksi halde panelden yapılan her ayar bir sonraki
 * deploy'da sessizce geri alınırdı.
 */
export async function seedSystemRoles(): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    const existing = await db.role.findUnique({ where: { slug: role.slug } })
    if (existing) continue
    await db.role.create({
      data: {
        name: role.name,
        slug: role.slug,
        color: role.color,
        position: role.position,
        isSystem: true,
        permissions: [...role.permissions],
      },
    })
  }
}

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
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        })
        if (outstanding) {
          return {
            ok: false,
            reason:
              'Geçerli bir kurulum daveti zaten var. Onu kullan; yenisini üretmeden önce ' +
              'veritabanında bu daveti iptal etmen (revokedAt) gerekir.',
          }
        }

        await tx.invite.create({
          data: {
            tokenHash,
            globalRole: 'SUPERADMIN',
            channelId: null,
            createdById: null,
            expiresAt: inviteExpiry(),
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
  // Roller kullanıcıdan bağımsız: kurulum daveti üretilmese bile (sistemde
  // zaten kullanıcı varsa) eksik sistem rolleri tamamlanmalı.
  await seedSystemRoles()
  console.log('Sistem rolleri hazır (Yönetim Kurulu, Genel Sekreter, İnsan Kaynakları).')

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
