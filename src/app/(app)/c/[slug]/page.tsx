import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { EmptyState } from '@/components/state/empty-state'
import { ChannelMemberRowActions } from './channel-member-row-actions'
import { AddChannelMemberForm } from './add-channel-member-form'

export default async function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireActor()
  const { slug } = await params
  const channel = await db.channel.findUnique({
    where: { slug },
    include: { members: { include: { user: { select: { id: true, name: true, title: true } } } } },
  })
  if (!channel || channel.archivedAt) notFound()

  // Yetki kontrolü veriyi göstermeden önce. Erişim yoksa varlığı da sızdırılmaz.
  const allowed = can(actor, 'channel:read', {
    kind: 'channel', id: channel.id,
    visibility: channel.visibility, archivedAt: channel.archivedAt,
  })
  if (!allowed) notFound()

  // Aynı can() kararı — addChannelMember/removeChannelMember'ın
  // authorizeChannelMembership'te uyguladığıyla birebir aynı. UI bu kararı
  // yalnızca formu göstermek/gizlemek için kullanır; asıl yetki denetimi
  // her iki action'da da tekrar (ve gerçek şekilde) yapılır.
  const canManage = can(actor, 'channel:manageMembers', {
    kind: 'channel', id: channel.id,
    visibility: channel.visibility, archivedAt: channel.archivedAt,
  })

  const candidates = canManage
    ? await db.user.findMany({
        where: { isActive: true, id: { notIn: channel.members.map((m) => m.userId) } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : []

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{channel.name}</h1>
        {channel.description && (
          <p className="text-sm text-muted-foreground">{channel.description}</p>
        )}
      </header>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Üyeler</h2>
        <ul className="space-y-1 text-sm">
          {channel.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span>{m.user.name} {m.channelRole === 'LEAD' && '· Lider'}</span>
              {canManage && (
                <ChannelMemberRowActions
                  channelId={channel.id}
                  userId={m.user.id}
                  name={m.user.name}
                  channelRole={m.channelRole}
                />
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          candidates.length > 0 ? (
            <AddChannelMemberForm channelId={channel.id} candidates={candidates} />
          ) : (
            <p className="text-xs text-muted-foreground">Eklenecek başka aktif üye yok.</p>
          )
        )}
      </section>
      <EmptyState
        title="İçerik henüz yok"
        description="Doküman, görev ve etkinlikler sonraki sürümde bu sayfada listelenecek."
      />
    </div>
  )
}
