import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AlertTriangle, Gift, UserPlus } from 'lucide-react'
import { db } from '@/lib/db'
import { hashInviteToken } from '@/lib/auth/invite-token'
import { signIn } from '@/lib/auth/config'
import { getActor } from '@/lib/auth/session'
import { consumeInvite } from '@/server/invite-service'
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from '@/lib/auth/invite-cookie'
import { AuthHeading, AuthShell, AuthSubmit } from '@/components/layout/auth-shell'

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
    include: {
      channel: true,
      redemptions: { where: { redeemedAt: { not: null } }, select: { id: true } },
    },
  })

  const invalid =
    !invite ||
    invite.disabledAt !== null ||
    (invite.expiresAt !== null && invite.expiresAt < new Date()) ||
    (invite.maxUses !== null && invite.redemptions.length >= invite.maxUses)
  if (invalid) {
    // `hata=1`, onaylı kullanım denemesi (aşağıdaki imzalı kullanıcı formu)
    // başarısız olup buraya geri yönlendirdiğinde düşer — davet bu ana kadar
    // zaten geçersiz hale gelmiştir (başka biri kapmıştır), o yüzden bu mesaj
    // bu dal içinde gösterilir; ayrı bir dal hiç render edilmez.
    return (
      <AuthShell>
        <div className="space-y-6 text-center">
          <AuthHeading icon={AlertTriangle} tone="destructive" title="Davet geçersiz">
            {failed
              ? 'Davet kullanılamadı. Kullanılmış, iptal edilmiş veya süresi dolmuş olabilir.'
              : 'Bu davet kullanılmış, iptal edilmiş veya süresi dolmuş. Kulüp yönetiminden yeni bir link iste.'}
          </AuthHeading>
        </div>
      </AuthShell>
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
      <AuthShell>
        <div className="space-y-6 text-center">
          <AuthHeading icon={UserPlus} title="Davetiye">
            {invite.channel && (
              <>
                <strong className="font-medium text-foreground">{invite.channel.name}</strong>{' '}
                kanalına ekleneceksin.
              </>
            )}
          </AuthHeading>
          <form
            action={async () => {
              'use server'
              const result = await consumeInvite(token, actor.id)
              if (!result.ok) redirect(`/invite/${token}?hata=1`)
              redirect('/')
            }}
          >
            <AuthSubmit>Daveti kabul et</AuthSubmit>
          </form>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div className="space-y-6 text-center">
        <AuthHeading icon={Gift} title={'MACS’e davet edildin'}>
          {invite.channel && (
            <>
              Kanal:{' '}
              <strong className="font-medium text-foreground">{invite.channel.name}</strong>
            </>
          )}
        </AuthHeading>
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
          <AuthSubmit>Google ile devam et</AuthSubmit>
        </form>
        <p className="text-xs text-muted-foreground">
          Zaten bir MACS hesabın varsa önce giriş yap, sonra bu bağlantıyı tekrar aç.
        </p>
      </div>
    </AuthShell>
  )
}
