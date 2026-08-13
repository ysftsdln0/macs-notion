import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'
import { AppContent } from '@/components/layout/app-content'
import { CommandPalette } from './command-palette'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor()
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } })
  if (!user.onboardedAt) redirect('/onboarding')

  // Mobilde dikey yığın (üst çubuk + içerik), `md` ve üstünde sol sütun +
  // içerik. Sidebar iki yüzeyi de kendi içinde basar (bkz. sidebar-nav.tsx).
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar actor={actor} />
      <AppContent>{children}</AppContent>
      <CommandPalette />
    </div>
  )
}
