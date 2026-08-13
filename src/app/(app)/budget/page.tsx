import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import {
  budgetChannelIds, listBudgetCategories, listBudgetEntries, summarizeBudget,
} from '@/server/budget-query'
import { listEvents } from '@/server/events-query'
import { listSponsors } from '@/server/sponsors-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader } from '@/components/layout/page'
import { BudgetSummaryCards } from '@/components/budget/summary-cards'
import { BudgetEntryTable } from '@/components/budget/entry-table'
import { BudgetEntryDialog } from './entry-dialog'

type SearchParams = Promise<{ channelId?: string; eventId?: string; category?: string }>

export default async function BudgetPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor()
  const params = await searchParams

  const channels = await listVisibleChannels()
  const budgetResource = (c: (typeof channels)[number]) => ({
    kind: 'budget' as const,
    channelId: c.id,
    channelVisibility: c.visibility,
    channelArchivedAt: c.archivedAt,
  })
  const readableChannels = channels.filter((c) => can(actor, 'budget:read', budgetResource(c)))
  const writableChannels = channels.filter((c) => can(actor, 'budget:write', budgetResource(c)))
  const writableChannelIds = writableChannels.map((c) => c.id)

  // Görülemeyen bir kanalın id'si filtreye yazılırsa sessizce yok sayılır:
  // sorguya geçirmek o kanalın varlığını doğrulardı.
  const readableIds = new Set(readableChannels.map((c) => c.id))
  const channelFilter =
    params.channelId && readableIds.has(params.channelId) ? params.channelId : undefined

  const [entries, summary, categories, events, sponsors] = await Promise.all([
    listBudgetEntries(actor, {
      ...(channelFilter ? { channelId: channelFilter } : {}),
      ...(params.eventId ? { eventId: params.eventId } : {}),
      ...(params.category ? { category: params.category } : {}),
    }),
    summarizeBudget(actor, {
      ...(channelFilter ? { channelId: channelFilter } : {}),
      ...(params.eventId ? { eventId: params.eventId } : {}),
    }),
    listBudgetCategories(actor),
    listEvents(actor),
    listSponsors(actor),
  ])

  const scope = budgetChannelIds(actor)
  if (scope !== 'all' && scope.length === 0) {
    return (
      <PageContainer width="wide">
        <PageHeader title="Bütçe" />
        <EmptyState
          title="Bütçe erişimin yok"
          description="Bütçe kayıtlarını yalnızca yönetim ve kanal liderleri görebilir."
        />
      </PageContainer>
    )
  }

  const eventOptions = events
    .filter((e) => readableIds.has(e.channel.id))
    .map((e) => ({ id: e.id, title: e.title, channelId: e.channel.id }))
  const sponsorOptions = sponsors.map((s) => ({
    id: s.id, title: s.name, channelId: s.channel.id,
  }))
  const dialog = (
    <BudgetEntryDialog
      channels={writableChannels.map((c) => ({ id: c.id, name: c.name }))}
      events={eventOptions}
      sponsors={sponsorOptions}
      {...(channelFilter ? { defaultChannelId: channelFilter } : {})}
    />
  )

  return (
    <PageContainer width="wide">
      <PageHeader title="Bütçe" action={dialog} />

      <BudgetSummaryCards summary={summary} />

      <form className="flex flex-wrap items-end gap-2" method="get">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="budget-filter-channel">
            Kanal
          </label>
          <select
            id="budget-filter-channel"
            name="channelId"
            defaultValue={channelFilter ?? ''}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            {readableChannels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="budget-filter-event">
            Etkinlik
          </label>
          <select
            id="budget-filter-event"
            name="eventId"
            defaultValue={params.eventId ?? ''}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            {eventOptions.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="budget-filter-category">
            Kategori
          </label>
          <select
            id="budget-filter-category"
            name="category"
            defaultValue={params.category ?? ''}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-8 rounded-lg border px-3 text-sm hover:bg-muted">
          Filtrele
        </button>
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title="Bütçe kalemi yok"
          description="Bu filtrelerle görünen bir gelir ya da gider kaydı bulunmuyor."
          action={writableChannels.length > 0 ? dialog : undefined}
        />
      ) : (
        <BudgetEntryTable entries={entries} writableChannelIds={writableChannelIds} />
      )}
    </PageContainer>
  )
}
