/**
 * Sözlük sırasına göre sıralanan, aralarına her zaman yeni değer
 * sığdırılabilen sıra anahtarları (lexorank / fractional index).
 *
 * Sayısal fractional index (0.5, 0.75, 0.875…) yaklaşık 30 eklemede double
 * precision'ı tüketir. Bu yüzden anahtar bir dizedir: base36 basamaklar
 * ('0'–'z') sanal bir "0." ondalık noktasından sonra gelir ve iki değerin
 * ortası her zaman bir basamak daha eklenerek bulunabilir.
 *
 * PLANDAN SAPMA: plan (Task 23) ilk anahtarın `'0'` olmasını ve
 * `rankBetween('', '0') < '0'` olmasını istiyordu. Bu ikisi birlikte
 * imkânsızdır: `'0'` bu alfabenin en küçük basamağıdır ve boş dize dışında
 * ondan küçük bir dize yoktur (`'00'`, `'0i'` gibi her uzatma `'0'`den
 * BÜYÜKTÜR, çünkü kısa dize kendi öneki olan uzun dizeden önce gelir).
 * Bunun yerine ilk anahtar aralığın ORTASINDAN verilir ve üretilen hiçbir
 * anahtar `'0'` ile bitmez — böylece hem başa hem sona sınırsız ekleme
 * yapılabilir (`'0i'` → `'09'` → `'04'` → … → `'00i'`).
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const MID_DIGIT = DIGITS[Math.floor(BASE / 2)] as string

export const FIRST_RANK = rankBetween('', '')

function digitOf(char: string | undefined, fallback: number): number {
  if (char === undefined) return fallback
  const index = DIGITS.indexOf(char)
  return index === -1 ? fallback : index
}

/**
 * `lower < sonuç < upper`. Boş `lower` alt sınırın altını, boş `upper` üst
 * sınırın üstünü temsil eder (yani listenin başı / sonu).
 */
function midpoint(lower: string, upper: string): string {
  // Ortak önek korunur, karar ilk ayrıldıkları basamakta verilir.
  let shared = 0
  while (
    shared < lower.length &&
    upper !== '' &&
    shared < upper.length &&
    lower[shared] === upper[shared]
  ) {
    shared++
  }
  if (shared > 0) {
    return (
      lower.slice(0, shared) +
      midpoint(lower.slice(shared), upper === '' ? '' : upper.slice(shared))
    )
  }

  const low = lower.length > 0 ? digitOf(lower[0], 0) : -1
  const high = upper.length > 0 ? digitOf(upper[0], BASE) : BASE

  if (high - low > 1) {
    return DIGITS[low + Math.floor((high - low) / 2)] as string
  }

  // İki basamak komşu: bu derinlikte yer yok, bir derine inilir.
  if (lower === '') {
    // Alt sınır yok ve upper en küçük basamakla başlıyor: ondan küçük bir
    // değere ancak AYNI basamakla başlayıp derinde küçülerek inilir
    // ('0h' → '08' → '03' → '01' → '00h' …). Burada upper'ın kısıtı devam
    // eder; sonsuz sayılıp bırakılırsa üretilen değer upper'ın kendisine
    // eşit çıkar ve başa ekleme kilitlenir.
    const head = upper[0] as string
    return head + midpoint('', upper.slice(1))
  }
  // lower'ın basamağı korunur — o basamakla başlayan her dize upper'dan
  // küçüktür, bu yüzden derinde üst sınır kısıtı kalmaz.
  return (lower[0] as string) + midpoint(lower.slice(1), '')
}

/**
 * `'0'` ile biten anahtar üretilmez: `'x0'` ile `'x'` arasına bir daha değer
 * sığmazdı (`'x0'`den küçük ve `'x'`den büyük dize yok). Sonuna orta
 * basamak eklemek anahtarı üst sınırın altında tutar — midpoint hiçbir zaman
 * upper'ın öneki olan bir değer döndürmez, bu yüzden uzatmak sırayı bozmaz.
 */
function avoidTrailingZero(rank: string): string {
  return rank.endsWith('0') ? rank + MID_DIGIT : rank
}

export function rankBetween(prev: string, next: string): string {
  const lower = prev.trim()
  const upper = next.trim()

  // Eşit ya da ters sıralı sınırlar bir veri anomalisidir (kopya rank'lar).
  // Deterministik ve lower'dan büyük bir değer döner; nihai sıra ikincil
  // ölçüte (createdAt) göre çözülür ve rebalanceRanks ile düzeltilir.
  if (lower !== '' && upper !== '' && lower >= upper) {
    return lower + MID_DIGIT
  }

  return avoidTrailingZero(midpoint(lower, upper))
}

/**
 * Bir grubu baştan sona eşit aralıklı anahtarlarla yeniden numaralar.
 * Kopya ya da aşırı uzamış anahtarlar biriktiğinde çağrılır.
 */
export function rebalanceRanks(count: number): string[] {
  if (count <= 0) return []
  const ranks: string[] = []
  const step = BASE / (count + 1)
  for (let i = 1; i <= count; i++) {
    const digit = Math.min(BASE - 1, Math.max(1, Math.round(i * step)))
    ranks.push(DIGITS[digit] as string)
  }
  // Yuvarlama iki ardışık öğeye aynı basamağı verebilir; çakışanları
  // aralarına değer üreterek ayırıyoruz (sıra her koşulda kesin artan olmalı).
  for (let i = 1; i < ranks.length; i++) {
    if ((ranks[i] as string) <= (ranks[i - 1] as string)) {
      ranks[i] = rankBetween(ranks[i - 1] as string, ranks[i + 1] ?? '')
    }
  }
  return ranks
}
