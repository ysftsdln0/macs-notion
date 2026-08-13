import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Sayfa ölçüsü. Denetimde sekiz sayfa `max-w-3xl`, dördü (görevler, etkinlikler,
 * sponsorlar, bütçe) hiç konteyner kullanmıyordu; sidebar'dan içeriğe geçiş her
 * sekmede farklı yere düşüyordu. İki ölçü var, üçüncüsü yok:
 * - `narrow`: metin ve satır listeleri (okunabilir satır uzunluğu)
 * - `wide`  : pano, takvim, tablo (yatayda gerçekten yer isteyenler)
 * Geniş sayfalar da sınırlı: büyük monitörde 2000px'e yayılmasınlar.
 */
const widths = {
  narrow: 'max-w-3xl',
  wide: 'max-w-6xl',
} as const

export function PageContainer({
  width = 'narrow',
  className,
  children,
}: {
  width?: keyof typeof widths
  className?: string
  children: ReactNode
}) {
  return <div className={cn('mx-auto space-y-6', widths[width], className)}>{children}</div>
}

/**
 * Sayfa başlık bloğu: H1 + sağda tek birincil eylem. Tüm sayfalar bunu
 * kullanır ki `tracking-tight` gibi ayrıntılar sayfadan sayfaya kaymasın.
 * `action` birden fazla öğe alabilir (görünüm değiştir + oluştur gibi), ama
 * birincil eylem her zaman sonuncudur.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  )
}

/** Sayfa içi bölüm başlığı. Tek tanım — denetimde iki farklı stili vardı. */
export function SectionHeading({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <h2
      className={cn(
        'text-xs font-medium tracking-wide text-muted-foreground uppercase',
        className
      )}
    >
      {children}
    </h2>
  )
}
