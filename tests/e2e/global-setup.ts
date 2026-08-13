import setup from '../global-setup'

/**
 * Playwright'ın globalSetup sözleşmesi vitest'inkiyle aynı işi ister:
 * şemayı test veritabanına uygula (yoksa veritabanını da oluştur).
 * Mantık tek yerde durur — bkz. `tests/global-setup.ts`.
 */
export default function globalSetup(): void {
  setup()
}
