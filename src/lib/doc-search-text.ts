import * as Y from 'yjs'

/**
 * BlockNote'un ydoc'u: kökte 'document' XmlFragment'i, içinde bloklar
 * (XmlElement), her blokta 'text' adlı XmlElement — onun da çocukları
 * metin düğümleri (XmlText). Sıralı gezintiyle blok metinlerini
 * yeni satırla birleştirir; arama metni bundan üretilir.
 */
export function extractTextFromYDoc(doc: Y.Doc): string {
  const root = doc.getXmlFragment('document')
  const parts: string[] = []
  for (let i = 0; i < root.length; i++) {
    const child = root.get(i)
    if (child instanceof Y.XmlElement) {
      parts.push(collectText(child))
    } else if (child instanceof Y.XmlText) {
      parts.push(child.toString())
    }
  }
  return parts.join('\n').trim()
}

function collectText(el: Y.XmlElement): string {
  const parts: string[] = []
  for (let i = 0; i < el.length; i++) {
    const child = el.get(i)
    if (child instanceof Y.XmlText) parts.push(child.toString())
    else if (child instanceof Y.XmlElement) parts.push(collectText(child))
  }
  return parts.join(' ')
}
