import { randomBytes } from 'node:crypto'
import type { BrowserContext } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

export async function signInAs(context: BrowserContext, userId: string): Promise<void> {
  const sessionToken = randomBytes(32).toString('hex')
  await db.session.create({
    data: { sessionToken, userId, expires: new Date(Date.now() + 864e5) },
  })
  await context.addCookies([
    {
      name: 'authjs.session-token', // https altında __Secure- ön eki gelir
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 86_400,
    },
  ])
}
