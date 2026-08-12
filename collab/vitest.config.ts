import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Kök `vitest.config.ts` ile aynı gerekçe: vitest .env.local'ı kendiliğinden
// yüklemez, bu yüzden `pnpm --filter macs-collab test` DATABASE_URL'siz
// çöküyordu — CI kendi `env:` bloğunu geçtiği için orada yeşil, yalnızca
// yerelde kırık. Yol kökten çözülür (bu paket bir alt dizin) ve
// `process.loadEnvFile` zaten TANIMLI değerleri ezmez.
if (existsSync('../.env.local')) {
  process.loadEnvFile('../.env.local')
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
