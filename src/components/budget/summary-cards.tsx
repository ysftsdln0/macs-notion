import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatAmount } from '@/lib/finance-labels'
import type { BudgetSummary } from '@/server/budget-query'

/**
 * Her para birimi kendi kartını alır. Bakiyeyi tek bir sayıda toplamak kur
 * bilgisi gerektirir — kur tutmadığımız için birimler ayrı gösterilir.
 */
export function BudgetSummaryCards({ summary }: { summary: BudgetSummary[] }) {
  if (summary.length === 0) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summary.map((row) => (
        <Card key={row.currency}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{row.currency}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gelir</span>
              <span>{formatAmount(row.income, row.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gider</span>
              <span>{formatAmount(row.expense, row.currency)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-medium">
              <span>Bakiye</span>
              <span className={row.balance.startsWith('-') ? 'text-destructive' : undefined}>
                {formatAmount(row.balance, row.currency)}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
