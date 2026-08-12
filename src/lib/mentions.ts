/**
 * Yorum gövdesinde geçen `@Ad Soyad` bahsetmelerini bulur.
 *
 * Naif bir `/@([\wçğıöşü ]+)/` yakalaması boşluk gördüğü sürece yutmaya
 * devam eder: "@Ali Veli toplantıya gelsin" tek bir "Ali Veli toplantıya
 * gelsin" adı üretir ve hiçbir kullanıcıyla eşleşmez. Bunun yerine `@`
 * sonrası metin, BİLİNEN adlarla — uzundan kısaya — önek olarak
 * karşılaştırılır: "Ali Veli" varsa o, yoksa "Ali" eşleşir.
 *
 * Karşılaştırma Türkçe yerel ayarıyla küçük harfe indirilir; 'İ'/'ı'
 * çiftinde varsayılan `toLowerCase()` yanlış sonuç verir.
 */
export function findMentionedNames(body: string, knownNames: string[]): string[] {
  const normalized = [...knownNames]
    .filter((name) => name.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, key: name.toLocaleLowerCase('tr') }))

  const found = new Set<string>()
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@') continue
    // `a@b.com` gibi e-posta içindeki @ bahsetme değildir.
    const previous = i > 0 ? body[i - 1] : ' '
    if (previous && /[\p{L}\p{N}]/u.test(previous)) continue

    const rest = body.slice(i + 1).toLocaleLowerCase('tr')
    for (const candidate of normalized) {
      if (rest.startsWith(candidate.key)) {
        found.add(candidate.name)
        break
      }
    }
  }
  return [...found]
}
