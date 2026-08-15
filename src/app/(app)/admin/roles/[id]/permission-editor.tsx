'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Permission } from '@/lib/auth/policy'
import { deleteRole, updateRole } from '@/server/roles'
import {
  permissionGroupLabels,
  permissionGroupOrder,
  permissionLabels,
  permissionOrder,
} from '@/lib/permission-labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function PermissionEditor({
  roleId,
  name: initialName,
  color: initialColor,
  permissions: initialPermissions,
  isSystem,
}: {
  roleId: string
  name: string
  color: string | null
  permissions: Permission[]
  isSystem: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor ?? '#64748b')
  const [selected, setSelected] = useState<Set<Permission>>(new Set(initialPermissions))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function toggle(permission: Permission) {
    setSaved(false)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(permission)) next.delete(permission)
      else next.add(permission)
      return next
    })
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateRole({
        roleId,
        name,
        color,
        // permissionOrder üzerinden geçmek listeyi her zaman aynı sırada
        // gönderir; kaydet/yükle turunda sıra kayması olmaz.
        permissions: permissionOrder.filter((permission) => selected.has(permission)),
      })
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  function handleDelete() {
    if (!window.confirm(`${initialName} rolü silinsin mi? Bu roldeki herkes izinlerini kaybeder.`)) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await deleteRole({ roleId })
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message)
        return
      }
      router.push('/admin/roles')
    })
  }

  return (
    <div className="space-y-5 rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="role-name">Rol adı</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
            }}
            disabled={isSystem}
          />
          {isSystem && (
            <p className="text-xs text-muted-foreground">
              Sistem rolünün adı değiştirilemez; izinleri değiştirilebilir.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="role-color">Renk</Label>
          <Input
            id="role-color"
            type="color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value)
              setSaved(false)
            }}
            className="h-9 w-16 p-1"
          />
        </div>
      </div>

      {permissionGroupOrder.map((group) => (
        <fieldset key={group} className="space-y-2">
          <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {permissionGroupLabels[group]}
          </legend>
          {permissionOrder
            .filter((permission) => permissionLabels[permission].group === group)
            .map((permission) => (
              <label key={permission} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selected.has(permission)}
                  onChange={() => toggle(permission)}
                  disabled={pending}
                />
                {permissionLabels[permission].label}
              </label>
            ))}
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={handleSave} disabled={pending}>
          {pending ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
        {!isSystem && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
          >
            Rolü sil
          </Button>
        )}
        {saved && <span className="text-sm text-muted-foreground">Kaydedildi.</span>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
