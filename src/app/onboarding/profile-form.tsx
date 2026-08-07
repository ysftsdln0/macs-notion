'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { completeOnboarding } from '@/server/profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(async () => {
          const result = await completeOnboarding({
            name: String(data.get('name') ?? ''),
            title: String(data.get('title') ?? ''),
          })
          if (result.ok) {
            router.replace('/')
            return
          }
          setFieldErrors(result.error.fields ?? {})
          setFormError(result.error.fields ? null : result.error.message)
        })
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="name">Ad soyad</Label>
        <Input id="name" name="name" defaultValue={defaultName} required />
        {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Ünvan</Label>
        <Input id="title" name="title" placeholder="Proje Koordinatörü" />
        {fieldErrors.title && <p className="text-sm text-destructive">{fieldErrors.title}</p>}
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Kaydediliyor…' : 'Devam et'}
      </Button>
    </form>
  )
}
