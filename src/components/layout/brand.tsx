import { Layers } from 'lucide-react'

import { appName } from '@/lib/constants'
import { cn } from '@/lib/utils'

const sizes = {
  sm: { badge: 'size-8', icon: 'size-4.5', wordmark: 'text-lg' },
  md: { badge: 'size-9', icon: 'size-5', wordmark: 'text-xl' },
} as const

/**
 * MACS marka işareti: marka dolgulu ikon kutusu + wordmark. Sidebar, mobil
 * başlık ve auth kabuğu aynı işareti gösterir; buradan tek noktadan yönetilir.
 * `wordmark={false}` yalnızca ikon kutusunu basar (dar ekranlar).
 *
 * Kutu --brand okur (koyu lacivert marka rengi), noktacık --primary okur
 * (etkileşim aksanı). Nokta --brand olsaydı gövde metninden ayrışmazdı —
 * ikisinin kontrastı 1.04:1, bkz. globals.css'teki token notu.
 */
export function Brand({
  size = 'sm',
  wordmark = true,
  className,
}: {
  size?: keyof typeof sizes
  wordmark?: boolean
  className?: string
}) {
  const s = sizes[size]
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'flex items-center justify-center rounded-xl bg-brand text-primary-foreground shadow-[0_4px_16px_-6px_var(--brand)] transition-transform duration-200 group-hover:scale-105',
          s.badge
        )}
      >
        <Layers className={s.icon} />
      </span>
      {wordmark && (
        <span className={cn('font-semibold tracking-tight', s.wordmark)}>
          {appName}
          <span className="text-primary">.</span>
        </span>
      )}
    </span>
  )
}
