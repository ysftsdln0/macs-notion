'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { revokeInvite } from '@/server/invites'
import { Button } from '@/components/ui/button'

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRevoke() {
    setError(null)
    startTransition(async () => {
      const result = await revokeInvite({ inviteId })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="xs" disabled={pending} onClick={handleRevoke}>
        İptal et
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
