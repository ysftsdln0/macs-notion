import { db } from '@/lib/db'

/**
 * Entegrasyon testleri arasında paylaşılan Postgres örneğini temizler.
 * Silme sırası FK ilişkilerine göre çocuktan ebeveyne doğrudur:
 * Activity/DocState/DocumentShare/Comment/Notification → Document →
 * Attachment/BudgetEntry/Sponsor → Assignee → Task → Event →
 * ChannelMember → Channel → User.
 *
 * Yeni bir tablo eklendiğinde buraya da eklenmeli: eksik kalırsa
 * `channel.deleteMany()` bir FK ihlaline çarpar ve ilgisiz testler kırılır.
 */
export async function resetDb(): Promise<void> {
  await db.activity.deleteMany()
  await db.session.deleteMany()
  await db.invite.deleteMany()
  await db.docState.deleteMany()
  await db.documentShare.deleteMany()
  await db.document.deleteMany()
  await db.comment.deleteMany()
  await db.notification.deleteMany()
  await db.attachment.deleteMany()
  await db.budgetEntry.deleteMany()
  await db.sponsor.deleteMany()
  await db.assignee.deleteMany()
  await db.task.deleteMany()
  await db.event.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
}
