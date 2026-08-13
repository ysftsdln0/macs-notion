import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { listVisibleChannels } from '@/server/channels-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader, SectionHeading } from '@/components/layout/page'
import { activityVerbIcon, describeActivityVerb } from '@/lib/activity-labels'

export default async function HomePage() {
  await requireActor()
  // channelId null → kulüp geneli hareket, herkese görünür. channelId
  // doluysa yalnızca aktörün görebildiği kanallara ait hareketler listelenir
  // — PRIVATE bir kanaldaki üye eklenmesi bu kanalın dışındakine sızmaz.
  const visibleChannels = await listVisibleChannels()
  const visibleChannelIds = visibleChannels.map((c) => c.id)
  const activities = await db.activity.findMany({
    where: { OR: [{ channelId: null }, { channelId: { in: visibleChannelIds } }] },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { actor: { select: { name: true } } },
  })

  return (
    <PageContainer>
      <PageHeader title="Ana sayfa" />
      <section className="space-y-3">
        <SectionHeading>Son hareketler</SectionHeading>
        {activities.length === 0 ? (
          <EmptyState
            title="Henüz hareket yok"
            description="Kanal açıldıkça ve içerik eklendikçe burada görünecek."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {activities.map((a, i) => {
              const Icon = activityVerbIcon(a.verb)
              return (
                <li
                  key={a.id}
                  // Satır satır kademeli giriş; ilk 8 satırdan sonra gecikme
                  // sabitlenir ki uzun listenin sonu bekletilmesin. Adım 40ms
                  // yerine 25ms: toplam bekleme 400ms'ten 200ms'e iner, sayfa
                  // her açıldığında ödenen bir maliyet bu.
                  className="animate-fade-up flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/60"
                  style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <strong className="font-medium">{a.actor.name}</strong>{' '}
                    {describeActivityVerb(a.verb)}
                  </span>
                  <time className="shrink-0 font-mono text-xs text-muted-foreground">
                    {a.createdAt.toLocaleDateString('tr-TR')}
                  </time>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
