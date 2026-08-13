import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

/**
 * Prisma CLI kendi başına yalnızca `.env` dosyasını okur; bu depo ise tüm
 * yerel sırları `.env.local`da tutar (Next'in okuduğu, gitignore'daki
 * dosya). Bu yüzden `pnpm db:migrate`, `db:reset` ve `db:seed`
 * "Environment variable not found: DATABASE_URL" ile duruyordu —
 * vitest.config.ts ve playwright.config.ts'in aynı sebeple yaptığı
 * yüklemenin CLI karşılığı burada yapılır.
 *
 * Ortamda zaten tanımlıysa (CI) `loadEnvFile` var olan değişkenleri
 * EZMEZ, bu yüzden CI'ın kendi `env:` bloğu geçerli kalır.
 */
// Bir config dosyası varken Prisma KENDİ .env yüklemesini tamamen bırakır
// ("Prisma config detected, skipping environment variable loading"), bu
// yüzden .env de burada elle yüklenir — yoksa .env kullanan bir kurulum
// bu dosya eklendiği anda bozulurdu. Önce .env.local okunur: `loadEnvFile`
// var olan değişkenleri ezmediği için daha spesifik olan kazanır.
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file)
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
