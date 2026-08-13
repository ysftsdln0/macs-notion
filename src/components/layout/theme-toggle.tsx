'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'

/**
 * Açık/koyu mod anahtarı. Koyu mod tokenları globals.css'te baştan tanımlıydı
 * ama hiçbir yerde `setTheme` çağrılmadığı için erişilemiyordu; bu buton o
 * eksiği kapatır.
 *
 * Hangi ikonun görüneceğini React state'i değil `dark:` varyantı seçiyor:
 * `resolvedTheme` sunucuda bilinmediği için state'e bağlamak ilk render'da
 * hidrasyon uyuşmazlığı üretirdi. Etiket de mod bağımsız ("değiştir"), böylece
 * hidrasyondan önce de doğru okunur.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Temayı değiştir"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  )
}
