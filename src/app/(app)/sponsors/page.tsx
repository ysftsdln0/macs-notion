import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { listSponsors } from '@/server/sponsors-query'
import { EmptyState } from '@/components/state/empty-state'
import { Badge } from '@/components/ui/badge'
import { describeSponsorStatus, formatAmount } from '@/lib/finance-labels'
import { CreateSponsorDialog } from './create-sponsor-dialog'
import { SponsorBoard } from './board'

type SearchParams = Promise<{ view?: string }>

export default async function SponsorsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor()
  const params = await searchParams
  const view = params.view === 'table' ? 'table' : 'board'

  const [channels, sponsors] = await Promise.all([
    listVisibleChannels(),
    listSponsors(actor),
  ])

  const writableChannels = channels
    .filter((c) =>
      can(actor, 'content:write', {
        kind: 'content',
        channelId: c.id,
        channelVisibility: c.visibility,
        channelArchivedAt: c.archivedAt,
      }),
    )
    .map((c) => ({ id: c.id, name: c.name }))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Sponsorlar</h1>
        <div className="flex items-center gap-2">
          <Link
            href={view === 'board' ? '/sponsors?view=table' : '/sponsors'}
            className="text-sm text-primary hover:underline"
          >
            {view === 'board' ? 'Tablo görünümü' : 'Board görünümü'}
          </Link>
          <CreateSponsorDialog channels={writableChannels} />
        </div>
      </header>

      {sponsors.length === 0 ? (
        <EmptyState
          title="Henüz sponsor yok"
          description="Aday kurumları ekleyip görüşme sürecini bu panoda takip edin."
          action={
            <CreateSponsorDialog channels={writableChannels} triggerLabel="İlk sponsoru ekle" />
          }
        />
      ) : view === 'board' ? (
        <SponsorBoard sponsors={sponsors} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-2xl text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="py-2">Kurum</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Tutar</th>
                <th className="py-2">Kanal</th>
                <th className="py-2">Etkinlik</th>
                <th className="py-2">İletişim</th>
              </tr>
            </thead>
            <tbody>
              {sponsors.map((sponsor) => (
                <tr key={sponsor.id} className="border-b">
                  <td className="py-2">
                    <Link href={`/sponsors/${sponsor.id}`} className="font-medium hover:underline">
                      {sponsor.name}
                    </Link>
                  </td>
                  <td className="py-2">
                    <Badge variant="outline">{describeSponsorStatus(sponsor.status)}</Badge>
                  </td>
                  <td className="py-2">{formatAmount(sponsor.amount, sponsor.currency)}</td>
                  <td className="py-2 text-muted-foreground">{sponsor.channel.name}</td>
                  <td className="py-2 text-muted-foreground">{sponsor.event?.title ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">
                    {sponsor.contactName ?? sponsor.contactEmail ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
