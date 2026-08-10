'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deactivateMember, reactivateMember, updateMemberRole } from '@/server/members'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const roleLabels: Record<'ADMIN' | 'MEMBER', string> = {
  ADMIN: 'Yönetici',
  MEMBER: 'Üye',
}

export function MemberActions({
  userId, name, globalRole, isActive, isSelf,
}: {
  userId: string
  name: string
  globalRole: 'ADMIN' | 'MEMBER'
  isActive: boolean
  isSelf: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRoleChange(nextRole: 'ADMIN' | 'MEMBER') {
    if (nextRole === globalRole) return
    setError(null)
    startTransition(async () => {
      const result = await updateMemberRole({ userId, globalRole: nextRole })
      if (!result.ok) {
        setError(result.error.fields?.globalRole ?? result.error.message)
        return
      }
      router.refresh()
    })
  }

  function handleDeactivate() {
    // Yanlış satırda tıklanınca kimin pasife alındığı belirsiz kalmasın diye
    // isim burada geçer — bir satır kayması artık kurbanını göstermeden geri
    // dönüşü olmayan bir işlemi tetiklemiyor.
    if (!window.confirm(`${name} adlı üyeyi pasife almak istediğine emin misin? Tüm oturumları hemen sonlanır.`)) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await deactivateMember({ userId })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }

  function handleReactivate() {
    if (!window.confirm(`${name} adlı üyeyi yeniden etkinleştirmek istediğine emin misin?`)) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await reactivateMember({ userId })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Select
          value={globalRole}
          onValueChange={(value) => handleRoleChange(value as 'ADMIN' | 'MEMBER')}
          disabled={pending}
        >
          <SelectTrigger size="sm"><SelectValue>{roleLabels[globalRole]}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="MEMBER">Üye</SelectItem>
            <SelectItem value="ADMIN">Yönetici</SelectItem>
          </SelectContent>
        </Select>
        {isActive ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending || isSelf}
            onClick={handleDeactivate}
          >
            Pasifleştir
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={handleReactivate}
          >
            Etkinleştir
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
