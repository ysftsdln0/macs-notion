import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor()
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } })
  if (!user.onboardedAt) redirect('/onboarding')

  return (
    <div className="flex min-h-dvh">
      <div className="hidden md:block"><Sidebar actor={actor} /></div>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
