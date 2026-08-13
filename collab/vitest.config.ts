import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import { applyTestDatabaseUrl } from '../tests/helpers/test-database-url'

// Kök `vitest.config.ts` ile aynı gerekçe: vitest .env.local'ı kendiliğinden
// yüklemez, bu yüzden `pnpm --filter macs-collab test` DATABASE_URL'siz
// çöküyordu — CI kendi `env:` bloğunu geçtiği için orada yeşil, yalnızca
// yerelde kırık. Yol kökten çözülür (bu paket bir alt dizin) ve
// `process.loadEnvFile` zaten TANIMLI değerleri ezmez.
if (existsSync('../.env.local')) {
  process.loadEnvFile('../.env.local')
}

// Bu testler de `user.deleteMany()` ile tabloları boşaltıyor; kök testlerle
// aynı sebeple geliştirme veritabanına DEĞİL `<ad>_test` veritabanına
// bağlanırlar (bkz. ../tests/helpers/test-database-url.ts).
applyTestDatabaseUrl()

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['../tests/global-setup.ts'],
  },
})
