import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { listNotifications } from '@/server/notifications-query'
import { EmptyState } from '@/components/state/empty-state'
import { describeNotificationKind, notificationHref } from '@/lib/notification-labels'
import { MarkReadButton } from './mark-read-button'

export default async function InboxPage() {
  const actor = await requireActor()
  const notifications = await listNotifications(actor)
  const unread = notifications.filter((n) => n.readAt === null)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          Gelen kutusu{unread.length > 0 && ` (${unread.length})`}
        </h1>
        {unread.length > 0 && <MarkReadButton />}
      </header>

      {notifications.length === 0 ? (
        <EmptyState
          title="Bildirim yok"
          description="Sana atanan görevler, adının geçtiği yorumlar ve etkinlik bağlantıları burada görünecek."
        />
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${
                notification.readAt === null ? 'bg-muted/40' : ''
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
                <time>{notification.createdAt.toLocaleString('tr-TR')}</time>
                {notification.readAt === null && <MarkReadButton ids={[notification.id]} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
