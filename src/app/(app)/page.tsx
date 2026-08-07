import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { EmptyState } from '@/components/state/empty-state'

export default async function HomePage() {
  await requireActor()
  const activities = await db.activity.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { actor: { select: { name: true } } },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Ana sayfa</h1>
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">Son hareketler</h2>
        {activities.length === 0 ? (
          <EmptyState
            title="Henüz hareket yok"
            description="Kanal açıldıkça ve içerik eklendikçe burada görünecek."
          />
        ) : (
          <ul className="space-y-2 text-sm">
            {activities.map((a) => (
              <li key={a.id} className="flex justify-between rounded border px-3 py-2">
                <span>{a.actor.name} — {a.verb}</span>
                <time className="text-muted-foreground">
                  {a.createdAt.toLocaleDateString('tr-TR')}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
