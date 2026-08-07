import { signIn } from '@/lib/auth/config'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">MACS</h1>
        <p className="text-sm text-muted-foreground">
          Kulüp çalışma alanına girmek için davet linkine ihtiyacın var.
        </p>
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
