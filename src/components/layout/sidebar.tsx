import Link from 'next/link'
import type { Actor } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'

export async function Sidebar({ actor }: { actor: Actor }) {
  const channels = await listVisibleChannels()
  const mine = new Set(actor.memberships.map((m) => m.channelId))

  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-6 border-r bg-muted/30 p-4">
      <Link href="/" className="text-lg font-semibold">MACS</Link>

      <div className="space-y-1 text-sm">
        <Link href="/" className="block rounded px-2 py-1 hover:bg-muted">Ana sayfa</Link>
        <Link href="/members" className="block rounded px-2 py-1 hover:bg-muted">Üyeler</Link>
        {actor.globalRole === 'ADMIN' && (
          <Link href="/admin" className="block rounded px-2 py-1 hover:bg-muted">Yönetim</Link>
        )}
      </div>

      <div className="space-y-1">
        <p className="px-2 text-xs font-medium uppercase text-muted-foreground">Kanallarım</p>
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
