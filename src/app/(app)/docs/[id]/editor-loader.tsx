'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'
import type { EditorProps } from './editor'

/**
 * BlockNote sunucuda render edilemez: modül yüklenirken `window`'a bakıyor
 * ve SSR sırasında "ReferenceError: window is not defined" fırlatıyor.
 * React bunu istemcide toparladığı için sayfa çalışıyor gibi görünüyordu,
 * ama her istek sunucuda bir hata üretiyordu. Editör bu yüzden
 * `ssr: false` ile yalnızca istemcide yükleniyor.
 *
 * `dynamic(..., { ssr: false })` yalnızca istemci bileşenlerinde
 * kullanılabildiği için bu ince sarmalayıcı gerekiyor — doküman sayfası
 * bir sunucu bileşeni.
 */
const Editor = dynamic(() => import('./editor').then((m) => m.Editor), {
  ssr: false,
  loading: () => (
    <div className="space-y-3">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  ),
})

export function EditorLoader(props: EditorProps) {
  return <Editor {...props} />
}
