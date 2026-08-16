import { signIn } from '@/lib/auth/config'
import { AuthHeading, AuthShell, AuthSubmit } from '@/components/layout/auth-shell'

function errorMessage(error: string | undefined): string | null {
  if (!error) return null
  if (error === 'AccessDenied') {
    return (
      'Giriş reddedildi: ya hesabın devre dışı bırakılmış ya da geçerli bir davet linkin yok. ' +
      'Davet linkin varsa link üzerinden girmelisin; yoksa kulüp yönetimiyle iletişime geç.'
    )
  }
  return 'Giriş yapılamadı. Lütfen tekrar dene.'
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const message = errorMessage(error)

  return (
    <AuthShell>
      <div className="space-y-6 text-center">
        {/* Marka kabuğun kendisinde (cam kartın tepesi); başlıkta MACS'i
            tekrarlamak wordmark'ın hemen altında gereksiz eko yapıyordu. */}
        <AuthHeading title="Hoş geldin">
          Kulüp çalışma alanına girmek için davet linkine ihtiyacın var.
        </AuthHeading>
        {message && (
          <p
            className="animate-pop rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {message}
          </p>
        )}
        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/' })
          }}
        >
          <AuthSubmit>Google ile devam et</AuthSubmit>
        </form>
        <p className="text-xs text-muted-foreground">
          Davet linkin yok mu? Kulüp yönetiminden bir link iste.
        </p>
      </div>
    </AuthShell>
  )
}
