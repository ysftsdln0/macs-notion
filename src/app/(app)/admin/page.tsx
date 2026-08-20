import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader, SectionHeading } from '@/components/layout/page'
import { CreateInviteForm } from './create-invite-form'
import { ToggleInviteButton } from './toggle-invite-button'

type InviteRow = {
  maxUses: number | null
  expiresAt: Date | null
  disabledAt: Date | null
  redemptions: { redeemedAt: Date | null }[]
}

function usedCount(invite: InviteRow): number {
  return invite.redemptions.filter((r) => r.redeemedAt !== null).length
}

function inviteStatus(invite: InviteRow): string {
  if (invite.disabledAt) return 'duraklatıldı'
  if (invite.expiresAt && invite.expiresAt < new Date()) return 'süresi doldu'
  if (invite.maxUses !== null && usedCount(invite) >= invite.maxUses) return 'kontenjan doldu'
  return 'bekliyor'
}

function canToggle(invite: InviteRow): boolean {
  const status = inviteStatus(invite)
  return status === 'bekliyor' || status === 'duraklatıldı'
}

// Bu route'a KASITLI OLARAK loading.tsx eklenmez: notFound() render sırasında
// çalışır, bir Suspense sınırı 200'ü akıtıp durumu kilitler (final review
// I1/M20 — Task 13'ün skeleton'ı tam olarak bu route'a taşımasıyla ortaya
// çıkan defekt). Aynı kural channels/new/page.tsx'te de geçerli.
export default async function AdminPage() {
  const actor = await requireActor()
  if (!can(actor, 'invite:list', { kind: 'invite' })) notFound()

  const [invites, channels] = await Promise.all([
    db.invite.findMany({
      orderBy: { createdAt: 'desc' }, take: 50,
      include: {
        channel: { select: { name: true } },
        redemptions: { select: { redeemedAt: true } },
      },
    }),
    db.channel.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } }),
  ])

  return (
    <PageContainer className="space-y-8">
      <PageHeader title="Yönetim" />

      {/* Rol yönetimi bir izin değil, SUPERADMIN kapısıdır — bölüm de aynı
          kararı sorar, böylece görünen bağlantı 404'e gitmez. */}
      {can(actor, 'role:manage', { kind: 'role' }) && (
        <section className="space-y-2">
          <SectionHeading>Roller</SectionHeading>
          <p className="text-sm text-muted-foreground">
            Kulüp geneli kademeler ve izinleri.{' '}
            <Link className="underline" href="/admin/roles">
              Rolleri yönet
            </Link>
          </p>
        </section>
      )}

      <section className="space-y-2">
        <SectionHeading>Kanallar</SectionHeading>
        {channels.length === 0 ? (
          <EmptyState title="Kanal yok" description="Henüz hiç kanal oluşturulmadı." />
        ) : (
          <ul className="space-y-1 text-sm">
            {channels.map((c) => (
              <li key={c.id}>
                {c.name} · {c.visibility === 'PRIVATE' ? 'Sadece üyeler' : 'Tüm kulüp'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading>Yeni davet</SectionHeading>
        <CreateInviteForm
          channels={channels.map((c) => ({ id: c.id, name: c.name }))}
          canGrantElevatedRole={actor.globalRole === 'SUPERADMIN'}
        />
      </section>

      <section className="space-y-2">
        <SectionHeading>Davetler</SectionHeading>
        {invites.length === 0 ? (
          <EmptyState title="Davet yok" description="Yukarıdaki formla yeni bir davet oluşturarak başlayabilirsin." />
        ) : (
          <ul className="space-y-1 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2">
                <span>
                  {i.label ? `${i.label} · ` : ''}
                  {i.channel?.name ?? 'Kanalsız'} · {inviteStatus(i)}
                </span>
                {canToggle(i) && (
                  <ToggleInviteButton inviteId={i.id} disabled={i.disabledAt !== null} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
