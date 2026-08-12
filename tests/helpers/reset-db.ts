import { db } from '@/lib/db'

/**
 * Entegrasyon testleri arasında paylaşılan Postgres örneğini temizler.
 * Silme sırası FK ilişkilerine göre çocuktan ebeveyne doğrudur:
 * Activity/DocState/DocumentShare/Comment/Notification → Document →
 * ChannelMember → Channel → User.
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
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
}
