import { can, has, type Actor } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { countUnreadNotifications } from '@/server/notifications-query'
import { budgetChannelIds } from '@/server/budget-query'
import { SidebarNav } from './sidebar-nav'

export async function Sidebar({ actor }: { actor: Actor }) {
  const [channels, unreadCount] = await Promise.all([
    listVisibleChannels(),
    countUnreadNotifications(actor),
  ])
  const mine = new Set(actor.memberships.map((m) => m.channelId))
  // channel:create policy'siyle birebir aynı karar: admin VEYA herhangi bir
  // kanalda LEAD olan herkes. Bu link salt görünürlük kolaylığıdır — asıl
  // yetki kontrolü /channels/new sayfasında ve createChannel action'ında
  // tekrar (ve gerçek şekilde) yapılır.
  const canCreateChannel = can(actor, 'channel:create', { kind: 'channel:new' })
  // Bütçe içerikten kapalı: admin ya da bir kanalda LEAD olmayan link'i
  // hiç görmez (budgetChannelIds, budget:read policy'sinin sorgu karşılığı).
  const budgetScope = budgetChannelIds(actor)
  const canSeeBudget = budgetScope === 'all' || budgetScope.length > 0

  return (
    <SidebarNav
      // Kanal satırı yalnızca bu dört alanı okur; tam Prisma satırını
      // göndermek `description`/`createdAt` dahil her alanı client payload'ına
      // serileştirirdi.
      channels={channels.map(({ id, slug, name, icon }) => ({ id, slug, name, icon }))}
      mine={mine}
      unreadCount={unreadCount}
      canCreateChannel={canCreateChannel}
      canSeeBudget={canSeeBudget}
      canSeeAdminPanel={has(actor, 'INVITE_MANAGE')}
      canSeeTrash={has(actor, 'TRASH_MANAGE')}
    />
  )
}
