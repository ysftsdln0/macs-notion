'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addChannelMember, removeChannelMember } from '@/server/channels'
import { Button } from '@/components/ui/button'

export function ChannelMemberRowActions({
  channelId, userId, name, channelRole,
}: { channelId: string; userId: string; name: string; channelRole: 'LEAD' | 'MEMBER' }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRoleChange(nextRole: 'LEAD' | 'MEMBER') {
    if (nextRole === channelRole) return
    setError(null)
    startTransition(async () => {
      // addChannelMember mevcut bir üyelikte upsert yapar: yeni ekleme ile
      // rol değişikliği aynı action'ı paylaşır (bkz. src/server/channels.ts).
      const result = await addChannelMember({ channelId, userId, channelRole: nextRole })
      if (!result.ok) {
        setError(result.error.fields?.channelRole ?? result.error.message)
        return
      }
      router.refresh()
    })
  }

  function handleRemove() {
    // Yanlış satırda tıklanınca kimin çıkarıldığı belirsiz kalmasın diye isim
    // burada geçer (bkz. üyeler sayfasındaki pasifleştirme onayıyla aynı gerekçe).
    if (!window.confirm(`${name} adlı üyeyi bu kanaldan çıkarmak istediğine emin misin?`)) return
    setError(null)
    startTransition(async () => {
      const result = await removeChannelMember({ channelId, userId })
      if (!result.ok) {
        setError(result.error.fields?.channelRole ?? result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <span className="flex items-center gap-2">
      <select
        aria-label={`${name} kanal rolü`}
        className="h-7 rounded-lg border border-input bg-transparent px-1.5 text-xs"
        value={channelRole}
        onChange={(e) => handleRoleChange(e.target.value as 'LEAD' | 'MEMBER')}
        disabled={pending}
      >
        <option value="MEMBER">Üye</option>
        <option value="LEAD">Lider</option>
      </select>
      <Button type="button" variant="outline" size="xs" disabled={pending} onClick={handleRemove}>
        Çıkar
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
