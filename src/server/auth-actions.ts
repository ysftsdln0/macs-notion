'use server'

import { signOut } from '@/lib/auth/config'

/**
 * Oturumu kapatır ve login'e yönlendirir. `defineAction` sarmalayıcısı
 * bilerek yok: girdi yok, yetki sorusu yok — oturum sahibi her zaman kendi
 * oturumunu kapatabilir. Auth.js redirect'i exception olarak fırlattığı için
 * dönüş değeri de yoktur.
 */
export async function logout() {
  await signOut({ redirectTo: '/login' })
}
