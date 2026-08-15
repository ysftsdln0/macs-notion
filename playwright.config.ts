import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'
import { applyTestDatabaseUrl } from './tests/helpers/test-database-url'

// Next'in build/start için otomatik yüklediği .env.local, Playwright'ın KENDİ
// test çalıştırıcısı süreci için yüklenmez — spec dosyaları (`tests/e2e/**`,
// `tests/e2e/helpers/session.ts`) doğrudan `new PrismaClient()` çağırır ve bu
// süreç DATABASE_URL'i yalnızca ortamdan görür (final review I5'in vitest
// tarafı için yaptığı düzeltmenin aynısı, burada da gerekli — CI'ın kendi
// `env:` bloğu zaten tanımlıysa üzerine yazılmaz, bkz. vitest.config.ts'teki
// aynı yorum).
if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local')
}

// E2E de geliştirme veritabanına DEĞİL, `<ad>_test` veritabanına yazar.
// Spec'ler her koşuda yeni kayıtlar bırakıyor (temizlemiyorlar) ve bu
// veritabanı `pnpm dev`inkiyle aynıydı: gerçek hesapların yanına test
// çöpü birikiyordu. Gerekçenin tamamı `tests/helpers/test-database-url.ts`.
// Sunuculara AÇIKÇA geçirilir — alt süreçler bu satırı değil, yalnızca
// ortamı görür.
const databaseUrl = applyTestDatabaseUrl()
// COLLAB_URL açıkça geçirilir: `constants.ts` varsayılanı zaten aynı adres
// olduğu için testler bunsuz da geçerdi, ama o zaman e2e "adres doğru
// yapılandırılmış mı" sorusunu hiç sormamış olurdu. Açık geçmek, değişken
// adı değişirse testlerin de değişmesini zorunlu kılar.
const serverEnv: Record<string, string> = {
  ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  COLLAB_URL: 'ws://127.0.0.1:1234',
}

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:3100' },
  // Şemayı test veritabanına uygular (yoksa veritabanını da oluşturur).
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: [{
    // Production `node server.js` (standalone çıktı, bkz. Dockerfile'ın
    // `run` hedefi) ile aynı giriş noktasını kullanır. `next.config.ts`
    // `output: "standalone"` ayarlıyken salt `next start` çalışır ama
    // Next 16 bunun yanlış giriş noktası olduğunu uyarır — standalone
    // sunucu normal build'in içermediği bir dosya izleme (tracing) adımı
    // kullanır, `next start` bunu atlar. `pnpm start:standalone`
    // (package.json) statik/`public` varlıklarını `.next/standalone`
    // altına kopyalayıp `server.js`'i `PORT=3100` ile başlatarak E2E
    // testlerinin gerçek production giriş noktasına karşı çalışmasını
    // sağlar.
    command: 'pnpm build && pnpm start:standalone',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: serverEnv,
  }, {
    // Canlı doküman düzenleme için Hocuspocus sunucusu. Web ile AYNI
    // AUTH_SECRET'ı görmeli — sayfa collab token'ını o sırla imzalar,
    // burası doğrular. Hocuspocus HTTP kökünde 200 döndüğü için Playwright
    // hazır olma kontrolünü normal bir url ile yapabiliyor.
    command: 'pnpm --filter macs-collab start',
    url: 'http://127.0.0.1:1234',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: serverEnv,
  }],
})
