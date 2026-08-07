import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { signIn } from '@/lib/auth/config'
import { getActor } from '@/lib/auth/session'
import { consumeInvite } from '@/server/invites'
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from '@/lib/auth/invite-cookie'
import { Button } from '@/components/ui/button'

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ hata?: string }>
}) {
  const { token } = await params
  const failed = (await searchParams).hata === '1'
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { channel: true },
  })

  const invalid = !invite || invite.usedAt || invite.revokedAt || invite.expiresAt < new Date()
  if (invalid) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm space-y-2 text-center">
          <h1 className="text-xl font-semibold">Davet geçersiz</h1>
          <p className="text-sm text-muted-foreground">
            Bu davet kullanılmış, iptal edilmiş veya süresi dolmuş. Kulüp yönetiminden yeni bir link iste.
          </p>
        </div>
      </main>
    )
  }

  // Zaten giriş yapmışsa: onay iste. Render sırasında tüketmek yanlış olur —
  // tarayıcı ön yüklemesi (prefetch) daveti tıklamadan yakabilir ve üçüncü
  // bir taraf, oturumu açık kurbanı istemediği bir daveti kullanmaya
  // zorlayabilir (oturum çerezi sameSite=lax olduğu için üst düzey
  // gezinmede gönderilir).
  const actor = await getActor()
  if (actor) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-2xl font-semibold">Davetiye</h1>
          {invite.channel && (
            <p className="text-sm text-muted-foreground">
              <strong>{invite.channel.name}</strong> kanalına ekleneceksin.
            </p>
          )}
          <form
            action={async () => {
              'use server'
              const result = await consumeInvite(token, actor.id)
              if (!result.ok) redirect(`/invite/${token}?hata=1`)
              redirect('/')
            }}
          >
            <Button type="submit" className="w-full">Daveti kabul et</Button>
          </form>
          {failed && (
            <p className="text-sm text-destructive">
              Davet kullanılamadı. Kullanılmış, iptal edilmiş veya süresi dolmuş olabilir.
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">MACS&apos;e davet edildin</h1>
        {invite.channel && (
          <p className="text-sm text-muted-foreground">
            Kanal: <strong>{invite.channel.name}</strong>
          </p>
        )}
        <form
          action={async () => {
            'use server'
            // Token'ı httpOnly çerezde taşı: Google dönüşünde hangi davet
            // olduğunu bilmemiz gerekiyor, URL'de taşımak referrer sızıntısı riski.
            const store = await cookies()
            store.set(INVITE_COOKIE, token, {
              httpOnly: true, secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax', maxAge: INVITE_COOKIE_MAX_AGE, path: '/',
            })
            await signIn('google', { redirectTo: '/onboarding' })
          }}
        >
          <Button type="submit" className="w-full">Google ile devam et</Button>
        </form>
      </div>
    </main>
  )
}
