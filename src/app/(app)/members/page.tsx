import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { EmptyState } from '@/components/state/empty-state'
import { MemberActions } from './member-actions'

// Bu route'a KASITLI OLARAK loading.tsx eklenmez: aşağıdaki notFound() bugün
// member:list herkese açık olduğu için erişilemez olsa da, kod yolu var
// olduğu sürece bir Suspense sınırı 200'ü akıtıp durumu kilitleyebilir
// (final review I1/M20 — admin/loading.tsx'in düştüğü aynı tuzak).
export default async function MembersPage() {
  const actor = await requireActor()
  // Yetki kontrolü veriyi göstermeden önce (bkz. c/[slug]/page.tsx ile aynı desen).
  if (!can(actor, 'member:list', { kind: 'member', id: actor.id })) notFound()

  const isAdmin = actor.globalRole === 'ADMIN'

  const members = await db.user.findMany({
    // Pasif üyeler daha önce bu sorgudan tamamen dışlanıyordu — bu, uygulama
    // içinde onları görecek ve geri etkinleştirecek tek kişi olan admin için
    // de geçerliydi, yani deaktivasyon geri dönüşü olmayan bir işlemdi (tek
    // kurtarma yolu VPS'te elle psql çalıştırmaktı). Admin artık pasif
    // üyeleri de görür ve etkinleştirebilir; düz üye hâlâ yalnızca aktif
    // üyeleri görür (pasif hesapların varlığı iş arkadaşlarına sızmaz).
    where: isAdmin ? {} : { isActive: true },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    // Açık select: email ve diğer kişisel alanlar hiç çekilmez, sayfada
    // gösterilmeyen veri sorgu sonucunda da yer almaz.
    select: {
      id: true,
      name: true,
      title: true,
      globalRole: true,
      isActive: true,
      memberships: {
        select: { channel: { select: { id: true, name: true, visibility: true } } },
      },
    },
  })

  if (members.length === 0) {
    return <EmptyState title="Üye yok" description="Davet gönderildikçe burada görünecekler." />
  }

  const viewerChannelIds = new Set(actor.memberships.map((m) => m.channelId))

  // Kanal görünürlüğü channel:read ile aynı kural izler: OPEN kanal
  // herkese, PRIVATE kanal yalnızca üyesine ve admin'e görünür. Bu filtre
  // olmadan, "Kanallar" sütunu herhangi bir aktif üyeye üyesi olmadığı
  // PRIVATE kanalların adını ve kimlerin orada olduğunu sızdırırdı.
  // Sunucu tarafında filtrelenir — render edilip sonra istemcide gizlenmez.
  function visibleChannelNames(memberships: (typeof members)[number]['memberships']): string {
    return (
      memberships
        .filter(({ channel }) => channel.visibility === 'OPEN' || isAdmin || viewerChannelIds.has(channel.id))
        .map(({ channel }) => channel.name)
        .join(', ') || '—'
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Üyeler</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2">Ad</th>
            <th>Ünvan</th>
            <th>Rol</th>
            <th>Kanallar</th>
            {isAdmin && <th>Durum</th>}
            {isAdmin && <th className="text-right">İşlemler</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className={`border-t ${m.isActive ? '' : 'text-muted-foreground'}`}>
              <td className="py-2">{m.name}</td>
              <td>{m.title ?? '—'}</td>
              <td>{m.globalRole === 'ADMIN' ? 'Yönetici' : 'Üye'}</td>
              <td>{visibleChannelNames(m.memberships)}</td>
              {isAdmin && <td>{m.isActive ? 'Aktif' : 'Pasif'}</td>}
              {isAdmin && (
                <td className="py-2 text-right">
                  <MemberActions
                    userId={m.id}
                    name={m.name}
                    globalRole={m.globalRole}
                    isActive={m.isActive}
                    isSelf={m.id === actor.id}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
