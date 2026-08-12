import Link from 'next/link'
import { can, type Actor } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { countUnreadNotifications } from '@/server/notifications-query'

export async function Sidebar({ actor }: { actor: Actor }) {
  const [channels, unreadCount] = await Promise.all([
    listVisibleChannels(),
    countUnreadNotifications(actor),
  ])
  const mine = new Set(actor.memberships.map((m) => m.channelId))
  // channel:create policy'siyle birebir aynı karar: admin VEYA herhangi bir
  // kanalda LEAD olan herkes. Bu link salt görünürlük kolaylığıdır — asıl
  // yetki kontrolü /channels/new sayfasında ve createChannel action'ında
  // tekrar (ve gerçek şekilde) yapılır.
  const canCreateChannel = can(actor, 'channel:create', { kind: 'channel:new' })

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-6 border-r bg-muted/30 p-4">
      <Link href="/" className="text-lg font-semibold">MACS</Link>

      <div className="space-y-1 text-sm">
        <Link href="/" className="block rounded px-2 py-1 hover:bg-muted">Ana sayfa</Link>
        <Link
          href="/inbox"
          className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted"
        >
          <span>Gelen kutusu</span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </Link>
        <Link href="/docs" className="block rounded px-2 py-1 hover:bg-muted">Dokümanlar</Link>
        <Link href="/tasks" className="block rounded px-2 py-1 hover:bg-muted">Görevler</Link>
        <Link href="/events" className="block rounded px-2 py-1 hover:bg-muted">Etkinlikler</Link>
        <Link href="/sponsors" className="block rounded px-2 py-1 hover:bg-muted">Sponsorlar</Link>
        <Link href="/members" className="block rounded px-2 py-1 hover:bg-muted">Üyeler</Link>
        {actor.globalRole === 'ADMIN' && (
          <>
            <Link href="/admin" className="block rounded px-2 py-1 hover:bg-muted">Yönetim</Link>
            <Link href="/trash" className="block rounded px-2 py-1 hover:bg-muted">Çöp kutusu</Link>
          </>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between px-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">Kanallarım</p>
          {canCreateChannel && (
            <Link href="/channels/new" className="text-xs font-medium text-primary hover:underline">
              Yeni kanal
            </Link>
          )}
        </div>
        {channels.filter((c) => mine.has(c.id)).map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="block rounded px-2 py-1 text-sm hover:bg-muted">
            {c.icon ?? '#'} {c.name}
          </Link>
        ))}
        {channels.filter((c) => mine.has(c.id)).length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">Henüz bir kanalda değilsin.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="px-2 text-xs font-medium uppercase text-muted-foreground">Diğer kanallar</p>
        {channels.filter((c) => !mine.has(c.id)).map((c) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="block rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
            {c.icon ?? '#'} {c.name}
          </Link>
        ))}
      </div>
    </nav>
  )
}
