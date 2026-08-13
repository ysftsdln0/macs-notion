/**
 * Bu dosya BİLEREK 'use server' taşımaz — `Actor` parametresi alır
 * (bkz. `channels-query.ts`'teki gerekçe).
 */

import type { Currency, Prisma, SponsorStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { can, has, type Actor, type Visibility } from '@/lib/auth/policy'

export type SponsorView = {
  id: string
  name: string
  status: SponsorStatus
  amount: string | null
  currency: Currency
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  notes: string | null
  createdById: string
  channel: { id: string; name: string }
  event: { id: string; title: string } | null
  owner: { id: string; name: string } | null
}

const sponsorSelect = {
  id: true,
  name: true,
  status: true,
  amount: true,
  currency: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  notes: true,
  createdById: true,
  channel: { select: { id: true, name: true } },
  event: { select: { id: true, title: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.SponsorSelect

type SponsorRow = Prisma.SponsorGetPayload<{ select: typeof sponsorSelect }>

/**
 * `Decimal` istemci bileşenlerine geçirilemez (serileşmez): tutar dizeye
 * çevrilir ve kuruş hassasiyeti korunur.
 */
function toView(row: SponsorRow): SponsorView {
  return { ...row, amount: row.amount === null ? null : row.amount.toString() }
}

/** `can(actor, 'content:read', …)` dallarının sorgu karşılığı. */
function readableChannelFilter(actor: Actor): Prisma.SponsorWhereInput {
  if (has(actor, 'CONTENT_READ_ALL')) return {}
  return {
    OR: [
      { channel: { visibility: 'OPEN' } },
      { channelId: { in: actor.memberships.map((m) => m.channelId) } },
    ],
  }
}

export async function listSponsors(
  actor: Actor,
  filters: { channelId?: string; eventId?: string } = {},
): Promise<SponsorView[]> {
  const rows = await db.sponsor.findMany({
    where: {
      archivedAt: null,
      channel: { archivedAt: null },
      ...(filters.channelId ? { channelId: filters.channelId } : {}),
      ...(filters.eventId ? { eventId: filters.eventId } : {}),
      ...readableChannelFilter(actor),
    },
    select: sponsorSelect,
    orderBy: [{ updatedAt: 'desc' }],
  })
  return rows.map(toView)
}

export type SponsorContext = {
  sponsor: SponsorView & { archivedAt: Date | null }
  resource: {
    kind: 'content'
    channelId: string
    channelVisibility: Visibility
    channelArchivedAt: Date | null
    ownerId: string
  }
}

export async function loadSponsorContext(sponsorId: string): Promise<SponsorContext | null> {
  const sponsor = await db.sponsor.findUnique({
    where: { id: sponsorId },
    select: {
      ...sponsorSelect,
      archivedAt: true,
      channel: { select: { id: true, name: true, visibility: true, archivedAt: true } },
    },
  })
  if (!sponsor) return null
  return {
    sponsor: {
      ...toView({ ...sponsor, channel: { id: sponsor.channel.id, name: sponsor.channel.name } }),
      archivedAt: sponsor.archivedAt,
    },
    resource: {
      kind: 'content',
      channelId: sponsor.channel.id,
      channelVisibility: sponsor.channel.visibility,
      channelArchivedAt: sponsor.channel.archivedAt,
      ownerId: sponsor.createdById,
    },
  }
}

export async function canReadSponsor(actor: Actor, sponsorId: string): Promise<boolean> {
  const context = await loadSponsorContext(sponsorId)
  if (!context || context.sponsor.archivedAt) return false
  return can(actor, 'content:read', context.resource)
}
