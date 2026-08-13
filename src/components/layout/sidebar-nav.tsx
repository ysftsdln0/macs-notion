'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  CheckSquare,
  FileText,
  Heart,
  Inbox,
  LayoutDashboard,
  Menu,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react'
import type { Channel as PrismaChannel } from '@prisma/client'

import { cn, pickByHash } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sidebar as SidebarShell, DesktopSidebar, useSidebar } from '@/components/ui/sidebar'
import { Brand } from './brand'
import { ThemeToggle } from './theme-toggle'

// Sidebar kanalın yalnızca bu alanlarını okur; dar tutmak server→client
// yükünü de küçültür (bkz. sidebar.tsx'teki projeksiyon).
type Channel = Pick<PrismaChannel, 'id' | 'slug' | 'name' | 'icon'>

type NavProps = {
  channels: Channel[]
  mine: Set<string>
  unreadCount: number
  canCreateChannel: boolean
  canSeeBudget: boolean
  isAdmin: boolean
}

const channelTints = [
  'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  'bg-sky-500/10 text-sky-600 dark:text-sky-400',
]

const sectionLabel = 'px-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase'

/**
 * Satır ikonlarının ortak sınıfı. `shrink-0` SÜS DEĞİL: ray açılırken etiketin
 * `display`'i anında `inline-block`'a döner ama genişlik animasyonu 300ms
 * sürer — o aralıkta satır içeriği 60px'lik kutuya sığmaz ve flex, esneyebilen
 * her öğeyi ezer. İkon esneyebilir kalırsa genişliği sıfıra iner ve kullanıcı
 * her açılışta ikonların "kaybolup geri geldiğini" görür (kanal kutusu
 * `shrink-0` taşıdığı için tek başına ayakta kalıyordu).
 */
const navIcon = 'size-[18px] shrink-0'

/**
 * Etiketlerin solma zamanlaması. Yalnızca `opacity` sürülür: `display`
 * motion'da ara değeri olan bir özellik değil, ona `delay` vermek (kapanışta
 * yazı önce sönsün diye denendi) motion'ın o kareyi büsbütün düşürmesine yol
 * açıyor — etiket `display:none` almıyor, `opacity:0` ile yer kaplamayı
 * sürdürüyor ve daralmış rayda satırı genişletip ikonu ortadan kaydırıyordu
 * (erişilebilirlik ağacından da düşmüyordu, bkz. SidebarLink'teki not).
 */
const labelTransition = { opacity: { duration: 0.15, ease: 'easeOut' as const } }

/**
 * Yalnızca SAĞA yaslanan öğeler için: `+` düğmesi ve tema anahtarı geniş rayda
 * satırın sağ ucunda oturur, ray kapanınca ikon sütununa dönmeleri gerekir.
 * Ortalama React state'i (`expanded`) ile DEĞİL container query ile sürülüyor:
 * state ilk karede dönerken genişlik animasyonu 300ms sürer, o yüzden
 * `expanded`'a bağlanan bir `justify-center` ray hâlâ 300px genişken devreye
 * girer ve öğeyi ortaya fırlatırdı.
 *
 * Satırlarda kullanılmaz — oradaki ikon zaten sola yaslı ve iki durumda da
 * aynı x'te; eşik geçilirken hizası değişseydi yana sıçrardı.
 */
const railCollapsed = '@max-[64px]:justify-center'

/**
 * Gezinme iki yüzeyde birden yaşar: `md` ve üstünde daralıp genişleyen sol
 * sütun, altında üst çubuktan açılan çekmece. İkisi de aşağıdaki `NavBody`'yi
 * basar — aktif durum, rozet ve kanal renkleri tek yerden gelsin diye.
 *
 * Masaüstü sütunu `@/components/ui/sidebar`'ın `DesktopSidebar`'ıdır: 60px
 * rayda durur, imleç üstüne gelince 300px'e açılır. Çekmece ise base-ui
 * Dialog'da kalır (odak tuzağı, Esc, backdrop) — ui/sidebar'ın `MobileSidebar`'ı
 * düz bir div, bunların hiçbirini vermiyor.
 */
export function SidebarNav(props: NavProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <SidebarShell open={open} setOpen={setOpen}>
        <DesktopSidebar
          role="navigation"
          aria-label="Ana gezinme"
          // `dark:bg-sidebar` şart: tailwind-merge `dark:bg-neutral-800`'i
          // varyantsız `bg-sidebar` ile aynı gruba saymaz, koyu modda
          // bileşenin kendi rengi kalırdı.
          className="sticky top-0 h-dvh overflow-hidden border-r bg-sidebar px-0 py-0 dark:bg-sidebar"
          // Ray yalnızca hover'a bağlı olsaydı klavyeyle gezen görsel
          // kullanıcı etiketleri hiç göremezdi; odak sütuna girince de açılır.
          onFocusCapture={() => setOpen(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
          }}
        >
          <NavBody {...props} />
        </DesktopSidebar>
      </SidebarShell>
      <MobileNav {...props} />
    </>
  )
}

