import { describe, expect, it } from 'vitest'
import { slugify } from '@/lib/slug'

describe('slugify', () => {
  it('Türkçe karakterleri ASCII karşılığına çevirir', () => {
    expect(slugify('Proje Koordinatörlüğü')).toBe('proje-koordinatorlugu')
    expect(slugify('Sponsorluk & İletişim')).toBe('sponsorluk-iletisim')
  })

  it('baştaki ve sondaki tireleri temizler', () => {
    expect(slugify('  --Medya!!  ')).toBe('medya')
  })
})
