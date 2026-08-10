import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { CreateChannelForm } from './create-channel-form'

// Bu route'a KASITLI OLARAK loading.tsx eklenmez: notFound() render
// sırasında çalışır, bir Suspense sınırı 200'ü akıtıp durumu kilitler
// (final review I1/M20 — admin/loading.tsx'in düştüğü aynı tuzak).
export default async function NewChannelPage() {
  const actor = await requireActor()
  // Yetki kontrolü veriyi göstermeden önce (bkz. c/[slug]/page.tsx ile aynı desen).
  if (!can(actor, 'channel:create', { kind: 'channel:new' })) notFound()

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Yeni kanal</h1>
      <CreateChannelForm />
    </div>
  )
}
