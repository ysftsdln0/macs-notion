'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchDocumentsAction } from '@/server/search-actions'
import type { DocumentSearchHit } from '@/server/search'

const MIN_QUERY_LENGTH = 2

/**
 * Arama durumu BİLEREK "hangi sorgunun sonucu" olarak tutulur (`{ query,
 * hits }`), ayrı bir `loading` bayrağı yok: bayrak effect'in gövdesinde
 * setState çağırmayı gerektirir (react-hooks/set-state-in-effect —
 * cascading render). Yükleniyor durumu, elde tutulan sonucun sorgusu
 * kutudaki sorgudan farklıysa TÜRETİLİR.
 */
export function DocumentSearchBox() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ query: string; hits: DocumentSearchHit[] } | null>(null)
  const [failure, setFailure] = useState<{ query: string; message: string } | null>(null)

  const trimmed = query.trim()
  const active = trimmed.length >= MIN_QUERY_LENGTH
  const settled = result?.query === trimmed
  const failed = failure?.query === trimmed
  const loading = active && !settled && !failed

  useEffect(() => {
    const next = query.trim()
    if (next.length < MIN_QUERY_LENGTH) return
    // 200ms debounce: her tuş vuruşunda tsvector sorgusu atmak gereksiz.
    const timer = setTimeout(async () => {
      const response = await searchDocumentsAction({ query: next })
      if (!response.ok) {
        setFailure({ query: next, message: response.error.message })
        return
      }
      setResult({ query: next, hits: response.data })
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="space-y-2">
      <Label htmlFor="doc-search" className="sr-only">Dokümanlarda ara</Label>
      <Input
        id="doc-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Dokümanlarda ara…"
        maxLength={200}
      />
      {loading && <p className="text-xs text-muted-foreground">Aranıyor…</p>}
      {failed && <p className="text-xs text-destructive">{failure?.message}</p>}
      {active && settled && (
        result.hits.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sonuç bulunamadı.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {result.hits.map((hit) => (
              <li key={hit.id}>
                <Link
                  href={`/docs/${hit.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted"
                >
                  <span className="truncate">{hit.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{hit.channelName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
