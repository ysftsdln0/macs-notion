'use client'

import { usePathname } from 'next/navigation'

/**
 * Rota değişiminde içerik alanını yeniden monte edip fade-up girişi oynatır.
 * `key={pathname}` sayesinde yalnızca sayfa değişiminde tetiklenir.
 */
export function AppContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <main className="min-w-0 flex-1">
      <div key={pathname} className="animate-fade-up h-full p-4 md:p-6">
        {children}
      </div>
    </main>
  )
}
