'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createBudgetEntry, updateBudgetEntry } from '@/server/budget'
import { uploadAttachment } from '@/lib/upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  BUDGET_KIND_ORDER, BUDGET_STATUS_ORDER, CURRENCY_ORDER,
  describeBudgetKind, describeBudgetStatus,
} from '@/lib/finance-labels'
import type { BudgetKind, BudgetStatus, Currency } from '@prisma/client'

export type BudgetRelationOption = { id: string; title: string; channelId: string }

function today(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function BudgetEntryDialog({
  channels, events, sponsors, defaultChannelId, defaultEventId, triggerLabel = 'Yeni kalem',
}: {
  channels: { id: string; name: string }[]
  events: BudgetRelationOption[]
  sponsors: BudgetRelationOption[]
  defaultChannelId?: string
  defaultEventId?: string
  triggerLabel?: string
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [kind, setKind] = useState<BudgetKind>('EXPENSE')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('TRY')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(today())
  const [status, setStatus] = useState<BudgetStatus>('PLANNED')
  const [channelId, setChannelId] = useState(defaultChannelId ?? channels[0]?.id ?? '')
  const [eventId, setEventId] = useState(defaultEventId ?? '')
  const [sponsorId, setSponsorId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const channelEvents = events.filter((e) => e.channelId === channelId)
  const channelSponsors = sponsors.filter((s) => s.channelId === channelId)

  function handleChannelChange(next: string) {
    setChannelId(next)
    // Kanal değişince başka kanalın etkinliği/sponsoru seçili kalırsa
    // action VALIDATION döner; seçimler burada temizlenir.
    setEventId('')
    setSponsorId('')
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const file = fileRef.current?.files?.[0] ?? null

    startTransition(async () => {
      const result = await createBudgetEntry({
        kind, title, amount, currency, category, date, status, channelId,
        eventId: eventId === '' ? null : eventId,
        sponsorId: sponsorId === '' ? null : sponsorId,
      })
      if (!result.ok) {
        setError(
          result.error.fields?.amount ?? result.error.fields?.title ??
          result.error.fields?.category ?? result.error.fields?.eventId ??
          result.error.fields?.sponsorId ?? result.error.message,
        )
        return
      }

      if (file) {
        // Ek, kalem oluştuktan SONRA yüklenir: yükleme yetkisi ekin
        // bağlanacağı varlıktan çözülüyor, yani önce varlık gerekli.
        const upload = await uploadAttachment(file, 'BudgetEntry', result.data.id)
        if (!upload.ok) {
          toast.error(`Kalem eklendi ama fiş yüklenemedi: ${upload.error}`)
          setOpen(false)
          router.refresh()
          return
        }
        const linked = await updateBudgetEntry({
          id: result.data.id, receiptAttachmentId: upload.data.id,
        })
        if (!linked.ok) {
          toast.error(`Kalem eklendi ama fiş bağlanamadı: ${linked.error.message}`)
          setOpen(false)
          router.refresh()
          return
        }
      }

      toast.success('Bütçe kalemi eklendi.')
      setOpen(false)
      setTitle('')
      setAmount('')
      setCategory('')
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    })
  }

  if (channels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Bütçe kalemi eklemek için yönetici yetkisi gerekiyor.
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{triggerLabel}</Button>} />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Yeni bütçe kalemi</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-3">
              <div className="w-32 space-y-1">
                <Label htmlFor="budget-kind">Tür</Label>
                <select
                  id="budget-kind"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as BudgetKind)}
                >
                  {BUDGET_KIND_ORDER.map((k) => (
                    <option key={k} value={k}>{describeBudgetKind(k)}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="budget-title">Başlık</Label>
                <Input
                  id="budget-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={160}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="budget-amount">Tutar</Label>
                <Input
                  id="budget-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  required
                />
              </div>
              <div className="w-28 space-y-1">
                <Label htmlFor="budget-currency">Birim</Label>
                <select
                  id="budget-currency"
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

            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="budget-category">Kategori</Label>
                <Input
                  id="budget-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                  maxLength={60}
                  placeholder="Tanıtım, ikram, ulaşım…"
                />
              </div>
              <div className="w-40 space-y-1">
                <Label htmlFor="budget-date">Tarih</Label>
                <Input
                  id="budget-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="budget-channel">Kanal</Label>
                <select
                  id="budget-channel"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={channelId}
                  onChange={(e) => handleChannelChange(e.target.value)}
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="w-40 space-y-1">
                <Label htmlFor="budget-status">Durum</Label>
                <select
                  id="budget-status"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as BudgetStatus)}
                >
                  {BUDGET_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{describeBudgetStatus(s)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="budget-event">Etkinlik (opsiyonel)</Label>
                <select
                  id="budget-event"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                >
                  <option value="">Yok</option>
                  {channelEvents.map((e) => (
                    <option key={e.id} value={e.id}>{e.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="budget-sponsor">Sponsor (opsiyonel)</Label>
                <select
                  id="budget-sponsor"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={sponsorId}
                  onChange={(e) => setSponsorId(e.target.value)}
                >
                  <option value="">Yok</option>
                  {channelSponsors.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="budget-receipt">Fiş / fatura (opsiyonel)</Label>
              <input
                id="budget-receipt"
                ref={fileRef}
                type="file"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-1 file:text-sm"
              />
              <p className="text-xs text-muted-foreground">En fazla 10 MB.</p>
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
