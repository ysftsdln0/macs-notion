'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createRole } from '@/server/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RoleForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#64748b')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      // İzinler burada boş: rol önce açılır, izinleri detay sayfasında
      // işaretlenir. Tek adımda ikisini birden sormak formu şişiriyordu.
      const result = await createRole({ name, color, permissions: [] })
      if (!result.ok) {
        setError(result.error.fields?.name ?? result.error.message)
        return
      }
      setName('')
      router.refresh()
    })
  }

  return (
    <form className="flex flex-wrap items-end gap-3 rounded-lg border p-4" onSubmit={handleSubmit}>
      <div className="space-y-1">
        <Label htmlFor="role-name">Rol adı</Label>
        <Input
          id="role-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Yönetim Kurulu"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="role-color">Renk</Label>
        <Input
          id="role-color"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="h-9 w-16 p-1"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Oluşturuluyor…' : 'Rol oluştur'}
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  )
}
