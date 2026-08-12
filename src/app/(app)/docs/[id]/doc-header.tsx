'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archiveDocument, updateDocumentMeta } from '@/server/documents'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DOCUMENT_VISIBILITY_OPTIONS, describeDocumentVisibility } from '@/lib/document-labels'
import type { DocumentVisibility } from '@/lib/auth/policy'

export function DocHeader({
  documentId, initialTitle, initialIcon, initialVisibility, channelName,
  canWrite, canShare, canDelete, shareSlot,
}: {
  documentId: string
  initialTitle: string
  initialIcon: string | null
  initialVisibility: DocumentVisibility
  channelName: string
  canWrite: boolean
  canShare: boolean
  canDelete: boolean
  shareSlot?: React.ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(initialTitle)
  const [icon, setIcon] = useState(initialIcon ?? '')
  const [visibility, setVisibility] = useState<DocumentVisibility>(initialVisibility)
  const [savedTitle, setSavedTitle] = useState(initialTitle)
  const [savedIcon, setSavedIcon] = useState(initialIcon ?? '')

  function persist(patch: { title?: string; icon?: string | null; visibility?: DocumentVisibility }) {
    startTransition(async () => {
      const result = await updateDocumentMeta({ id: documentId, ...patch })
      if (!result.ok) {
        toast.error(result.error.message)
        // Sunucu reddettiyse yerel durumu geri al: kullanıcı kaydedilmemiş
        // bir başlığı kaydedilmiş sanmamalı.
        setTitle(savedTitle)
        setIcon(savedIcon)
        setVisibility(initialVisibility)
        return
      }
      if (patch.title !== undefined) setSavedTitle(patch.title)
      if (patch.icon !== undefined) setSavedIcon(patch.icon ?? '')
      router.refresh()
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveDocument({ id: documentId })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success('Doküman çöp kutusuna taşındı.')
      router.push('/docs')
    })
  }

  return (
    <header className="space-y-3 border-b pb-4">
      <div className="flex items-start gap-2">
        <Input
          aria-label="Doküman ikonu"
          className="w-14 text-center"
          value={icon}
          maxLength={8}
          disabled={!canWrite || pending}
          onChange={(e) => setIcon(e.target.value)}
          onBlur={() => icon !== savedIcon && persist({ icon: icon || null })}
          placeholder="📄"
        />
        <Input
          aria-label="Doküman başlığı"
          className="flex-1 border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
          value={title}
          maxLength={120}
          disabled={!canWrite || pending}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== savedTitle && persist({ title })}
          placeholder="Adsız doküman"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{channelName}</span>
        {canShare ? (
          <span className="flex items-center gap-1">
            <Label htmlFor="doc-visibility" className="text-xs font-normal">Görünürlük</Label>
            <select
              id="doc-visibility"
              className="h-7 rounded-lg border border-input bg-transparent px-2 text-xs"
              value={visibility}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value as DocumentVisibility
                setVisibility(next)
                persist({ visibility: next })
              }}
            >
              {DOCUMENT_VISIBILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </span>
        ) : (
          <span>{describeDocumentVisibility(visibility)}</span>
        )}
        {visibility === 'PRIVATE' && <span>Yöneticiler erişebilir.</span>}
        <span className="ml-auto flex items-center gap-2">
          {shareSlot}
          {canDelete && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={handleArchive}>
              Çöp kutusuna taşı
            </Button>
          )}
        </span>
      </div>
    </header>
  )
}
