'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createInvite } from '@/server/invites'
import {
  DEFAULT_INVITE_DURATION,
  ELEVATED_MAX_DURATION_MS,
  INVITE_DURATION_LABELS,
  INVITE_DURATIONS,
  INVITE_USE_LIMIT_LABELS,
  INVITE_USE_LIMITS,
  type InviteDuration,
} from '@/lib/auth/invite-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type InviteGlobalRole = 'SUPERADMIN' | 'ADMIN' | 'MEMBER'

export function CreateInviteForm({
  channels,
  canGrantElevatedRole,
}: {
  channels: { id: string; name: string }[]
  canGrantElevatedRole: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [globalRole, setGlobalRole] = useState<InviteGlobalRole>('MEMBER')
  const [channelId, setChannelId] = useState<string>('none')
  const [channelRole, setChannelRole] = useState<'LEAD' | 'MEMBER'>('MEMBER')
  const [duration, setDuration] = useState<InviteDuration>(DEFAULT_INVITE_DURATION)
  const [maxUses, setMaxUses] = useState<number | null>(1)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Ham davet bağlantısı yalnızca burada, bir kez tutulur — sunucuya
  // geri gönderilmez, loglanmaz, veritabanında yalnızca hash'i durur.
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const elevated = globalRole !== 'MEMBER'

  // Kademe seçildiğinde tek geçerli kombinasyona düşülür. Bu bir yetki
  // kapısı DEĞİL, kolaylıktır — asıl kural invites.ts'in superRefine'ında.
  function handleGlobalRoleChange(value: InviteGlobalRole) {
    setGlobalRole(value)
    if (value !== 'MEMBER') {
      setMaxUses(1)
      setDuration('DAY')
    }
  }

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
        duration,
        maxUses,
        label,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setGeneratedUrl(result.data.url)
      setLabel('')
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
          <Select value={globalRole} onValueChange={(v) => handleGlobalRoleChange(v as InviteGlobalRole)}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MEMBER">Üye</SelectItem>
              {/* Kademe dağıtan seçenekler yalnızca SUPERADMIN'e gösterilir.
                  Gizlemek yetkilendirme değil, kolaylıktır — asıl kapı
                  invites.ts'in authorize bloğunda. */}
              {canGrantElevatedRole && <SelectItem value="ADMIN">Yönetici</SelectItem>}
              {canGrantElevatedRole && <SelectItem value="SUPERADMIN">Sistem sahibi</SelectItem>}
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
        <div className="space-y-1">
          <Label>Geçerlilik</Label>
          <Select
            value={duration}
            onValueChange={(v) => setDuration(v as InviteDuration)}
            disabled={elevated}
          >
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(INVITE_DURATION_LABELS)
                .filter(([value]) => {
                  if (!elevated) return true
                  const ms = INVITE_DURATIONS[value as InviteDuration]
                  return ms !== null && ms <= ELEVATED_MAX_DURATION_MS
                })
                .map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Kullanım limiti</Label>
          <Select
            value={maxUses === null ? 'unlimited' : String(maxUses)}
            onValueChange={(v) => setMaxUses(v === 'unlimited' ? null : Number(v))}
            disabled={elevated}
          >
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INVITE_USE_LIMITS.map((limit) => (
                <SelectItem key={limit ?? 'unlimited'} value={limit === null ? 'unlimited' : String(limit)}>
                  {INVITE_USE_LIMIT_LABELS.get(limit)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-label">Etiket</Label>
          <Input
            id="invite-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            placeholder="Bahar standı"
            className="h-8 w-48 text-sm"
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Oluşturuluyor…' : 'Davet oluştur'}
        </Button>
      </form>
      {elevated && (
        <p className="text-xs text-muted-foreground">
          Kademe daveti tek kişilik ve en fazla 24 saat geçerli olabilir.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {generatedUrl && (
        <div className="space-y-1 rounded-lg bg-muted p-3">
          <p className="text-xs text-muted-foreground">
            {maxUses === 1
              ? 'Bu bağlantı yalnızca bir kez gösterilir — şimdi kopyala, sayfadan ayrılınca tekrar erişemezsin.'
              : 'Bu bağlantı yalnızca bir kez gösterilir ve tekrar üretilemez. Birden çok kişiye dağıtacaksan ŞİMDİ güvenli bir yere kaydet — kaybedersen yeni bir davet oluşturman gerekir.'}
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
