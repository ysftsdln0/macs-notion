import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineAction } from '@/lib/action'
import type { Actor } from '@/lib/auth/policy'

const actor: Actor = { id: 'u1', globalRole: 'MEMBER', isActive: true, memberships: [] }
const schema = z.object({ name: z.string().min(1, 'Ad zorunlu.') })

type Overrides = {
  getActor?: () => Promise<Actor | null>
  authorize?: () => Promise<{ allowed: true } | { allowed: false }>
  handler?: (ctx: { input: { name: string } }) => Promise<{ name: string }>
}

function build(overrides: Overrides = {}) {
  return defineAction({
    input: schema,
    getActor: overrides.getActor ?? (async () => actor),
    authorize: overrides.authorize ?? (async () => ({ allowed: true as const })),
    handler: overrides.handler ?? (async ({ input }) => ({ name: input.name })),
  })
}

describe('defineAction', () => {
  it('geçerli girdiyle handler sonucunu döner', async () => {
    const action = build()
    await expect(action({ name: 'Efe' })).resolves.toEqual({
      ok: true, data: { name: 'Efe' },
    })
  })

  it('geçersiz girdide alan bazlı VALIDATION hatası döner', async () => {
    const action = build()
    const r = await action({ name: '' })
    expect(r).toEqual({
      ok: false,
      error: { code: 'VALIDATION', message: 'Girdiğin bilgilerde hata var.', fields: { name: 'Ad zorunlu.' } },
    })
  })

  it('oturum yoksa UNAUTHENTICATED döner ve handler çalışmaz', async () => {
    const handler = vi.fn()
    const action = build({ getActor: async () => null, handler })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('UNAUTHENTICATED')
    expect(handler).not.toHaveBeenCalled()
  })

  it('yetki reddedilirse FORBIDDEN döner ve handler çalışmaz', async () => {
    const handler = vi.fn()
    const action = build({ authorize: async () => ({ allowed: false as const }), handler })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    expect(handler).not.toHaveBeenCalled()
  })

  it('handler beklenmeyen hata fırlatırsa INTERNAL döner', async () => {
    const action = build({ handler: async () => { throw new Error('boom') } })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INTERNAL')
  })
})
