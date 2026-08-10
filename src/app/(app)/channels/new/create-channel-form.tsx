'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createChannel } from '@/server/channels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export function CreateChannelForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'OPEN' | 'PRIVATE'>('OPEN')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createChannel({ name, visibility, description })
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message)
        return
      }
      router.push(`/c/${result.data.slug}`)
    })
  }

  return (
    <form className="space-y-4 rounded-lg border p-4" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <Label htmlFor="channel-name">Kanal adı</Label>
        <Input
          id="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={60}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="channel-visibility">Görünürlük</Label>
        <Select value={visibility} onValueChange={(v) => setVisibility(v as 'OPEN' | 'PRIVATE')}>
          <SelectTrigger id="channel-visibility" size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN">Tüm kulüp</SelectItem>
            <SelectItem value="PRIVATE">Sadece üyeler</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="channel-description">Açıklama (opsiyonel)</Label>
        <Input
          id="channel-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Oluşturuluyor…' : 'Oluştur'}
      </Button>
    </form>
  )
}
