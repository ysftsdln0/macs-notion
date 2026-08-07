import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

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
