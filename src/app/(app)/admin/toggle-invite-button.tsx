'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setInviteDisabled } from '@/server/invites'
import { Button } from '@/components/ui/button'

export function ToggleInviteButton({
  inviteId,
  disabled,
}: {
  inviteId: string
  disabled: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle() {
    setError(null)
    startTransition(async () => {
      const result = await setInviteDisabled({ inviteId, disabled: !disabled })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="xs" disabled={pending} onClick={handleToggle}>
        {disabled ? 'Devam ettir' : 'Duraklat'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
