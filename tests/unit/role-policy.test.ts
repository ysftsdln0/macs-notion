import { describe, expect, it } from 'vitest'
import { flattenPermissions, has } from '@/lib/auth/policy'
import { makeActor } from '../helpers/make-actor'

describe('has()', () => {
  it('izni olan rolü taşıyan üye o izne sahiptir', () => {
    const actor = makeActor({ id: 'yk', permissions: ['CONTENT_READ_ALL'] })
    expect(has(actor, 'CONTENT_READ_ALL')).toBe(true)
  })

  it('taşımadığı izne sahip değildir', () => {
    const actor = makeActor({ id: 'yk', permissions: ['CONTENT_READ_ALL'] })
    expect(has(actor, 'BUDGET_WRITE_ALL')).toBe(false)
  })

  it('ADMIN ve SUPERADMIN her izni kapsar', () => {
    for (const globalRole of ['ADMIN', 'SUPERADMIN'] as const) {
      const actor = makeActor({ id: 'x', globalRole, permissions: [] })
      expect(has(actor, 'TRASH_MANAGE')).toBe(true)
      expect(has(actor, 'BUDGET_WRITE_ALL')).toBe(true)
    }
  })

  // policy.ts'in en üstündeki tek mutlak kural burada da geçerli olmalı:
  // pasife alınmış bir kişinin rolleri hâlâ tabloda duruyor olabilir.
  it('pasif kullanıcı hiçbir izne sahip değildir', () => {
    const passiveAdmin = makeActor({ id: 'a', globalRole: 'ADMIN', isActive: false })
    const passiveWithRole = makeActor({
      id: 'b', isActive: false, permissions: ['CONTENT_READ_ALL'],
    })
    expect(has(passiveAdmin, 'CONTENT_READ_ALL')).toBe(false)
    expect(has(passiveWithRole, 'CONTENT_READ_ALL')).toBe(false)
  })
})

describe('flattenPermissions()', () => {
  it('birden çok rolün izinlerini birleştirir', () => {
    const result = flattenPermissions([
      { role: { permissions: ['CONTENT_READ_ALL', 'INVITE_MANAGE'] } },
      { role: { permissions: ['BUDGET_READ_ALL'] } },
    ])
    expect(result.sort()).toEqual(['BUDGET_READ_ALL', 'CONTENT_READ_ALL', 'INVITE_MANAGE'])
  })

  it('aynı izni iki rolden alan kullanıcıda tekrar üretmez', () => {
    const result = flattenPermissions([
      { role: { permissions: ['CONTENT_READ_ALL'] } },
      { role: { permissions: ['CONTENT_READ_ALL'] } },
    ])
    expect(result).toEqual(['CONTENT_READ_ALL'])
  })

  it('rolsüz kullanıcıda boş dizi döner', () => {
    expect(flattenPermissions([])).toEqual([])
  })
})
