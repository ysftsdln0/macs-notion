'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addChannelMember } from '@/server/channels'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export function AddChannelMemberForm({
  channelId, candidates,
}: { channelId: string; candidates: { id: string; name: string }[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [userId, setUserId] = useState(candidates[0]?.id ?? '')
  const [channelRole, setChannelRole] = useState<'LEAD' | 'MEMBER'>('MEMBER')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!userId) return
    setError(null)
    startTransition(async () => {
      const result = await addChannelMember({ channelId, userId, channelRole })
      if (!result.ok) {
        setError(result.error.fields?.channelRole ?? result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <Label htmlFor="add-member-user">Eklenecek üye</Label>
        <select
          id="add-member-user"
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="add-member-role">Kanal rolü</Label>
        <select
          id="add-member-role"
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={channelRole}
          onChange={(e) => setChannelRole(e.target.value as 'LEAD' | 'MEMBER')}
        >
          <option value="MEMBER">Üye</option>
          <option value="LEAD">Lider</option>
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Ekleniyor…' : 'Üye ekle'}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  )
}
