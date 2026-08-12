'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archiveSponsor, updateSponsor } from '@/server/sponsors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  CURRENCY_ORDER, SPONSOR_STATUS_ORDER, describeSponsorStatus, formatAmount,
} from '@/lib/finance-labels'
import type { SponsorView } from '@/server/sponsors-query'
import type { Currency, SponsorStatus } from '@prisma/client'

export function SponsorDetailForm({
  sponsor, events, members, canWrite, canDelete,
}: {
  sponsor: SponsorView
  events: { id: string; title: string }[]
  members: { id: string; name: string }[]
  canWrite: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<SponsorStatus>(sponsor.status)
  const [amount, setAmount] = useState(sponsor.amount ?? '')
  const [currency, setCurrency] = useState<Currency>(sponsor.currency)
  const [contactName, setContactName] = useState(sponsor.contactName ?? '')
  const [contactEmail, setContactEmail] = useState(sponsor.contactEmail ?? '')
  const [contactPhone, setContactPhone] = useState(sponsor.contactPhone ?? '')
  const [notes, setNotes] = useState(sponsor.notes ?? '')
  const [eventId, setEventId] = useState(sponsor.event?.id ?? '')
  const [ownerUserId, setOwnerUserId] = useState(sponsor.owner?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  if (!canWrite) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Durum</dt>
        <dd>{describeSponsorStatus(sponsor.status)}</dd>
        <dt className="text-muted-foreground">Tutar</dt>
        <dd>{formatAmount(sponsor.amount, sponsor.currency)}</dd>
        <dt className="text-muted-foreground">İletişim</dt>
        <dd>{sponsor.contactName ?? '—'} {sponsor.contactEmail ?? ''} {sponsor.contactPhone ?? ''}</dd>
        <dt className="text-muted-foreground">Etkinlik</dt>
        <dd>{sponsor.event?.title ?? '—'}</dd>
        <dt className="text-muted-foreground">Sorumlu</dt>
        <dd>{sponsor.owner?.name ?? '—'}</dd>
        {sponsor.notes && (
          <>
            <dt className="text-muted-foreground">Notlar</dt>
            <dd className="whitespace-pre-wrap">{sponsor.notes}</dd>
          </>
        )}
      </dl>
    )
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateSponsor({
        id: sponsor.id, status, currency,
        amount: amount.trim() === '' ? null : amount.trim(),
        contactName: contactName.trim() === '' ? null : contactName,
        contactEmail: contactEmail.trim() === '' ? null : contactEmail,
        contactPhone: contactPhone.trim() === '' ? null : contactPhone,
        notes: notes.trim() === '' ? null : notes,
        eventId: eventId === '' ? null : eventId,
        ownerUserId: ownerUserId === '' ? null : ownerUserId,
      })
      if (!result.ok) {
        setError(
          result.error.fields?.amount ?? result.error.fields?.contactEmail ??
          result.error.fields?.eventId ?? result.error.message,
        )
        return
      }
      toast.success('Sponsor güncellendi.')
      router.refresh()
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveSponsor({ id: sponsor.id })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('Sponsor arşivlendi.')
      router.push('/sponsors')
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="sponsor-detail-status">Durum</Label>
          <select
            id="sponsor-detail-status"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as SponsorStatus)}
          >
            {SPONSOR_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{describeSponsorStatus(s)}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="sponsor-detail-amount">Tutar</Label>
          <Input
            id="sponsor-detail-amount"
            value={amount}
            inputMode="decimal"
            placeholder="0,00"
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor="sponsor-detail-currency">Birim</Label>
          <select
            id="sponsor-detail-currency"
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

      <div className="flex flex-wrap gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="sponsor-detail-contact">İletişim kişisi</Label>
          <Input
            id="sponsor-detail-contact"
            value={contactName}
            maxLength={160}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="sponsor-detail-email">E-posta</Label>
          <Input
            id="sponsor-detail-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="sponsor-detail-phone">Telefon</Label>
          <Input
            id="sponsor-detail-phone"
            value={contactPhone}
            maxLength={40}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="sponsor-detail-event">Bağlı etkinlik</Label>
          <select
            id="sponsor-detail-event"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">— Yok —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="sponsor-detail-owner">Sorumlu üye</Label>
          <select
            id="sponsor-detail-owner"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">— Yok —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="sponsor-detail-notes">Notlar</Label>
        <textarea
          id="sponsor-detail-notes"
          className="min-h-24 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between gap-2">
        {canDelete ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={handleArchive}>
            Arşivle
          </Button>
        ) : <span />}
        <Button size="sm" disabled={pending} onClick={handleSave}>
          {pending ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      </div>
    </div>
  )
}
