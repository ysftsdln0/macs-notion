import type { Permission } from '@/lib/auth/policy'

/**
 * `activity-labels.ts` ile aynı kural: SAKLANAN değer İngilizce ve makine
 * okunur kalır, GÖSTERİLEN değer bu sözlükten geçer.
 *
 * `Record<Permission, …>` olduğu için kataloğa yeni bir izin eklenip buraya
 * karşılığı yazılmazsa `tsc --noEmit` hata verir — arayüze ham enum adı
 * ("CONTENT_READ_ALL") sızması derleme zamanında imkânsız.
 */
export type PermissionGroup = 'content' | 'money' | 'management'

export const permissionGroupOrder: PermissionGroup[] = ['content', 'money', 'management']

export const permissionGroupLabels: Record<PermissionGroup, string> = {
  content: 'İçerik',
  money: 'Para',
  management: 'Yönetim',
}

export const permissionLabels: Record<Permission, { group: PermissionGroup; label: string }> = {
  CONTENT_READ_ALL: {
    group: 'content',
    label: 'Tüm koordinatörlüklerin içeriğini görür',
  },
  CONTENT_WRITE_ALL: {
    group: 'content',
    label: 'Tüm koordinatörlüklerde düzenleme ve silme yapar',
  },
  BUDGET_READ_ALL: {
    group: 'money',
    label: 'Tüm bütçeyi görür',
  },
  BUDGET_WRITE_ALL: {
    group: 'money',
    label: 'Bütçe kalemi ekler ve düzenler',
  },
  MEMBER_MANAGE: {
    group: 'management',
    label: 'Üyeyi pasife alır ve geri açar',
  },
  INVITE_MANAGE: {
    group: 'management',
    label: 'Davet üretir ve iptal eder',
  },
  CHANNEL_CREATE: {
    group: 'management',
    label: 'Yeni koordinatörlük açar',
  },
  CHANNEL_MANAGE_ALL: {
    group: 'management',
    label: 'Her koordinatörlüğün ayarını ve üyelerini yönetir',
  },
  TRASH_MANAGE: {
    group: 'management',
    label: 'Çöp kutusunu görür ve kalıcı siler',
  },
}

/** İzin editöründeki kutucukların sırası; kaydet/yükle turunda sıra kaymasın diye tek kaynak. */
export const permissionOrder: Permission[] = [
  'CONTENT_READ_ALL',
  'CONTENT_WRITE_ALL',
  'BUDGET_READ_ALL',
  'BUDGET_WRITE_ALL',
  'MEMBER_MANAGE',
  'INVITE_MANAGE',
  'CHANNEL_CREATE',
  'CHANNEL_MANAGE_ALL',
  'TRASH_MANAGE',
]
