import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Bir kimlikten sabit (deterministik) bir palet girdisi seçer: aynı id her
 * zaman aynı rengi alır, sunucuda ve istemcide aynı sonucu verir. Renk
 * kalıcılığı için DB'ye kolon eklemeye gerek kalmaz.
 */
export function pickByHash<T>(id: string, palette: readonly T[]): T {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]!
}
