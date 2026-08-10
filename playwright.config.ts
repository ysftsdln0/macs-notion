import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
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
  },
})
