import type { DocumentVisibility } from '@/lib/auth/policy'

/**
 * Kod içinde enum İngilizce kalır (`PUBLIC` | `CHANNEL` | `PRIVATE`);
 * arayüzde yalnızca bu etiketler görünür. `activity-labels.ts`'teki
 * ayrımın aynısı: SAKLANAN değer değişmez, GÖSTERİLEN değer buradan geçer.
 */
const documentVisibilityLabels: Record<DocumentVisibility, string> = {
  PUBLIC: 'Tüm kulüp',
  CHANNEL: 'Kanal üyeleri',
  PRIVATE: 'Sadece ben',
}

export function describeDocumentVisibility(visibility: DocumentVisibility): string {
  return documentVisibilityLabels[visibility]
}

export const DOCUMENT_VISIBILITY_OPTIONS: { value: DocumentVisibility; label: string }[] = [
  { value: 'PUBLIC', label: documentVisibilityLabels.PUBLIC },
  { value: 'CHANNEL', label: documentVisibilityLabels.CHANNEL },
  { value: 'PRIVATE', label: documentVisibilityLabels.PRIVATE },
]

export const SHARE_PERMISSION_LABELS: Record<'VIEW' | 'EDIT', string> = {
  VIEW: 'Görüntüleyebilir',
  EDIT: 'Düzenleyebilir',
}
