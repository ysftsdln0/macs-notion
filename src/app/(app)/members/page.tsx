import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader } from '@/components/layout/page'
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
    return (
      <PageContainer width="wide">
        <PageHeader title="Üyeler" />
        <EmptyState title="Üye yok" description="Davet gönderildikçe burada görünecekler." />
      </PageContainer>
    )
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
        .join(', ') || '-'
    )
  }

  return (
    <PageContainer width="wide">
      <PageHeader title="Üyeler" />
      {/* Altı sütuna kadar çıkabiliyor; dar ekranda tabloyu kırpmak yerine
          kendi içinde kaydırılır, sayfa gövdesi yatayda kaymaz. */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-2xl text-sm">
          <thead className="text-left text-xs tracking-wide text-muted-foreground uppercase">
            <tr className="border-b">
              <th className="px-3 py-2">Ad</th>
              <th className="px-3 py-2">Ünvan</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Kanallar</th>
              {isAdmin && <th className="px-3 py-2">Durum</th>}
              {isAdmin && <th className="px-3 py-2 text-right">İşlemler</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map((m) => (
              <tr
                key={m.id}
                className={`transition-colors duration-150 hover:bg-muted/60 ${
                  m.isActive ? '' : 'text-muted-foreground'
                }`}
              >
                <td className="px-3 py-2 font-medium">{m.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{m.title ?? '-'}</td>
                <td className="px-3 py-2">{m.globalRole === 'ADMIN' ? 'Yönetici' : 'Üye'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {visibleChannelNames(m.memberships)}
                </td>
                {isAdmin && <td className="px-3 py-2">{m.isActive ? 'Aktif' : 'Pasif'}</td>}
                {isAdmin && (
                  <td className="px-3 py-2 text-right">
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
    </PageContainer>
  )
}
