import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Bu testler uygulamayı değil KONFİGÜRASYONU denetler ve bilerek kaba yazılmıştır.
 *
 * Gerekçesi: collab adresi hatası e2e'nin YAPISAL olarak yakalayamayacağı
 * türdendi. `playwright.config.ts` sunuculara kendi env'ini geçiriyor, yani
 * testte adres her zaman doğru; hata yalnızca gerçek deploy'da görünüyor ve tek
 * belirtisi "editör eşitlenmiyor" oluyor — kimse bunu deploy'a bağlamaz.
 * Değişkenin adı değişirse ya da satır silinirse CI burada düşer.
 */
const compose = readFileSync('compose.yml', 'utf8')
const caddyfile = readFileSync('Caddyfile', 'utf8')

describe('compose.yml', () => {
  it('web servisine collab adresini geçirir', () => {
    // `${DOMAIN...}` kısmı `[^}]*` ile eşlenir: DOMAIN çıplak (`${DOMAIN}`)
    // ya da `:?...` guard'lı (`${DOMAIN:?mesaj}`) olabilir, ikisi de geçerli.
    expect(compose).toMatch(/COLLAB_URL:\s*wss:\/\/\$\{DOMAIN[^}]*\}\/collab/)
  })

  it('istemciye gömülen eski NEXT_PUBLIC_ değişkenini kullanmaz', () => {
    expect(compose).not.toContain('NEXT_PUBLIC_COLLAB_URL')
  })
})

describe('Caddyfile', () => {
  /**
   * Hocuspocus provider bağlantı adresini `serverUrl` olarak kurar ve sondaki
   * eğik çizgiyi AKTİF OLARAK siler (hocuspocus-provider.cjs:1962-1967);
   * doküman adı yola değil protokol mesajına gider. Yani websocket isteğinin
   * yolu tam olarak `/collab`. `/collab/*` matcher'ı bunu eşlemez ve istek
   * web servisine düşüp 404 alır.
   */
  it('çıplak /collab yolunu da eşler', () => {
    expect(caddyfile).toMatch(/handle_path\s+\/collab\*/)
    expect(caddyfile).not.toMatch(/handle_path\s+\/collab\/\*/)
  })
})

describe('compose.yml ↔ Caddyfile', () => {
  // Yukarıdaki iki describe her dosyayı AYRI doğruluyor; ikisi arasındaki
  // BAĞI hiçbiri kontrol etmiyordu — biri `/collab` yolunu değiştirip
  // diğerini unutursa iki test de sessizce geçerdi. compose'un COLLAB_URL'
  // indeki yol parçasıyla Caddyfile'ın handle_path önekini doğrudan
  // karşılaştırarak bu boşluğu kapatır.
  it('COLLAB_URL yolu ile Caddyfile handle_path öneki aynı', () => {
    const composePath = compose.match(/COLLAB_URL:\s*wss:\/\/\$\{DOMAIN[^}]*\}(\/[a-z]+)/)?.[1]
    const caddyPath = caddyfile.match(/handle_path\s+(\/[a-z]+)\*/)?.[1]
    expect(composePath).toBeDefined()
    expect(composePath).toBe(caddyPath)
  })
})
