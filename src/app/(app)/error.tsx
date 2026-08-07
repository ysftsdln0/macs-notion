'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/state/error-state'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app] beklenmeyen hata', error)
  }, [error])

  return (
    <div className="mx-auto max-w-3xl">
      <ErrorState message="Beklenmeyen bir hata oldu. Tekrar dene." onRetry={reset} />
    </div>
  )
}
