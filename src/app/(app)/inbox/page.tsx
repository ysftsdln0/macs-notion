import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { listNotifications } from '@/server/notifications-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader } from '@/components/layout/page'
import { describeNotificationKind, notificationHref } from '@/lib/notification-labels'
import { MarkReadButton } from './mark-read-button'

export default async function InboxPage() {
  const actor = await requireActor()
  const notifications = await listNotifications(actor)
  const unread = notifications.filter((n) => n.readAt === null)

  return (
    <PageContainer>
      <PageHeader
        title={`Gelen kutusu${unread.length > 0 ? ` (${unread.length})` : ''}`}
        action={unread.length > 0 ? <MarkReadButton /> : undefined}
      />

      {notifications.length === 0 ? (
        <EmptyState
          title="Bildirim yok"
          description="Sana atanan görevler, adının geçtiği yorumlar ve etkinlik bağlantıları burada görünecek."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              // Okunmamış satır: aksan tonlu sol kenar + hafif zemin. Kenar
              // çizgisi `border-l-2` yerine kutu-içi bir şerit değil, gerçek
              // kenarlık — satır yüksekliğini değiştirmesin diye okunmuşlarda
              // da aynı kalınlıkta ama saydam.
              className={`flex items-center justify-between gap-3 border-l-2 px-3 py-2 ${
                notification.readAt === null
                  ? 'border-l-primary bg-primary/5'
                  : 'border-l-transparent'
              }`}
            >
              <Link
                href={notificationHref(notification.entityType, notification.entityId)}
                className="min-w-0 flex-1 hover:underline"
              >
                <span className="font-medium">{notification.actor.name}</span>{' '}
                {describeNotificationKind(notification.kind)}:{' '}
                <span className="text-muted-foreground">{notification.entityTitle}</span>
              </Link>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <time className="font-mono">
                  {notification.createdAt.toLocaleString('tr-TR')}
                </time>
                {notification.readAt === null && <MarkReadButton ids={[notification.id]} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  )
}
