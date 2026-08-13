import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { describeBudgetKind, describeBudgetStatus, formatAmount } from '@/lib/finance-labels'
import type { BudgetEntryView } from '@/server/budget-query'
import { BudgetEntryRowActions } from './entry-row-actions'

export function BudgetEntryTable({
  entries, writableChannelIds, showChannel = true,
}: {
  entries: BudgetEntryView[]
  /** `budget:write` verilen kanallar; satır düzenleme yalnızca bunlarda açılır. */
  writableChannelIds: string[]
  showChannel?: boolean
}) {
  const writable = new Set(writableChannelIds)
  const anyWritable = entries.some((entry) => writable.has(entry.channel.id))

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-3xl text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr className="border-b">
            <th className="py-2">Tarih</th>
            <th className="py-2">Başlık</th>
            <th className="py-2">Kategori</th>
            <th className="py-2">Durum</th>
            <th className="py-2 text-right">Tutar</th>
            {showChannel && <th className="py-2">Kanal</th>}
            <th className="py-2">Etkinlik</th>
            <th className="py-2">Fiş</th>
            {anyWritable && <th className="py-2 text-right">İşlem</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const canWrite = writable.has(entry.channel.id)
            return (
              <tr key={entry.id} className="border-b align-top">
                <td className="py-2 whitespace-nowrap text-muted-foreground">
                  {entry.date.toLocaleDateString('tr-TR')}
                </td>
                <td className="py-2">
                  <span className="font-medium">{entry.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {describeBudgetKind(entry.kind)}
                  </span>
                </td>
                <td className="py-2 text-muted-foreground">{entry.category}</td>
                <td className="py-2">
                  <Badge variant="outline">{describeBudgetStatus(entry.status)}</Badge>
                </td>
                <td
                  className={`py-2 text-right whitespace-nowrap ${
                    entry.kind === 'EXPENSE' ? 'text-destructive' : ''
                  }`}
                >
                  {entry.kind === 'EXPENSE' ? '−' : '+'}
                  {formatAmount(entry.amount, entry.currency)}
                </td>
                {showChannel && (
                  <td className="py-2 text-muted-foreground">{entry.channel.name}</td>
                )}
                <td className="py-2 text-muted-foreground">
                  {entry.event ? (
                    <Link href={`/events/${entry.event.id}`} className="hover:underline">
                      {entry.event.title}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="py-2">
                  {entry.receipt ? (
                    <a
                      href={`/api/files/${entry.receipt.id}`}
                      className="text-primary hover:underline"
                    >
                      {entry.receipt.fileName}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                {anyWritable && (
                  <td className="py-2">
                    {canWrite && (
                      <BudgetEntryRowActions
                        entry={{ id: entry.id, title: entry.title, status: entry.status }}
                      />
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
