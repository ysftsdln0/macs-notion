import { describe, expect, it } from 'vitest'
import { appName } from '@/lib/constants'

describe('smoke', () => {
  it('uygulama adını verir', () => {
    expect(appName).toBe('MACS')
  })
})
