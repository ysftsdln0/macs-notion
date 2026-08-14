import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listRoles } from '@/server/roles-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader, SectionHeading } from '@/components/layout/page'
import { RoleBadge } from '@/components/roles/role-badge'
import { RoleForm } from './role-form'

// Bu route'a KASITLI OLARAK loading.tsx eklenmez: aşağıdaki notFound() render
// sırasında çalışır, bir Suspense sınırı 200'ü akıtıp durumu kilitler
// (admin/page.tsx'teki aynı gerekçe — yaşanmış defekt).
export default async function RolesPage() {
  const actor = await requireActor()
  if (!can(actor, 'role:manage', { kind: 'role' })) notFound()

  const roles = await listRoles()

  return (
    <PageContainer className="space-y-8">
      <PageHeader title="Roller" />

      <section className="space-y-3">
        <SectionHeading>Yeni rol</SectionHeading>
        <RoleForm />
      </section>

      <section className="space-y-2">
        <SectionHeading>Tanımlı roller</SectionHeading>
        {roles.length === 0 ? (
          <EmptyState
            title="Rol yok"
            description="Henüz hiç rol tanımlanmadı. Yukarıdaki formdan ilkini oluştur."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2">
                  <RoleBadge role={role} />
                  {role.isSystem && (
                    <span className="text-xs text-muted-foreground">sistem rolü</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{role.memberCount} üye</span>
                  <span>
                    {role.permissions.length === 0
                      ? 'izin yok'
                      : `${role.permissions.length} izin`}
                  </span>
                  <Link className="underline" href={`/admin/roles/${role.id}`}>
                    Düzenle
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
