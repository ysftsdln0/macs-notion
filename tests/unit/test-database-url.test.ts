import { describe, expect, it } from 'vitest'
import { testDatabaseUrl } from '../helpers/test-database-url'

describe('testDatabaseUrl', () => {
  it('veritabanı adına _test ekler, host/port/kimlik bilgilerini korur', () => {
    expect(testDatabaseUrl('postgresql://macs:macs@localhost:5433/macs'))
      .toBe('postgresql://macs:macs@localhost:5433/macs_test')
  })

  it('idempotent: zaten _test ile biten URL değişmez (CI bu yüzden etkilenmez)', () => {
    const ciUrl = 'postgresql://postgres:postgres@localhost:5432/macs_test'
    expect(testDatabaseUrl(ciUrl)).toBe(ciUrl)
  })

  it('sorgu parametreleri korunur', () => {
    expect(testDatabaseUrl('postgresql://u:p@h:5432/db?schema=public&connection_limit=5'))
      .toBe('postgresql://u:p@h:5432/db_test?schema=public&connection_limit=5')
  })

  it('veritabanı adı yoksa URL olduğu gibi döner', () => {
    expect(testDatabaseUrl('postgresql://u:p@h:5432/')).toBe('postgresql://u:p@h:5432/')
  })
})
