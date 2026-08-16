import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { logout } from '@/server/auth-actions'

/**
 * Çıkış butonu: sidebar alt çubuğu (masaüstü) ve üst çubuk (mobil) aynı
 * bileşeni basar. ThemeToggle ile aynı görsel dil — ghost `icon-sm`, yalnızca
 * ikon; erişilebilir ad `aria-label`'dan gelir.
 */
export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="ghost" size="icon-sm" aria-label="Çıkış yap">
        <LogOut />
      </Button>
    </form>
  )
}
