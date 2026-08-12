import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { extractTextFromYDoc } from '@/lib/doc-search-text'

describe('extractTextFromYDoc', () => {
  it('BlockNote bloğunun metin düğümlerini sırayla birleştirir', () => {
    const doc = new Y.Doc()
    const root = doc.getXmlFragment('document')
    const p1 = new Y.XmlElement('paragraph')
    const t1 = new Y.XmlElement('text')
    t1.insert(0, [new Y.XmlText('İlk')])
    p1.insert(0, [t1])
    root.insert(0, [p1])
    expect(extractTextFromYDoc(doc)).toBe('İlk')
  })

  it('birden çok bloğu yeni satırla ayırır', () => {
    const doc = new Y.Doc()
    const root = doc.getXmlFragment('document')
    const p1 = new Y.XmlElement('paragraph')
    const t1 = new Y.XmlElement('text')
    t1.insert(0, [new Y.XmlText('Birinci')])
    p1.insert(0, [t1])
    root.insert(root.length, [p1])
    const p2 = new Y.XmlElement('paragraph')
    const t2 = new Y.XmlElement('text')
    t2.insert(0, [new Y.XmlText('İkinci')])
    p2.insert(0, [t2])
    root.insert(root.length, [p2])
    expect(extractTextFromYDoc(doc)).toBe('Birinci\nİkinci')
  })

  it('boş dokümandan boş dize döner', () => {
    const doc = new Y.Doc()
    doc.getXmlFragment('document')
    expect(extractTextFromYDoc(doc)).toBe('')
  })
})
