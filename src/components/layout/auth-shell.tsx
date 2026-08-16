import type { ReactNode } from 'react'
import { ArrowRight, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import AnimatedGradient from '@/components/ui/animated-gradient'
import { Button } from '@/components/ui/button'
import { Brand } from './brand'

/**
 * Auth/onboarding sayfalarının ortak kabuğu: tam ekran karanlık sahne,
 * ortada cam kart. Sahne her zaman koyudur — `dark` sınıfı kabuğun kendisine
 * basılır ki kullanıcının tema tercihi ne olursa olsun token'lar içeride koyu
 * çözülsün. Giriş bir "üye kapısı"dır, uygulamanın temasından bağımsız tek
 * bir atmosferi vardır.
 *
 * Arka plan WebGL akışkan gradyandır (AnimatedGradient); renkleri marka
 * ailesinden sabit hex'ler — token okuyamaz çünkü shader'a CSS değişkeni
 * geçmez (#05070d ≈ sahne zemini, #718ed6 = koyu mod --brand, #a9bae6 açık
 * vurgu). main'in düz zemini WebGL yokken/yüklenene dek görünen fallback.
 * Bileşen prefers-reduced-motion'da tek kare çizer (bkz. animated-gradient).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="dark relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[oklch(0.13_0.018_248)] p-6 text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* Statik ikiz: WebGL sahnesinin CSS yaklaşımı (sağdan inen çapraz
            ipeksi şerit). Sunucu HTML'iyle geldiği için İLK karede boyanır —
            JS/hydration beklemez. Canvas ilk karesini çizince opacity ile
            bunun üstüne yumuşakça biner (bkz. animated-gradient.tsx); yani bu
            katman yalnızca soğuk yüklemenin ilk yüzlerce ms'inde görünür. */}
        <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_48%,#1d2a4d_58%,#718ed6_72%,#4a5f9e_82%,#0c1226_94%)]" />
        <AnimatedGradient
          // zIndex -1 varsayılanı burada işe yaramaz: negatif katman main'in
          // kendi zemininin altına düşer ve hiç görünmezdi.
          style={{ zIndex: 0 }}
          config={{
            preset: 'custom',
            color1: '#05070d',
            color2: '#718ed6',
            color3: '#a9bae6',
            rotation: -50,
            proportion: 1,
            scale: 0.01,
            speed: 14,
            distortion: 0,
            swirl: 50,
            swirlIterations: 16,
            softness: 47,
            offset: -299,
            shape: 'Checks',
            shapeSize: 45,
          }}
          noise={{ opacity: 0.3 }}
        />
        {/* Kenarlara doğru kararan vinyet gradyanın ÜSTÜNDE: derinlik verir
            ve kart çevresindeki parlak girdapları karartıp metni okunur tutar. */}
        <div className="absolute inset-0 z-[1] bg-[radial-gradient(120%_100%_at_50%_45%,transparent_45%,oklch(0.09_0.015_248/0.7))]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Giriş koreografisi (bilerek ağır tempolu): boş cam tam ekrandan
            küçülür (0–2.5s), kart otururken yazılar blur'dan belirir (1.4s),
            ışık çizgisi süpürülür (2s), alt satır en son (2.7s). Gecikmeler
            animasyon sürelerine göre elle dizildi — değiştirirken sırayı
            koru: kart > içerik > ışık > dipnot. */}
        <div className="animate-card-in relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] p-8 shadow-[0_24px_80px_-24px_oklch(0.05_0.01_248/0.8)] backdrop-blur-xl">
          {/* Üst kenarda ince ışık çizgisi: cam yüzeye vuran yansıma. */}
          <span
            aria-hidden
            className="animate-light-sweep absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
            style={{ animationDelay: '2000ms' }}
          />
          <div className="animate-blur-reveal space-y-6" style={{ animationDelay: '1400ms' }}>
            <Brand size="md" className="justify-center" />
            {children}
          </div>
        </div>
      </div>
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
