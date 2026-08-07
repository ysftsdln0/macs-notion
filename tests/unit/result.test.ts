import { describe, expect, it } from 'vitest'
import { fail, ok } from '@/lib/result'

describe('Result', () => {
  it('başarılı sonucu sarmalar', () => {
    expect(ok({ id: '1' })).toEqual({ ok: true, data: { id: '1' } })
  })

  it('hata koduna Türkçe mesaj eşler', () => {
    const r = fail('FORBIDDEN')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error.code).toBe('FORBIDDEN')
    expect(r.error.message).toBe('Bu işlem için yetkin yok.')
  })

  it('alan bazlı doğrulama hatalarını taşır', () => {
    const r = fail('VALIDATION', { name: 'Ad zorunlu.' })
    if (r.ok) throw new Error('unreachable')
    expect(r.error.fields).toEqual({ name: 'Ad zorunlu.' })
  })
})
