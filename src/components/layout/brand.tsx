import Image from 'next/image'

import { appName } from '@/lib/constants'
import { cn } from '@/lib/utils'

const sizes = {
  sm: { badge: 'size-8', px: 32, wordmark: 'text-lg' },
  md: { badge: 'size-9', px: 36, wordmark: 'text-xl' },
} as const

/**
 * MACS marka işareti: kulübün dairesel logosu + wordmark. Sidebar, mobil
 * başlık ve auth kabuğu aynı işareti gösterir; buradan tek noktadan yönetilir.
 * `wordmark={false}` yalnızca logoyu basar (dar ekranlar).
 *
 * Logo `public/macs-logo.png` — kendi lacivert zeminini taşır, bu yüzden eski
 * ikon kutusunun `bg-brand` dolgusu yok. Küçük boyutta halka yazısı okunmaz,
 * bu beklenen: işaret o ölçekte "lacivert rozet + beyaz MACS" olarak çalışır.
 * Wordmark noktası --primary okur (etkileşim aksanı); --brand olsaydı gövde
 * metninden ayrışmazdı — bkz. globals.css'teki token notu.
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
      <Image
        src="/macs-logo.png"
        alt=""
        width={s.px}
        height={s.px}
        className={cn(
          'shrink-0 rounded-full shadow-[0_4px_16px_-6px_var(--brand)] transition-transform duration-200 group-hover:scale-105',
          s.badge
        )}
      />
      {wordmark && (
        <span className={cn('font-semibold tracking-tight', s.wordmark)}>
          {appName}
          <span className="text-primary">.</span>
        </span>
      )}
    </span>
  )
}
