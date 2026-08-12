'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { addComment, deleteComment, editComment } from '@/server/comments'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/state/empty-state'
import type { CommentView } from '@/server/comments-query'

export type MentionCandidate = { id: string; name: string }

/**
 * entityType/entityId ile parametrelenmiş genel yorum akışı: doküman,
 * etkinlik ve sponsor sayfaları aynı bileşeni kullanır.
 */
export function CommentThread({
  entityType, entityId, comments, currentUserId, isAdmin, mentionCandidates,
}: {
  entityType: 'Document'
  entityId: string
  comments: CommentView[]
  currentUserId: string
  isAdmin: boolean
  mentionCandidates: MentionCandidate[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const suggestions =
    mentionQuery === null
      ? []
      : mentionCandidates
          .filter((c) => c.name.toLocaleLowerCase('tr').includes(mentionQuery.toLocaleLowerCase('tr')))
          .slice(0, 5)

  function handleBodyChange(value: string) {
    setBody(value)
    // İmlecin hemen solundaki `@...` parçası mention taslağıdır.
    const upToCursor = value.slice(0, textareaRef.current?.selectionStart ?? value.length)
    const match = /(?:^|\s)@([^@\n]*)$/.exec(upToCursor)
    setMentionQuery(match ? (match[1] ?? '') : null)
  }

  function applySuggestion(name: string) {
    const cursor = textareaRef.current?.selectionStart ?? body.length
    const before = body.slice(0, cursor).replace(
      /(?:^|\s)@[^@\n]*$/,
      (whole) => `${whole.startsWith(' ') ? ' ' : ''}@${name} `,
    )
    setBody(before + body.slice(cursor))
    setMentionQuery(null)
    textareaRef.current?.focus()
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await addComment({ entityType, entityId, body })
      if (!result.ok) {
        setError(result.error.fields?.body ?? result.error.message)
        return
      }
      setBody('')
      setMentionQuery(null)
      router.refresh()
    })
  }

  function handleSaveEdit() {
    if (!editing) return
    startTransition(async () => {
      const result = await editComment({ id: editing.id, body: editing.body })
      if (!result.ok) {
        toast.error(result.error.fields?.body ?? result.error.message)
        return
      }
      setEditing(null)
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteComment({ id })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium uppercase text-muted-foreground">Yorumlar</h2>

      {comments.length === 0 ? (
        <EmptyState title="Henüz yorum yok" description="İlk yorumu sen yaz." />
      ) : (
        <ul className="space-y-3 text-sm">
          {comments.map((comment) => {
            const mine = comment.author.id === currentUserId
            if (comment.deletedAt) {
              return (
                <li key={comment.id} className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  Bu yorum silindi.
                </li>
              )
            }
            return (
              <li key={comment.id} className="rounded border px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{comment.author.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {comment.createdAt.toLocaleString('tr-TR')}
                    {comment.editedAt && ' · düzenlendi'}
                  </span>
                </div>
                {editing?.id === comment.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      className="min-h-16 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
                      value={editing.body}
                      onChange={(e) => setEditing({ id: comment.id, body: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending} onClick={handleSaveEdit}>Kaydet</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Vazgeç</Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
                )}
                {(mine || isAdmin) && editing?.id !== comment.id && (
                  <div className="mt-2 flex gap-2">
                    {mine && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing({ id: comment.id, body: comment.body })}
                      >
                        Düzenle
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleDelete(comment.id)}>
                      Sil
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <form className="space-y-2" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="comment-body">Yorum</label>
        <textarea
          id="comment-body"
          ref={textareaRef}
          className="min-h-20 w-full rounded-lg border border-input bg-transparent p-2 text-sm"
          value={body}
          maxLength={4000}
          placeholder="Yorum yaz… kişi etiketlemek için @ kullan"
          onChange={(e) => handleBodyChange(e.target.value)}
        />
        {suggestions.length > 0 && (
          <ul className="rounded-lg border text-sm">
            {suggestions.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left hover:bg-muted"
                  onClick={() => applySuggestion(c.name)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="sm" disabled={pending || body.trim().length === 0}>
          {pending ? 'Gönderiliyor…' : 'Yorum ekle'}
        </Button>
      </form>
    </section>
  )
}
