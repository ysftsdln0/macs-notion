'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deactivateMember, reactivateMember, updateMemberRole } from '@/server/members'
import { assignRole, unassignRole } from '@/server/roles'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type GlobalRole = 'SUPERADMIN' | 'ADMIN' | 'MEMBER'

const roleLabels: Record<GlobalRole, string> = {
  SUPERADMIN: 'Sistem sahibi',
  ADMIN: 'Yönetici',
  MEMBER: 'Üye',
}

export function MemberActions({
  userId, name, globalRole, isActive, isSelf,
  canManageMembers, canChangeGlobalRole, canManageRoles, assignableRoles, assignedRoleIds,
}: {
  userId: string
  name: string
  globalRole: GlobalRole
  isActive: boolean
  isSelf: boolean
  canManageMembers: boolean
  canChangeGlobalRole: boolean
  canManageRoles: boolean
  assignableRoles: { id: string; name: string }[]
  assignedRoleIds: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRoleChange(nextRole: GlobalRole) {
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
        setError(result.error.fields?.globalRole ?? result.error.message)
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

  function handleToggleRole(roleId: string, assigned: boolean) {
    setError(null)
    startTransition(async () => {
      const result = assigned
        ? await unassignRole({ userId, roleId })
        : await assignRole({ userId, roleId })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {(canManageMembers || canChangeGlobalRole) && (
        <div className="flex items-center gap-2">
          {/* Kademe seçici yalnızca onu gerçekten kullanabilene gösterilir.
              MEMBER_MANAGE'e bağlıyken hem İK rolü hem Başkan canlı görünen
              bir açılır liste görüyor, her seçim FORBIDDEN dönüyordu —
              modelin bilerek vermediği bir gücü vaat eden bir arayüz. */}
          {canChangeGlobalRole && (
            <Select
              value={globalRole}
              onValueChange={(value) => handleRoleChange(value as GlobalRole)}
              disabled={pending}
            >
              <SelectTrigger size="sm"><SelectValue>{roleLabels[globalRole]}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Üye</SelectItem>
                <SelectItem value="ADMIN">Yönetici</SelectItem>
                <SelectItem value="SUPERADMIN">Sistem sahibi</SelectItem>
              </SelectContent>
            </Select>
          )}
          {!canManageMembers ? null : isActive ? (
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
      )}

      {/* Rol atama tek yerde: bir üyenin hangi rolleri taşıdığı buradan
          değişir. Basılı görünen düğme o rolün atanmış olduğunu gösterir. */}
      {canManageRoles && assignableRoles.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {assignableRoles.map((role) => {
            const assigned = assignedRoleIds.includes(role.id)
            return (
              <Button
                key={role.id}
                type="button"
                size="sm"
                variant={assigned ? 'default' : 'outline'}
                disabled={pending}
                aria-pressed={assigned}
                onClick={() => handleToggleRole(role.id, assigned)}
              >
                {role.name}
              </Button>
            )
          })}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
