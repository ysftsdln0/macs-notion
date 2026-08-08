import { db } from '@/lib/db'

/**
 * Entegrasyon testleri arasında paylaşılan Postgres örneğini temizler.
 * Silme sırası FK ilişkilerine göre çocuktan ebeveyne doğrudur:
 * Activity/Session → Invite → ChannelMember → Channel → User.
 */
export async function resetDb(): Promise<void> {
  await db.activity.deleteMany()
  await db.session.deleteMany()
  await db.invite.deleteMany()
  await db.channelMember.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()
}