/**
 * Mobil üst çubuk + çekmece. `md` altında sidebar tamamen gizli olduğu için bu
 * olmadan dar ekranda hiçbir gezinme yolu kalmıyordu.
 */
function MobileNav(props: NavProps) {
  const pathname = usePathname()

  // Bir linke basınca çekmece kapanmalı; Next.js istemci tarafı gezinmede
  // bileşeni sökmediği için bu kendiliğinden olmaz. Açık durumu bayrak yerine
  // "hangi rotada açıldı" olarak tutuluyor: rota değişince koşul bozulur ve
  // çekmece kapanır. useEffect + setState'e (cascading render) gerek kalmaz.
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === pathname

  return (
    <Dialog.Root open={open} onOpenChange={(next) => setOpenedOn(next ? pathname : null)}>
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar/85 px-3 backdrop-blur-md md:hidden">
        <Dialog.Trigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Gezinmeyi aç" />}
        >
          <Menu />
        </Dialog.Trigger>
        <Link href="/" className="group min-w-0">
          <Brand />
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {props.unreadCount > 0 && (
            <Link
              href="/inbox"
              aria-label={`Gelen kutusu, ${props.unreadCount} okunmamış`}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10px] font-medium text-primary-foreground"
            >
              {props.unreadCount}
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-200 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 md:hidden" />
        <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl duration-200 outline-none data-closed:animate-out data-closed:slide-out-to-left data-open:animate-in data-open:slide-in-from-left md:hidden">
          <Dialog.Title className="sr-only">Ana gezinme</Dialog.Title>
          {/* Çekmecede daralma diye bir şey yok: `animate={false}` NavBody'yi
              kalıcı olarak açık duruma sabitler. */}
          <SidebarShell open setOpen={() => {}} animate={false}>
            <NavBody {...props} />
          </SidebarShell>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function NavBody({
  channels,
  mine,
  unreadCount,
  canCreateChannel,
  canSeeBudget,
  isAdmin,
}: NavProps) {
  const pathname = usePathname()
  const { open, animate } = useSidebar()
  // Çekmecede `animate={false}` geldiği için orada her zaman geniş durum.
  const expanded = !animate || open

  const myChannels = channels.filter((c) => mine.has(c.id))
  const otherChannels = channels.filter((c) => !mine.has(c.id))

  const navItems = [
    { href: '/', label: 'Ana sayfa', icon: LayoutDashboard },
    { href: '/inbox', label: 'Gelen kutusu', icon: Inbox, badge: unreadCount },
    { href: '/docs', label: 'Dokümanlar', icon: FileText },
    { href: '/tasks', label: 'Görevler', icon: CheckSquare },
    { href: '/events', label: 'Etkinlikler', icon: CalendarDays },
    { href: '/sponsors', label: 'Sponsorlar', icon: Heart },
    // Bütçe linki yalnızca en az bir kanalda budget:read olanlara görünür;
    // asıl yetki kontrolü /budget sayfasında tekrar yapılır.
    ...(canSeeBudget ? [{ href: '/budget', label: 'Bütçe', icon: Wallet }] : []),
    { href: '/members', label: 'Üyeler', icon: Users },
  ]

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    // Üç katman: sabit marka, kaydırılan gövde, sabit alt çubuk. Kaydırma
    // gövdeye ait — nav'ın tamamına verilseydi kanal listesi uzadıkça tema
    // anahtarı görüş alanının altına kaçardı.
    // `@container`: satır hizalaması buradan ölçülen gerçek genişliğe bakar
    // (bkz. railCollapsed). Kaydırılan gövde ve alt çubuk aynı bağlamı
    // paylaşsın diye en dışa konuldu.
    <div className="@container flex min-h-0 flex-1 flex-col">
      {/* Marka mobilde üst çubukta zaten var; çekmecede tekrar etmesin. */}
      <Link href="/" className="group hidden shrink-0 px-3.5 pt-3.5 md:block">
        {/* Ray daralınca wordmark 60px'e sığmaz; yalnızca işaret kutusu kalır. */}
        <Brand wordmark={expanded} />
      </Link>

      {/* Yatay dolgu 10px: satır dolgusuyla (px-2.5) toplandığında ikon sütunu
          20px'e, yani 60px'lik kapalı rayın ortasına 0.5px kalarak oturur.
          14px'ken ikon sola kaçtığı için satırları ayrıca ortalamak gerekiyordu
          ve ray eşiği geçerken ikonlar 3.5px yana sıçrıyordu; bu geometri ile
          ortalamaya hiç gerek kalmıyor, ikon iki durumda da aynı x'te durur. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2.5 py-3.5">
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon: Icon, badge }) => (
            <SidebarLink
              key={href}
              href={href}
              label={label}
              active={isActive(href)}
              badge={badge}
              expanded={expanded}
              leading={(active) => (
                <Icon className={cn(navIcon, active ? 'text-primary' : 'text-muted-foreground')} />
              )}
            />
          ))}
        </div>

        <div className="space-y-0.5">
          {/* Daralmış rayda başlık `display:none`; `+` tek başına kalınca
              `justify-between` onu sola yapıştırırdı — ikon sütunundan kaçardı. */}
          <div className={cn('flex items-center justify-between', railCollapsed)}>
            <SectionLabel expanded={expanded}>Kanallarım</SectionLabel>
            {canCreateChannel && (
              <Link
                href="/channels/new"
                className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-primary"
                aria-label="Yeni kanal"
              >
                <Plus className={navIcon} />
              </Link>
            )}
          </div>
          {myChannels.length === 0 && (
            // Daralmış rayda da basılır, yalnızca söner: `expanded &&` ile
            // koşullu render edilseydi 24px'lik satır yoktan var olur ve
            // altındaki bütün ikonları aşağı iterdi (bkz. SectionLabel'daki
            // `reserve` notu). `whitespace-nowrap` + `truncate`: `expanded`
            // ray daha 60px'ken true olur, sarmalanabilir metin o ilk
            // karelerde dört satıra bölünüp aynı zıplamayı yaratıyordu.
            <motion.p
              initial={false}
              animate={{ opacity: expanded ? 1 : 0 }}
              transition={labelTransition}
              className="truncate px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground"
            >
              Henüz bir kanalda değilsin.
            </motion.p>
          )}
          {myChannels.map((c) => (
            <ChannelLink
              key={c.id}
              channel={c}
              active={pathname === `/c/${c.slug}`}
              expanded={expanded}
            />
          ))}
        </div>

        {otherChannels.length > 0 && (
          <div className="space-y-0.5">
            <SectionLabel expanded={expanded} reserve>
              Diğer kanallar
            </SectionLabel>
            {otherChannels.map((c) => (
              <ChannelLink
                key={c.id}
                channel={c}
                active={pathname === `/c/${c.slug}`}
                expanded={expanded}
              />
            ))}
          </div>
        )}

        {isAdmin && (
          <div className="space-y-0.5">
            <SectionLabel expanded={expanded} reserve>
              Yönetim
            </SectionLabel>
            {[
              { href: '/admin', label: 'Yönetim', icon: ShieldCheck },
              { href: '/trash', label: 'Çöp kutusu', icon: Trash2 },
            ].map(({ href, label, icon: Icon }) => (
              <SidebarLink
                key={href}
                href={href}
                label={label}
                active={isActive(href)}
                expanded={expanded}
                leading={(active) => (
                  <Icon className={cn(navIcon, active ? 'text-primary' : 'text-muted-foreground')} />
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tema anahtarı masaüstünde buraya, mobilde üst çubuğa düşer. */}
      <div
        className={cn(
          'hidden shrink-0 items-center justify-between border-t border-sidebar-border px-3.5 py-2.5 md:flex',
          railCollapsed
        )}
      >
        <SectionLabel expanded={expanded} className="px-2.5 text-xs normal-case">
          Görünüm
        </SectionLabel>
        <ThemeToggle />
      </div>
    </div>
  )
}

/**
 * Bölüm başlığı. İki kapanma biçimi var, çünkü başlığın komşusu belirleyici:
 *
 * - Varsayılan (`display`): başlık bir satırı `+` düğmesi ya da tema anahtarı
 *   ile paylaşıyorsa. Orada GENİŞLİĞİ sıfırlanmalı, yoksa daralmış rayda
 *   `justify-center` yan öğeyi ikon sütunundan kaydırır. Bu satırların
 *   yüksekliğini komşu belirlediği için başlığın kaybolması kimseyi oynatmaz.
 *
 * - `reserve` (yalnızca `opacity`): başlık tek başınaysa. `display:none`
 *   olsaydı 16px'lik satırı yok olur ve ALTINDAKİ HER İKON yukarı kayardı —
 *   ray her açılıp kapandığında ikon sütunu zıplıyordu. Yanında hizalanacak
 *   kimse olmadığı için genişliğinin kalması sorun değil; metin `truncate` ile
 *   kırpılır.
 */
function SectionLabel({
  expanded,
  reserve = false,
  className,
  children,
}: {
  expanded: boolean
  reserve?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <motion.p
      // `initial={false}` olmadan ilk boyamada etiket açık gelir, hidrasyondan
      // sonra kapanırdı — daralmış rayda gözle görülür bir sıçrama.
      initial={false}
      animate={
        reserve
          ? { opacity: expanded ? 1 : 0 }
          : { display: expanded ? 'block' : 'none', opacity: expanded ? 1 : 0 }
      }
      transition={labelTransition}
      className={cn(sectionLabel, 'min-w-0 truncate whitespace-nowrap', className)}
    >
      {children}
    </motion.p>
  )
}

function ChannelLink({
  channel,
  active,
  expanded,
}: {
  channel: Channel
  active: boolean
  expanded: boolean
}) {
  return (
    <SidebarLink
      href={`/c/${channel.slug}`}
      label={channel.name}
      active={active}
      expanded={expanded}
      leading={
        <span
          className={cn(
            // Genişlik nav ikonlarıyla birebir aynı (18px): leading sütununda
            // 20px'lik bir kutu kalsaydı kanal satırları diğerlerinden 1px
            // kaymış görünürdü.
            'flex size-[18px] shrink-0 items-center justify-center rounded-md text-[10px] font-semibold',
            pickByHash(channel.id, channelTints)
          )}
        >
          {channel.icon ?? '#'}
        </span>
      }
    />
  )
}

/**
 * Sidebar'daki tek satır primitifi. Ana gezinme, kanallar ve yönetim
 * bölümleri aynı aktif/hover dilini kullansın diye hepsi buradan geçer;
 * `leading` ikon ya da renkli kanal kutusu olabilir.
 *
 * Etiket daralmış rayda `display: none` olur ve `display: none` erişilebilirlik
 * ağacından da düşer — bu yüzden erişilebilir ad `aria-label`'dan gelir, satır
 * içi metinden değil. Aksi hâlde daralmış rayda linklerin adı boşalırdı (ekran
 * okuyucu ve `getByRole('link', { name })` kullanan e2e için birden).
 */
function SidebarLink({
  href,
  label,
  active,
  leading,
  badge,
  expanded,
}: {
  href: string
  label: string
  active: boolean
  leading: ReactNode | ((active: boolean) => ReactNode)
  badge?: number
  expanded: boolean
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // Yükseklik SABİT (`h-9`): `py-2` ile satır boyu içeriğin en uzun
        // öğesine bağlıydı — etiket görünürken 14px'lik metnin 20px'lik satır
        // kutusu, gizliyken 18px'lik ikon ölçüyü verirdi. Satır başına 2px,
        // sekiz satırda 16px: ray her açıldığında ikonlar aşağı kayıyordu.
        //
        // Yatay hizada BİLEREK durum değiştiren hiçbir sınıf yok: ikon iki
        // durumda da satırın sol kenarında durur, kapalı raydaki ortalanmışlık
        // kabın dolgusundan gelir (yukarıdaki nota bak). `railCollapsed` burada
        // kullanılsaydı eşik geçilirken ikon sıçrardı.
        'group/sidebar relative flex h-9 items-center justify-between rounded-lg px-2.5 text-sm transition-colors duration-200',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      )}
    >
      {active && (
        <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      )}
      {/* `min-w-0` uzun kanal adının üç noktaya inmesi için şart. İkon zaten
          `shrink-0` ve satırın sol kenarına yaslı olduğundan sarmalayıcının
          ezilmesi ikonun x'ini değiştirmez. */}
      <span className="flex min-w-0 items-center gap-2.5">
        {typeof leading === 'function' ? leading(active) : leading}
        <motion.span
          initial={false}
          animate={{
            display: expanded ? 'inline-block' : 'none',
            opacity: expanded ? 1 : 0,
          }}
          transition={labelTransition}
          // `transition` yerine `transition-transform`: Tailwind'in `transition`
          // kısayolu opacity'yi de kapsıyordu ve motion'ın kare kare yazdığı
          // satır içi opacity'nin üstüne 150ms'lik ikinci bir eğri biniyordu —
          // etiketler bu yüzden titreyerek geliyordu. Hover'daki translate için
          // yalnızca transform geçişi gerekli.
          className="truncate whitespace-pre transition-transform duration-150 group-hover/sidebar:translate-x-1"
        >
          {label}
        </motion.span>
      </span>
      {badge !== undefined && badge > 0 && (
        // Rozet daralmış rayda da görünür kalır (okunmamış sayısı raydaki tek
        // sinyal); yalnızca satırın sağından ikonun üstüne taşınır.
        <span
          className={cn(
            'animate-pop flex shrink-0 items-center justify-center rounded-full bg-primary font-mono font-medium text-primary-foreground',
            expanded
              ? 'h-5 min-w-5 px-1.5 text-[10px]'
              : 'absolute -top-0.5 right-1 h-4 min-w-4 px-1 text-[9px]'
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  )
}
