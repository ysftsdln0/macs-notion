import { PrismaClient } from '@prisma/client'
import { createInviteToken } from '../src/lib/auth/invite-token'

const db = new PrismaClient()

async function main() {
  const admin = await db.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Kurucu Admin', email: 'admin@example.com',
      globalRole: 'ADMIN', onboardedAt: new Date(),
    },
  })

  const channel = await db.channel.upsert({
    where: { slug: 'genel' },
    update: {},
    create: {
      name: 'Genel', slug: 'genel', visibility: 'OPEN', createdById: admin.id,
      members: { create: { userId: admin.id, channelRole: 'LEAD' } },
    },
  })

  const { token, tokenHash } = createInviteToken()
  await db.invite.create({
    data: {
      tokenHash, channelId: channel.id, channelRole: 'MEMBER',
      expiresAt: new Date(Date.now() + 7 * 864e5), createdById: admin.id,
    },
  })
  console.log(`Davet linki: http://localhost:3100/invite/${token}`)
}

main().finally(() => db.$disconnect())
