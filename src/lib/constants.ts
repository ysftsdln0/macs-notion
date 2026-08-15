export const appName = 'MACS'

/**
 * Hocuspocus websocket adresi.
 *
 * `NEXT_PUBLIC_` öneki BİLEREK yok: değer tarayıcı paketine gömülmüyor.
 * `docs/[id]/page.tsx` bir sunucu bileşeni ve adresi istemci bileşenine prop
 * olarak geçiriyor (`collabUrl={COLLAB_URL}`), yani sunucuda istek anında
 * okunması yeterli. Önek kaldırılınca imaj alan adından bağımsız kalır —
 * aynı imaj her sunucuda çalışır, `Dockerfile`'ın build arg alması gerekmez.
 *
 * Dev'de collab container'ı 1234'ü host'a açar; production'da Caddy `/collab`
 * altında proxy'ler (bkz. Caddyfile ve compose.yml'deki COLLAB_URL).
 */
export const COLLAB_URL = process.env.COLLAB_URL ?? 'ws://localhost:1234'
