'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { permanentlyDeleteDocument, restoreDocument } from '@/server/documents'
import { Button } from '@/components/ui/button'

export function TrashRowActions({ documentId, title }: { documentId: string; title: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreDocument({ id: documentId })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('Doküman geri yüklendi.')
      router.refresh()
    })
  }

  function handleDelete() {
    // Geri alınamaz bir işlem: onay olmadan tek tıkla silinmemeli.
    const label = title || 'Adsız doküman'
    if (!window.confirm(`"${label}" kalıcı olarak silinecek. Bu işlem geri alınamaz. Onaylıyor musun?`)) {
      return
    }
    startTransition(async () => {
      const result = await permanentlyDeleteDocument({ id: documentId })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('Doküman kalıcı olarak silindi.')
      router.refresh()
    })
  }

  return (
    <span className="flex shrink-0 gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={handleRestore}>
        Geri yükle
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={handleDelete}>
        Kalıcı sil
      </Button>
    </span>
  )
}
