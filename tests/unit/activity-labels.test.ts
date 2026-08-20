import { describe, expect, it } from 'vitest'
import { describeActivityVerb } from '@/lib/activity-labels'

describe('describeActivityVerb', () => {
  it('bilinen her verb için Türkçe metin döner, İngilizce ham değeri değil', () => {
    // recordActivity çağrılarında kullanılan tüm verb'ler
    // (src/server/*.ts) burada karşılık bulmalı.
    const knownVerbs = [
      'channel.created',
      'channel.memberAdded',
      'channel.memberRemoved',
      'member.joined',
      'member.deactivated',
      'member.reactivated',
      'member.roleChanged',
      'invite.created',
      'invite.revoked',
      'invite.accepted',
    ]

    for (const verb of knownVerbs) {
      const label = describeActivityVerb(verb)
      expect(label).not.toBe(verb)
      expect(label).not.toMatch(/[A-Z]/) // camelCase ham değerin sızmadığının kaba kontrolü
    }
  })

  it('bilinmeyen bir verb için ham İngilizce değeri değil, Türkçe bir yedek metin döner', () => {
    expect(describeActivityVerb('some.unknownVerb')).not.toBe('some.unknownVerb')
    expect(describeActivityVerb('some.unknownVerb')).toMatch(/işlem/i)
  })
})

it('davet duraklat/devam fiillerinin Türkçe karşılığı vardır', () => {
  expect(describeActivityVerb('invite.disabled')).toBe('bir daveti duraklattı')
  expect(describeActivityVerb('invite.enabled')).toBe('bir daveti yeniden açtı')
})
