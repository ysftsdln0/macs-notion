'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/state/error-state'

/**
 * `src/app/` kökündeki hata sınırı. `(app)/error.tsx` yalnızca `(app)` grubu
 * İÇİNDEKİ sayfaları kapsar — kendi ebeveyni olan `(app)/layout.tsx`'in
 * attığı bir hatayı yakalayamaz (bir sınır kendi ebeveynini kapsayamaz).
 * `/login`, `/onboarding` ve `/invite/[token]` ise `(app)` grubunun tamamen
 * dışında, kendi hata sınırları yok. Bu dosya olmadan hepsi Next'in
 * İngilizce yerleşik hata sayfasına düşer (final review I4).
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[root] beklenmeyen hata', error)
  }, [error])

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm">
        <ErrorState message="Beklenmeyen bir hata oldu. Tekrar dene." onRetry={reset} />
      </div>
    </main>
  )
}
