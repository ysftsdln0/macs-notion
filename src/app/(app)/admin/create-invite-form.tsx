'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createInvite } from '@/server/invites'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type InviteGlobalRole = 'SUPERADMIN' | 'ADMIN' | 'MEMBER'

export function CreateInviteForm({
  channels,
  canGrantSuperadmin,
}: {
  channels: { id: string; name: string }[]
  canGrantSuperadmin: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [globalRole, setGlobalRole] = useState<InviteGlobalRole>('MEMBER')
  const [channelId, setChannelId] = useState<string>('none')
  const [channelRole, setChannelRole] = useState<'LEAD' | 'MEMBER'>('MEMBER')
  const [error, setError] = useState<string | null>(null)
  // Ham davet bağlantısı yalnızca burada, bir kez tutulur — sunucuya
  // geri gönderilmez, loglanmaz, veritabanında yalnızca hash'i durur.
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setGeneratedUrl(null)
    setCopied(false)
    startTransition(async () => {
      const result = await createInvite({
        globalRole,
        channelId: channelId === 'none' ? null : channelId,
        channelRole,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setGeneratedUrl(result.data.url)
      router.refresh()
    })
  }

  async function handleCopy() {
    if (!generatedUrl) return
    await navigator.clipboard.writeText(generatedUrl)
    setCopied(true)
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <Label>Global rol</Label>
          <Select value={globalRole} onValueChange={(v) => setGlobalRole(v as InviteGlobalRole)}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MEMBER">Üye</SelectItem>
              <SelectItem value="ADMIN">Yönetici</SelectItem>
              {/* Seçeneği gizlemek yetkilendirme değil, kolaylıktır — asıl
                  kapı invites.ts'in authorize bloğunda. */}
              {canGrantSuperadmin && <SelectItem value="SUPERADMIN">Sistem sahibi</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Kanal</Label>
          <Select value={channelId} onValueChange={(v) => setChannelId(v ?? 'none')}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Kanalsız</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {channelId !== 'none' && (
          <div className="space-y-1">
            <Label>Kanal rolü</Label>
            <Select value={channelRole} onValueChange={(v) => setChannelRole(v as 'LEAD' | 'MEMBER')}>
              <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Üye</SelectItem>
                <SelectItem value="LEAD">Lider</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Oluşturuluyor…' : 'Davet oluştur'}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {generatedUrl && (
        <div className="space-y-1 rounded-lg bg-muted p-3">
          <p className="text-xs text-muted-foreground">
            Bu bağlantı yalnızca bir kez gösterilir — şimdi kopyala, sayfadan ayrılınca tekrar erişemezsin.
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={generatedUrl} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              {copied ? 'Kopyalandı' : 'Kopyala'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
