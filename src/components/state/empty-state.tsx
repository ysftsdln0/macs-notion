import type { ReactNode } from 'react'
import { Sparkles, type LucideIcon } from 'lucide-react'

/**
 * Boş durum kompozisyonu: ikon rozeti + başlık + açıklama + tek eylem.
 *
 * Aurora bilerek yok. Bir sayfada birden fazla boş durum olabiliyor (örn. görev
 * + etkinlik bölümleri aynı anda boş) ve her biri iki `blur-3xl` katmanı ile
 * 28sn'lik sonsuz animasyon açardı. Rozetin `animate-float-slow`'u tek başına
 * yeterli hareket; renk zaten `bg-primary/10` + `ring-primary/20` üzerinden
 * geliyor.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Sparkles,
}: {
  title: string
  description: string
  action?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card/60 px-8 py-12 text-center">
      <span className="animate-float-slow flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
        <Icon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <p className="font-medium">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
