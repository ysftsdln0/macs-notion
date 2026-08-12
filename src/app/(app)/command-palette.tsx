'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarDays, CheckSquare, FileText, Heart, Plus, Search,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { globalSearchAction } from '@/server/search-actions'
import type { SearchHit, SearchHitType } from '@/server/search'
import { cn } from '@/lib/utils'

const MIN_QUERY_LENGTH = 2

const shortcuts = [
  { label: 'Yeni doküman', href: '/docs', icon: Plus },
  { label: 'Yeni görev', href: '/tasks', icon: Plus },
  { label: 'Etkinlik takvimi', href: '/events', icon: CalendarDays },
  { label: 'Gelen kutusu', href: '/inbox', icon: Search },
]

const typeMeta: Record<SearchHitType, { label: string; icon: typeof FileText; href: (id: string) => string }> = {
  document: { label: 'Dokümanlar', icon: FileText, href: (id) => `/docs/${id}` },
  task: { label: 'Görevler', icon: CheckSquare, href: () => '/tasks' },
  event: { label: 'Etkinlikler', icon: CalendarDays, href: (id) => `/events/${id}` },
  sponsor: { label: 'Sponsorlar', icon: Heart, href: (id) => `/sponsors/${id}` },
}

const TYPE_ORDER: SearchHitType[] = ['document', 'task', 'event', 'sponsor']

/**
 * Arama durumu "hangi sorgunun sonucu" olarak tutulur (`{ query, hits }`);
 * ayrı bir `loading` bayrağı effect gövdesinde setState gerektirirdi
 * (react-hooks/set-state-in-effect). Yükleniyor durumu türetilir —
 * `docs/search-box.tsx` ile aynı desen.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ query: string; hits: SearchHit[] } | null>(null)
  const [failure, setFailure] = useState<{ query: string; message: string } | null>(null)
  const [highlight, setHighlight] = useState(0)

  const trimmed = query.trim()
  const active = trimmed.length >= MIN_QUERY_LENGTH
  const settled = result?.query === trimmed
  const failed = failure?.query === trimmed
  const loading = active && !settled && !failed
  const hits = active && settled ? result.hits : []

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((previous) => !previous)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const next = query.trim()
    if (next.length < MIN_QUERY_LENGTH) return
    // 200ms debounce: her tuş vuruşunda dört tabloda tsvector sorgusu atmak
    // gereksiz yük.
    const timer = setTimeout(async () => {
      const response = await globalSearchAction({ query: next })
      if (!response.ok) {
        setFailure({ query: next, message: response.error.message })
        return
      }
      setResult({ query: next, hits: response.data })
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  // Sonuçlar ekranda türe göre gruplanır; klavye gezinme sırası da AYNI
  // sıra olmalı, yoksa ok tuşu listede zıplar.
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    hits: hits.filter((hit) => hit.type === type),
  })).filter((group) => group.hits.length > 0)
  const orderedHits = grouped.flatMap((group) => group.hits)

  const items: { href: string }[] = active
    ? orderedHits.map((hit) => ({ href: typeMeta[hit.type].href(hit.id) }))
    : shortcuts.map((shortcut) => ({ href: shortcut.href }))

  function go(href: string) {
    setOpen(false)
    setQuery('')
    setHighlight(0)
    router.push(href)
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((index) => (index + 1) % items.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((index) => (index - 1 + items.length) % items.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const target = items[Math.min(highlight, items.length - 1)]
      if (target) go(target.href)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-24 max-w-lg translate-y-0 gap-0 p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Komut paleti</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
            }}
            onKeyDown={handleInputKeyDown}
            maxLength={200}
            placeholder="Ara ya da bir sayfaya git…"
            aria-label="Ara"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {!active && (
            <div className="space-y-0.5">
              <p className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">
                Kısayollar
              </p>
              {shortcuts.map((shortcut, index) => {
                const Icon = shortcut.icon
                return (
                  <button
                    key={shortcut.href}
                    type="button"
                    onClick={() => go(shortcut.href)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm',
                      index === highlight ? 'bg-muted' : 'hover:bg-muted',
                    )}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    {shortcut.label}
                  </button>
                )
              })}
            </div>
          )}

          {loading && <p className="px-2 py-3 text-xs text-muted-foreground">Aranıyor…</p>}
          {failed && <p className="px-2 py-3 text-xs text-destructive">{failure?.message}</p>}
          {active && settled && hits.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">Sonuç bulunamadı.</p>
          )}

          {grouped.map((group) => {
            const Icon = typeMeta[group.type].icon
            return (
              <div key={group.type} className="space-y-0.5">
                <p className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">
                  {typeMeta[group.type].label}
                </p>
                {group.hits.map((hit) => {
                  const index = orderedHits.indexOf(hit)
                  return (
                    <button
                      key={`${hit.type}-${hit.id}`}
                      type="button"
                      onClick={() => go(typeMeta[hit.type].href(hit.id))}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm',
                        index === highlight ? 'bg-muted' : 'hover:bg-muted',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{hit.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{hit.subtitle}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
