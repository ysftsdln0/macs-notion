export const appName = 'MACS'

/**
 * Hocuspocus websocket adresi. Tarayıcıya gömüldüğü için NEXT_PUBLIC_
 * öneki zorunlu; dev'de collab container'ı 1234'ü host'a açar, production'da
 * Caddy `/collab` altında proxy'ler (bkz. Caddyfile).
 */
export const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:1234'
