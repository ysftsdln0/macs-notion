import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { loadRole } from '@/server/roles-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader, SectionHeading } from '@/components/layout/page'
import { PermissionEditor } from './permission-editor'

// Bu route'a KASITLI OLARAK loading.tsx eklenmez — admin/page.tsx'teki
// notFound()/Suspense gerekçesinin aynısı geçerli.
export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const actor = await requireActor()
  if (!can(actor, 'role:manage', { kind: 'role' })) notFound()

  const { id } = await params
  const role = await loadRole(id)
  if (!role) notFound()

  return (
    <PageContainer className="space-y-8">
      <PageHeader title={role.name} />

      <section className="space-y-3">
        <SectionHeading>İzinler</SectionHeading>
        <PermissionEditor
          roleId={role.id}
          name={role.name}
          color={role.color}
          permissions={role.permissions}
          isSystem={role.isSystem}
        />
      </section>

      <section className="space-y-2">
        <SectionHeading>Bu roldeki üyeler</SectionHeading>
        {role.members.length === 0 ? (
          <EmptyState
            title="Üye yok"
            description="Bu rol henüz kimseye verilmedi. Üyeler sayfasından atayabilirsin."
          />
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {role.members.map((roleMember) => (
              <li key={roleMember.id} className="px-3 py-2">
                {roleMember.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
