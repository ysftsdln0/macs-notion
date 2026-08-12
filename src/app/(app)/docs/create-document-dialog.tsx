'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createDocument } from '@/server/documents'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { DOCUMENT_VISIBILITY_OPTIONS } from '@/lib/document-labels'

export type DocumentChannelOption = { id: string; name: string; visibility: 'OPEN' | 'PRIVATE' }
export type DocumentParentOption = { id: string; title: string; channelId: string }

export function CreateDocumentDialog({
  channels, parents, triggerLabel = 'Yeni doküman', defaultChannelId,
}: {
  channels: DocumentChannelOption[]
  parents: DocumentParentOption[]
  triggerLabel?: string
  defaultChannelId?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [channelId, setChannelId] = useState(defaultChannelId ?? channels[0]?.id ?? '')
  const [visibility, setVisibility] = useState<'PUBLIC' | 'CHANNEL' | 'PRIVATE'>('PUBLIC')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Ebeveyn seçimi kanala bağlıdır: başka kanaldaki bir dokümanı ebeveyn
  // yapmak action tarafında VALIDATION ile reddedilir, listede hiç gösterme.
  const parentOptions = parents.filter((p) => p.channelId === channelId)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createDocument({
        title, channelId, visibility, parentId: parentId || null,
      })
      if (!result.ok) {
        setError(result.error.fields?.title ?? result.error.fields?.parentId ?? result.error.message)
        return
      }
      toast.success('Doküman oluşturuldu.')
      setOpen(false)
      setTitle('')
      setParentId('')
      router.push(`/docs/${result.data.id}`)
    })
  }

  if (channels.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Doküman açabilmek için önce bir kanala üye olman gerekiyor.
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{triggerLabel}</Button>} />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Yeni doküman</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label htmlFor="doc-title">Başlık</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Adsız doküman"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-channel">Kanal</Label>
              <select
                id="doc-channel"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value)
                  setParentId('')
                }}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-visibility">Görünürlük</Label>
              <select
                id="doc-visibility"
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as typeof visibility)}
              >
                {DOCUMENT_VISIBILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {visibility === 'PRIVATE' && (
                <p className="text-xs text-muted-foreground">Yöneticiler erişebilir.</p>
              )}
            </div>
            {parentOptions.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="doc-parent">Üst doküman (opsiyonel)</Label>
                <select
                  id="doc-parent"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">— Yok —</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.title || 'Adsız doküman'}</option>
                  ))}
                </select>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Oluşturuluyor…' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
