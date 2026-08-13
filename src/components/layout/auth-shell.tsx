import type { ReactNode } from 'react'
import { ArrowRight, CheckSquare, FileText, Hash, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Aurora } from '@/components/ui/aurora'
import { Button } from '@/components/ui/button'
import { Brand } from './brand'

const highlights = [
  { icon: Hash, text: 'Kanallar ve roller tek çatı altında' },
  { icon: CheckSquare, text: 'Görevler, etkinlikler ve sponsorlar' },
  { icon: FileText, text: 'Birlikte yazılan dokümanlar' },
]

/**
 * Auth/onboarding sayfalarının ortak kabuğu:
 * sol marka paneli (aurora + değer önerisi), sağda içerik kartı.
 * `<md` altında marka paneli daralır, içerik tam genişlik alır.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh overflow-hidden">
      <section className="relative hidden w-1/2 shrink-0 overflow-hidden border-r border-border bg-card md:flex md:flex-col md:justify-between md:p-12">
        <Aurora />
        <Brand size="md" className="animate-fade-up relative z-10" />
        <div className="animate-fade-up relative z-10 space-y-6" style={{ animationDelay: '120ms' }}>
          <h1 className="max-w-md text-4xl leading-tight font-semibold tracking-tight">
            Kulübünün koordinasyonu{' '}
            <span className="text-primary">tek yerde</span>.
          </h1>
          <ul className="space-y-3">
            {highlights.map(({ icon: Icon, text }, i) => (
              <li
                key={text}
                className="animate-fade-up flex items-center gap-3 text-sm text-muted-foreground"
                style={{ animationDelay: `${220 + i * 80}ms` }}
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="animate-fade-in relative z-10 text-xs text-muted-foreground" style={{ animationDelay: '500ms' }}>
          Üyelerine özel, kendi sunucunda çalışan çalışma alanı.
        </p>
      </section>

      <section className="relative flex flex-1 items-center justify-center p-6 md:p-12">
        <div className="relative mx-auto w-full max-w-sm">
          <Aurora variant="compact" />
          <div className="animate-fade-up relative z-10 space-y-6 rounded-xl border border-border bg-card p-8 shadow-[0_8px_40px_-12px_color-mix(in_oklch,var(--primary)_18%,transparent)]">
            <Brand size="md" wordmark={false} className="md:hidden" />
            {children}
          </div>
        </div>
      </section>
    </main>
  )
}

/**
 * Auth/davet kartlarının ortak başlığı: ikon rozeti + h1 + açıklama.
 * `tone="destructive"` hata dalında kullanılır ve süzülme animasyonunu
 * bilerek uygulamaz — hata rozetinin oynaması yanlış bir ton verir.
 */
export function AuthHeading({
  icon: Icon,
  tone = 'primary',
  title,
  children,
}: {
  icon?: LucideIcon
  tone?: 'primary' | 'destructive'
  title: string
  children?: ReactNode
}) {
  return (
    <div className="space-y-6">
      {Icon && (
        <span
          className={cn(
            'mx-auto flex size-12 items-center justify-center rounded-xl',
            tone === 'destructive'
              ? 'bg-destructive/10 text-destructive'
              : 'animate-float-slow bg-primary/10 text-primary'
          )}
        >
          <Icon className="size-6" />
        </span>
      )}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children && <p className="text-sm text-muted-foreground">{children}</p>}
      </div>
    </div>
  )
}

/** Auth kartlarındaki tek birincil eylem butonu. */
export function AuthSubmit({ children }: { children: ReactNode }) {
  return (
    <Button type="submit" size="lg" className="w-full">
      {children}
      <span data-icon="inline-end">
        <ArrowRight />
      </span>
    </Button>
  )
}
