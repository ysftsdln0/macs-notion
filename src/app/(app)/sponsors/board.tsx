'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, PointerSensor, closestCorners, useDraggable, useDroppable,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { moveSponsor } from '@/server/sponsors'
import {
  SPONSOR_STATUS_ORDER, describeSponsorStatus, formatAmount,
} from '@/lib/finance-labels'
import type { SponsorView } from '@/server/sponsors-query'
import type { SponsorStatus } from '@prisma/client'

function isStatus(value: string): value is SponsorStatus {
  return (SPONSOR_STATUS_ORDER as string[]).includes(value)
}

function SponsorCard({ sponsor }: { sponsor: SponsorView }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: sponsor.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`rounded-lg border bg-background p-2 text-sm ${isDragging ? 'opacity-50' : ''}`}
      data-sponsor-name={sponsor.name}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/sponsors/${sponsor.id}`} className="flex-1 font-medium hover:underline">
          {sponsor.name}
        </Link>
        {/* Sürükleme tutamağı ayrı: kartın tamamı sürüklenebilir olsaydı
            karta tıklayıp detaya gitmek imkânsızlaşırdı. */}
        <button
          type="button"
          aria-label={`${sponsor.name} kartını taşı`}
          className="cursor-grab px-1 text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
        <span>{formatAmount(sponsor.amount, sponsor.currency)}</span>
        <span>· {sponsor.channel.name}</span>
        {sponsor.event && <span>· {sponsor.event.title}</span>}
        {sponsor.owner && <span>· {sponsor.owner.name}</span>}
      </div>
    </li>
  )
}

function Column({ status, sponsors }: { status: SponsorStatus; sponsors: SponsorView[] }) {
  const { setNodeRef } = useDroppable({ id: `column:${status}`, data: { status } })

  return (
    <section className="flex min-w-52 flex-1 flex-col gap-2 rounded-lg bg-muted/40 p-2">
      <h3 className="px-1 text-xs font-medium uppercase text-muted-foreground">
        {describeSponsorStatus(status)} ({sponsors.length})
      </h3>
      <ul ref={setNodeRef} className="flex min-h-16 flex-col gap-2" data-column={status}>
        {sponsors.map((sponsor) => (
          <SponsorCard key={sponsor.id} sponsor={sponsor} />
        ))}
      </ul>
    </section>
  )
}

export function SponsorBoard({ sponsors }: { sponsors: SponsorView[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [optimistic, setOptimistic] = useState<Record<string, SponsorStatus>>({})

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const withOptimistic = sponsors.map((s) =>
    optimistic[s.id] ? { ...s, status: optimistic[s.id] as SponsorStatus } : s,
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const sponsor = sponsors.find((s) => s.id === active.id)
    if (!sponsor) return

    const overId = String(over.id)
    const targetStatus = overId.startsWith('column:')
      ? overId.slice('column:'.length)
      : (over.data.current?.status as string | undefined)
    if (!targetStatus || !isStatus(targetStatus) || targetStatus === sponsor.status) return

    setOptimistic((current) => ({ ...current, [sponsor.id]: targetStatus }))
    startTransition(async () => {
      const result = await moveSponsor({ id: sponsor.id, status: targetStatus })
      if (!result.ok) {
        toast.error(result.error.message)
        setOptimistic((current) => {
          const next = { ...current }
          delete next[sponsor.id]
          return next
        })
        return
      }
      setOptimistic({})
      router.refresh()
    })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex flex-wrap gap-3">
        {SPONSOR_STATUS_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            sponsors={withOptimistic.filter((s) => s.status === status)}
          />
        ))}
      </div>
    </DndContext>
  )
}
