import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * Test veritabanının şemasını hazırlar. `migrate deploy` veritabanı yoksa
 * onu da oluşturur, yani temiz bir checkout'ta `pnpm test` ek bir adım
 * istemez.
 *
 * `db push` KULLANILMAZ: `searchVector` generated tsvector kolonları
 * `schema.prisma`da tanımlı değildir (Prisma ifade edemez), yalnızca elle
 * yazılmış migration SQL'inde yaşarlar — `db push` onları oluşturmaz ve
 * arama testleri "column does not exist" ile patlardı.
 *
 * DATABASE_URL çağıran config tarafından (kök `vitest.config.ts`,
 * `collab/vitest.config.ts`, `playwright.config.ts`) test veritabanına
 * çevrilmiş durumdadır. `cwd` bu dosyadan türetilir: collab paketinden
 * çağrıldığında çalışma dizini `collab/`dur ve prisma şemayı orada bulamaz.
 */
const repoRoot = path.join(import.meta.dirname, '..')

export default function setup(): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  })
}
