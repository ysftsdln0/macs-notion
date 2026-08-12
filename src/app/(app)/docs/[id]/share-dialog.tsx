'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { removeShare, upsertShare } from '@/server/documents'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { SHARE_PERMISSION_LABELS } from '@/lib/document-labels'

export type ShareRow = { userId: string; name: string; permission: 'VIEW' | 'EDIT' }
export type ShareCandidate = { id: string; name: string }

export function ShareDialog({
  documentId, shares, candidates,
}: { documentId: string; shares: ShareRow[]; candidates: ShareCandidate[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [userId, setUserId] = useState(candidates[0]?.id ?? '')
  const [permission, setPermission] = useState<'VIEW' | 'EDIT'>('VIEW')

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!userId) return
    startTransition(async () => {
      const result = await upsertShare({ documentId, userId, permission })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('Paylaşım güncellendi.')
      router.refresh()
    })
  }

  function handleRemove(target: string) {
    startTransition(async () => {
      const result = await removeShare({ documentId, userId: target })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  function handlePermissionChange(target: string, next: 'VIEW' | 'EDIT') {
    startTransition(async () => {
      const result = await upsertShare({ documentId, userId: target, permission: next })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Paylaş</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dokümanı paylaş</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">Bu doküman henüz kimseyle paylaşılmadı.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {shares.map((share) => (
                <li key={share.userId} className="flex items-center justify-between gap-2">
                  <span className="truncate">{share.name}</span>
                  <span className="flex items-center gap-1">
                    <select
                      aria-label={`${share.name} yetkisi`}
                      className="h-7 rounded-lg border border-input bg-transparent px-2 text-xs"
                      value={share.permission}
                      disabled={pending}
                      onChange={(e) =>
                        handlePermissionChange(share.userId, e.target.value as 'VIEW' | 'EDIT')
                      }
                    >
                      <option value="VIEW">{SHARE_PERMISSION_LABELS.VIEW}</option>
                      <option value="EDIT">{SHARE_PERMISSION_LABELS.EDIT}</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => handleRemove(share.userId)}
                    >
                      Kaldır
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {candidates.length > 0 ? (
            <form className="flex flex-wrap items-end gap-2 border-t pt-3" onSubmit={handleAdd}>
              <div className="space-y-1">
                <Label htmlFor="share-user">Kişi</Label>
                <select
                  id="share-user"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="share-permission">Yetki</Label>
                <select
                  id="share-permission"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as 'VIEW' | 'EDIT')}
                >
                  <option value="VIEW">{SHARE_PERMISSION_LABELS.VIEW}</option>
                  <option value="EDIT">{SHARE_PERMISSION_LABELS.EDIT}</option>
                </select>
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Ekleniyor…' : 'Ekle'}
              </Button>
            </form>
          ) : (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Paylaşılabilecek başka aktif üye yok.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
