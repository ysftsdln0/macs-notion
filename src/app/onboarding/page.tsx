import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireActor } from '@/lib/auth/session'
import { ProfileForm } from './profile-form'

export default async function OnboardingPage() {
  const actor = await requireActor()

  // Davet, giriş anında Auth.js tarafında rezerve edilip uygulandı (Task 9).
  // `macs_invite` çerezinin temizlenmesi BURADA yapılamaz: bu bir Server
  // Component render'ı, `cookies()` mutasyonu yalnızca Server Action/Route
  // Handler fazında yasal — render sırasında çağrılırsa Next 16 istisna
  // fırlatır (ReadonlyRequestCookiesError). Temizleme, profili tamamlayan
  // Server Action'a taşındı (`completeOnboarding`, bkz. `src/server/profile.ts`)
  // — çerezin gerçekten işini bitirdiği an orasıdır. Kullanıcı onboarding'i
  // yarıda bırakıp geri gelmezse çerez kendiliğinden `INVITE_COOKIE_MAX_AGE`
  // (15 dk) sonunda düşer; davet o ana kadar zaten kalıcı olarak tüketilmiş
  // durumdadır (`applyInvite`), yani çerezin ortada kalması yeniden
  // kullanılabilir bir davet anlamına gelmez — sadece atıl bir değerdir.
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
