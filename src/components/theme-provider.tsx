'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Tema yönetimi. Varsayılan AÇIK temadır (`defaultTheme="light"`,
 * `enableSystem` kapalı) — kullanıcı sistemi koyu olsa bile uygulama açık
 * gelir. `.dark` sınıfı `<html>` üzerinde yönetilir (globals.css'teki
 * `@custom-variant dark` ile eşleşir); koyu moda geçiş istenirse
 * `next-themes`'in `setTheme` API'siyle yapılır.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  )
}
