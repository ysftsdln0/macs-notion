'use client'

import { useEffect } from 'react'
import './globals.css'

/**
 * `src/app/layout.tsx`'in (kök layout'un) kendisi hata atarsa, altındaki
 * hiçbir error.tsx onu yakalayamaz — kapsayacak bir ebeveyn kalmaz. Next bu
 * durum için ayrı bir sözleşme ister: bu dosya kök layout'un YERİNE geçer,
 * bu yüzden kendi <html>/<body>'sini render eder ve global stil sayfasını
 * kendisi import eder (normalde bunu kök layout yapardı, ama o artık devre
 * dışı). Bu olmadan kullanıcı Next'in İngilizce yerleşik global-error
 * sayfasını görür (final review I4).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global] kök layout hatası', error)
  }, [error])

  return (
    <html lang="tr">
      <body className="min-h-full antialiased">
        <main className="flex min-h-dvh items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center">
            <h1 className="text-xl font-semibold">Beklenmeyen bir hata oldu</h1>
            <p className="text-sm text-muted-foreground">
              Sayfa yüklenemedi. Tekrar denemek için aşağıdaki düğmeyi kullan.
            </p>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
            >
              Tekrar dene
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
