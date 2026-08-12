/**
 * `Notification.kind` veritabanında makine okunur İngilizce biçimiyle
 * saklanır; arayüzde yalnızca bu etiketler görünür (`activity-labels.ts`
 * ile aynı ayrım).
 */
const notificationKindLabels: Record<string, string> = {
  comment: 'bir yorum yazdı',
  mention: 'senden bahsetti',
  'task.assigned': 'seni bir göreve atadı',
  'event.link': 'etkinliğine bir görev bağladı',
}

export function describeNotificationKind(kind: string): string {
  return notificationKindLabels[kind] ?? 'bir bildirim gönderdi'
}

/** Bildirimin işaret ettiği varlığın sayfası. */
export function notificationHref(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'Document':
      return `/docs/${entityId}`
    case 'Event':
      return `/events/${entityId}`
    case 'Task':
      // Görevlerin ayrı bir detay sayfası yok; pano kartın detayını açar.
      return '/tasks'
    default:
      return '/'
  }
}
