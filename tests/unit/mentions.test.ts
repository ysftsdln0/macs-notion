import { describe, expect, it } from 'vitest'
import { findMentionedNames } from '@/lib/mentions'

const names = ['Ali Veli', 'Ali', 'Efe Taşdelen', 'Şule Işık']

describe('findMentionedNames', () => {
  it('tam adı, devamındaki kelimeleri yutmadan bulur', () => {
    expect(findMentionedNames('@Ali Veli toplantıya gelsin', names)).toEqual(['Ali Veli'])
  })

  it('uzun ad varken kısa adı seçmez', () => {
    expect(findMentionedNames('@Ali Veli', names)).toEqual(['Ali Veli'])
    expect(findMentionedNames('@Ali geldi', names)).toEqual(['Ali'])
  })

  it('Türkçe karakterleri ve büyük/küçük harfi doğru eşler', () => {
    expect(findMentionedNames('@şule ışık bakar mısın', names)).toEqual(['Şule Işık'])
    expect(findMentionedNames('@EFE TAŞDELEN', names)).toEqual(['Efe Taşdelen'])
  })

  it('aynı kişi iki kez geçse tek bildirim üretir', () => {
    expect(findMentionedNames('@Ali ve tekrar @Ali', names)).toEqual(['Ali'])
  })

  it('birden fazla kişiyi bulur', () => {
    expect(findMentionedNames('@Ali ve @Şule Işık', names)).toEqual(
      expect.arrayContaining(['Ali', 'Şule Işık']),
    )
  })

  it('e-posta adresindeki @ bahsetme sayılmaz', () => {
    expect(findMentionedNames('ali@Ali.com yaz', names)).toEqual([])
  })

  it('bilinmeyen ad bahsetme üretmez', () => {
    expect(findMentionedNames('@Kimse Yok', names)).toEqual([])
    expect(findMentionedNames('yorumda hiç @ yok gibi', names)).toEqual([])
  })
})
