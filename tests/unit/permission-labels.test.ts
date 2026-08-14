import { describe, expect, it } from 'vitest'
import { permissionGroupLabels, permissionGroupOrder, permissionLabels, permissionOrder } from '@/lib/permission-labels'

describe('izin etiketleri', () => {
  it('her izin için Türkçe etiket ve grup vardır', () => {
    for (const permission of permissionOrder) {
      const entry = permissionLabels[permission]
      expect(entry.label.length).toBeGreaterThan(0)
      // Ham enum adı arayüze sızmamalı.
      expect(entry.label).not.toMatch(/[A-Z]{2,}_/)
      expect(permissionGroupOrder).toContain(entry.group)
    }
  })

  it('sıralama listesi kataloğun tamamını kapsar, tekrar içermez', () => {
    const catalogue = Object.keys(permissionLabels).sort()
    expect([...permissionOrder].sort()).toEqual(catalogue)
    expect(new Set(permissionOrder).size).toBe(permissionOrder.length)
  })

  it('her grubun Türkçe bir başlığı vardır', () => {
    for (const group of permissionGroupOrder) {
      expect(permissionGroupLabels[group].length).toBeGreaterThan(0)
    }
  })
})
