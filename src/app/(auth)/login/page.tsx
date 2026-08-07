import { signIn } from '@/lib/auth/config'
import { Button } from '@/components/ui/button'

function errorMessage(error: string | undefined): string | null {
  if (!error) return null
  if (error === 'AccessDenied') {
    return 'Hesabın devre dışı bırakılmış. Kulüp yönetimiyle iletişime geç.'
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
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">MACS</h1>
        <p className="text-sm text-muted-foreground">
          Kulüp çalışma alanına girmek için davet linkine ihtiyacın var.
        </p>
        {message && (
          <p className="text-sm text-destructive" role="alert">
            {message}
          </p>
        )}
        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/' })
          }}
        >
          <Button type="submit" className="w-full">
            Google ile devam et
          </Button>
        </form>
      </div>
    </main>
  )
}
