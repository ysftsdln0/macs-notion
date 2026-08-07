import { describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { actionError, defineAction } from '@/lib/action'
import type { Actor } from '@/lib/auth/policy'

const actor: Actor = { id: 'u1', globalRole: 'MEMBER', isActive: true, memberships: [] }
const schema = z.object({ name: z.string().min(1, 'Ad zorunlu.') })

type Overrides = {
  getActor?: () => Promise<Actor | null>
  authorize?: () => Promise<{ allowed: true } | { allowed: false; code?: 'FORBIDDEN' | 'NOT_FOUND' }>
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

  it('getActor reddedilirse (reject) INTERNAL döner ve handler çalışmaz', async () => {
    const handler = vi.fn()
    const action = build({ getActor: async () => { throw new Error('db down') }, handler })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INTERNAL')
    expect(handler).not.toHaveBeenCalled()
  })

  it('authorize reddedilirse (reject) INTERNAL döner ve handler çalışmaz', async () => {
    const handler = vi.fn()
    const action = build({
      authorize: async () => { throw new Error('db down') },
      handler,
    })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INTERNAL')
    expect(handler).not.toHaveBeenCalled()
  })

  it('handler actionError fırlatırsa kodu ve alanları taşıyan Result döner', async () => {
    const action = build({
      handler: async () => {
        throw actionError('CONFLICT', { name: 'Bu ad kullanılıyor.' })
      },
    })
    const r = await action({ name: 'Efe' })
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Bu işlem mevcut durumla çakışıyor.',
        fields: { name: 'Bu ad kullanılıyor.' },
      },
    })
  })

  it('handler Next redirect fırlatırsa bu INTERNAL\'a çevrilmez, dışarı sızar', async () => {
    const action = build({
      handler: async () => {
        redirect('/x')
      },
    })
    await expect(action({ name: 'Efe' })).rejects.toThrow('NEXT_REDIRECT')
  })

  it('authorize NOT_FOUND koduyla reddederse FORBIDDEN yerine NOT_FOUND döner', async () => {
    const handler = vi.fn()
    const action = build({
      authorize: async () => ({ allowed: false as const, code: 'NOT_FOUND' as const }),
      handler,
    })
    const r = await action({ name: 'Efe' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
    expect(handler).not.toHaveBeenCalled()
  })
})
