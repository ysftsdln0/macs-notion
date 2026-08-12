'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createSponsor } from '@/server/sponsors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  CURRENCY_ORDER, SPONSOR_STATUS_ORDER, describeSponsorStatus,
} from '@/lib/finance-labels'
import type { Currency, SponsorStatus } from '@prisma/client'

export function CreateSponsorDialog({
  channels, triggerLabel = 'Yeni sponsor',
}: {
  channels: { id: string; name: string }[]
  triggerLabel?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [status, setStatus] = useState<SponsorStatus>('PROSPECT')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('TRY')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createSponsor({
        name, channelId, status, currency,
        amount: amount.trim() === '' ? null : amount.trim(),
        contactName: contactName.trim() === '' ? null : contactName,
        contactEmail: contactEmail.trim() === '' ? null : contactEmail,
      })
      if (!result.ok) {
        setError(
          result.error.fields?.amount ?? result.error.fields?.contactEmail ??
          result.error.fields?.name ?? result.error.message,
        )
        return
      }
      toast.success('Sponsor eklendi.')
      setOpen(false)
      setName('')
      setAmount('')
      setContactName('')
      setContactEmail('')
      router.refresh()
    })
  }

  if (channels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sponsor ekleyebilmek için önce bir kanala üye olman gerekiyor.
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{triggerLabel}</Button>} />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Yeni sponsor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label htmlFor="sponsor-name">Kurum adı</Label>
              <Input
                id="sponsor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={160}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sponsor-channel">Kanal</Label>
              <select
                id="sponsor-channel"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sponsor-status">Durum</Label>
              <select
                id="sponsor-status"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as SponsorStatus)}
              >
                {SPONSOR_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{describeSponsorStatus(s)}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="sponsor-amount">Tutar (opsiyonel)</Label>
                <Input
                  id="sponsor-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
              <div className="w-28 space-y-1">
                <Label htmlFor="sponsor-currency">Birim</Label>
                <select
                  id="sponsor-currency"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                >
                  {CURRENCY_ORDER.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sponsor-contact">İletişim kişisi (opsiyonel)</Label>
              <Input
                id="sponsor-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={160}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sponsor-email">İletişim e-postası (opsiyonel)</Label>
              <Input
                id="sponsor-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
