import type { EventStatus, TaskPriority, TaskStatus } from '@prisma/client'

/**
 * Enum'lar veritabanında İngilizce kalır; arayüzde yalnızca bu etiketler
 * görünür (`activity-labels.ts`'teki ayrımın aynısı).
 */
export const TASK_STATUS_ORDER: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE']

const taskStatusLabels: Record<TaskStatus, string> = {
  BACKLOG: 'Bekleyen',
  TODO: 'Yapılacak',
  IN_PROGRESS: 'Devam eden',
  DONE: 'Bitti',
}

const taskPriorityLabels: Record<TaskPriority, string> = {
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
  URGENT: 'Acil',
}

const eventStatusLabels: Record<EventStatus, string> = {
  PLANNED: 'Planlandı',
  CONFIRMED: 'Kesinleşti',
  DONE: 'Tamamlandı',
  CANCELLED: 'İptal edildi',
}

export const TASK_PRIORITY_ORDER: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
export const EVENT_STATUS_ORDER: EventStatus[] = ['PLANNED', 'CONFIRMED', 'DONE', 'CANCELLED']

export function describeTaskStatus(status: TaskStatus): string {
  return taskStatusLabels[status]
}

export function describeTaskPriority(priority: TaskPriority): string {
  return taskPriorityLabels[priority]
}

export function describeEventStatus(status: EventStatus): string {
  return eventStatusLabels[status]
}
