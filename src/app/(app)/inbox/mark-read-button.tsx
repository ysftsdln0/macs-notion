'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { markNotificationsRead } from '@/server/notifications'
import { Button } from '@/components/ui/button'

export function MarkReadButton({ ids }: { ids?: string[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const result = await markNotificationsRead(ids ? { ids } : {})
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <Button size="sm" variant={ids ? 'ghost' : 'outline'} disabled={pending} onClick={handleClick}>
      {ids ? 'Okundu' : 'Tümünü okundu işaretle'}
    </Button>
  )
}
