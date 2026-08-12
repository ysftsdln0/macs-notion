'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archiveBudgetEntry, updateBudgetEntry } from '@/server/budget'
import { uploadAttachment } from '@/lib/upload'
import { Button } from '@/components/ui/button'
import { BUDGET_STATUS_ORDER, describeBudgetStatus } from '@/lib/finance-labels'
import type { BudgetStatus } from '@prisma/client'

export function BudgetEntryRowActions({
  entry,
}: {
  entry: { id: string; title: string; status: BudgetStatus }
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  function handleStatus(next: BudgetStatus) {
    startTransition(async () => {
      const result = await updateBudgetEntry({ id: entry.id, status: next })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  function handleReceipt(file: File) {
    startTransition(async () => {
      const upload = await uploadAttachment(file, 'BudgetEntry', entry.id)
      if (!upload.ok) {
        toast.error(upload.error)
        return
      }
      const linked = await updateBudgetEntry({
        id: entry.id, receiptAttachmentId: upload.data.id,
      })
      if (!linked.ok) {
        toast.error(linked.error.message)
        return
      }
      if (fileRef.current) fileRef.current.value = ''
      toast.success('Fiş eklendi.')
      router.refresh()
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveBudgetEntry({ id: entry.id })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('Kalem arşivlendi.')
      setConfirming(false)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="sr-only" htmlFor={`status-${entry.id}`}>
        {entry.title} durumu
      </label>
      <select
        id={`status-${entry.id}`}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
        value={entry.status}
        disabled={pending}
        onChange={(e) => handleStatus(e.target.value as BudgetStatus)}
      >
        {BUDGET_STATUS_ORDER.map((s) => (
          <option key={s} value={s}>{describeBudgetStatus(s)}</option>
        ))}
      </select>

      <label
        className="cursor-pointer rounded-lg border px-2 py-1 text-xs hover:bg-muted"
        htmlFor={`receipt-${entry.id}`}
      >
        Fiş yükle
      </label>
      <input
        id={`receipt-${entry.id}`}
        ref={fileRef}
        type="file"
        className="hidden"
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleReceipt(file)
        }}
      />

      {confirming ? (
        <span className="flex items-center gap-1">
          <Button size="sm" variant="destructive" disabled={pending} onClick={handleArchive}>
            {pending ? 'Arşivleniyor…' : 'Onayla'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(true)}>
          Arşivle
        </Button>
      )}
    </div>
  )
}
