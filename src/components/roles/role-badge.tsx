import { cn } from '@/lib/utils'

/**
 * Renk kullanıcı tarafından girilir, dolayısıyla arka planı doğrudan o renge
 * boyamak okunabilirliği garanti edemez (koyu mavi üstünde koyu yazı). Renk
 * yalnızca bir nokta olarak taşınır; metin her zaman tema renginde kalır.
 */
export function RoleBadge({
  role,
  className,
}: {
  role: { name: string; color: string | null }
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: role.color ?? 'var(--color-muted-foreground)' }}
      />
      {role.name}
    </span>
  )
}
