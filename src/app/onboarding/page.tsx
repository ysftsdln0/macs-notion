import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { INVITE_COOKIE } from '@/lib/auth/invite-cookie'
import { ProfileForm } from './profile-form'

export default async function OnboardingPage() {
  const actor = await requireActor()

  // Davet, giriş anında Auth.js tarafında sahiplenilip uygulandı (Task 9).
  // Burada yalnızca çerez temizlenir.
  const store = await cookies()
  store.delete(INVITE_COOKIE)

  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } })
  if (user.onboardedAt) redirect('/')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Profilini tamamla</h1>
        <p className="text-sm text-muted-foreground">Kulüpte nasıl görüneceğini belirle.</p>
      </div>
      <ProfileForm defaultName={user.name} />
    </main>
  )
}
