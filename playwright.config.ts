import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

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

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:3100' },
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
  }, {
    // Canlı doküman düzenleme için Hocuspocus sunucusu. Web ile AYNI
    // AUTH_SECRET'ı görmeli — sayfa collab token'ını o sırla imzalar,
    // burası doğrular. Hocuspocus HTTP kökünde 200 döndüğü için Playwright
    // hazır olma kontrolünü normal bir url ile yapabiliyor.
    command: 'pnpm --filter macs-collab start',
    url: 'http://127.0.0.1:1234',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  }],
})
