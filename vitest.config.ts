import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Next.js (dev/build/start) .env.local'ı kendiliğinden yükler; vitest bunu
// yapmaz. Bu yüzden `pnpm test` temiz bir checkout'ta DATABASE_URL'siz
// çöküyordu (final review I5) — geliştirici her seferinde elle export etmek
// zorundaydı. `process.loadEnvFile` zaten process.env'de TANIMLI olan
// değerleri EZMEZ (Node belgeleri), bu yüzden CI'ın kendi `env:` bloğuyla
// geçirdiği değerler burada dokunulmadan kalır — dosya yalnızca eksikleri
// tamamlar. Dosya yoksa (CI'da .env.local hiç tracked/oluşturulmuş değil)
// sessizce atlanır.
if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local')
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Integration tests share one Postgres instance and reset tables via
    // deleteMany() in beforeEach. Running test files in parallel workers
    // races those resets against each other (observed: a FK violation when
    // one file's user.deleteMany() overlapped another file's channel
    // create). Serializing files keeps each file's reset+assert atomic.
    fileParallelism: false,
    server: {
      deps: {
        // next-auth (Auth.js) imports subpaths like "next/server" without an
        // extension; Next 16 ships no package.json "exports" map, so Node's
        // native ESM resolver (used for externalized deps) can't find them.
        // Inlining routes these imports through Vite's resolver instead,
        // which resolves extensionless subpaths correctly.
        inline: ['next-auth', '@auth/prisma-adapter'],
      },
    },
  },
})
