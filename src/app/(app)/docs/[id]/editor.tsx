'use client'

import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { withCollaboration } from '@blocknote/core/yjs'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/shadcn/style.css'
import { COLLAB_FRAGMENT_NAME } from '@/lib/doc-search-text'

// İmleç renkleri: kullanıcı kimliğinden deterministik seçilir, böylece aynı
// kişi her oturumda aynı renkle görünür.
const CURSOR_COLORS = ['#e11d48', '#0284c7', '#16a34a', '#c026d3', '#ea580c', '#0d9488']

function colorFor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return CURSOR_COLORS[hash % CURSOR_COLORS.length] as string
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export type EditorProps = {
  documentId: string
  canWrite: boolean
  collabUrl: string
  collabToken: string | null
  initialYdoc: string | null
  currentUser: { id: string; name: string }
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'rejected'

export function Editor({
  documentId, canWrite, collabUrl, collabToken, initialYdoc, currentUser,
}: EditorProps) {
  const [connection, setConnection] = useState<ConnectionState>(
    canWrite ? 'connecting' : 'connected',
  )

  /**
   * Yjs dokümanı provider'a AİT DEĞİL, bu bileşene ait: provider'ı ona
   * bağlıyoruz (`document` seçeneği). Böylece editörün fragment'i ilk
   * render'dan itibaren sabit kalır — provider'ı state'te tutup bağlantı
   * kurulunca editörü yeniden yaratmak gerekmez (ve effect içinde setState
   * çağırmak da gerekmez).
   *
   * Salt-okur yol websocket AÇMAZ (VIEW paylaşımı düzenleme yetkisi
   * değildir): sunucudan gelen ydoc aynı doküman nesnesine uygulanır ve
   * editör `editable={false}` ile aynı kod yolundan render edilir.
   */
  const { ydoc, awareness } = useMemo(() => {
    const doc = new Y.Doc()
    if (!canWrite && initialYdoc) Y.applyUpdate(doc, decodeBase64(initialYdoc))
    // Awareness'ı da BURADA kuruyoruz, provider'dan almıyoruz: aksi halde
    // provider bağlanınca state güncellemek ve editörü yeniden yaratmak
    // gerekirdi. Provider'a hazır awareness verilebiliyor, o yüzden gerekmez.
    return { ydoc: doc, awareness: canWrite ? new Awareness(doc) : null }
  }, [canWrite, initialYdoc])

  useEffect(() => {
    if (!canWrite || !collabToken) return
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: documentId,
      token: collabToken,
      document: ydoc,
      awareness,
      onAuthenticationFailed: () => setConnection('rejected'),
      onStatus: ({ status }) =>
        setConnection(status === 'connected' ? 'connected' : 'connecting'),
      onDisconnect: () => setConnection('disconnected'),
    })
    // destroy() Y.Doc'u yok etmez, yalnızca dinleyicileri söker — bu yüzden
    // StrictMode'un çift mount'u dokümanı bozmaz.
    return () => {
      provider.destroy()
    }
  }, [documentId, canWrite, collabToken, collabUrl, ydoc, awareness])

  const editor = useCreateBlockNote(
    withCollaboration({
      collaboration: {
        fragment: ydoc.getXmlFragment(COLLAB_FRAGMENT_NAME),
        user: { name: currentUser.name, color: colorFor(currentUser.id) },
        ...(awareness ? { provider: { awareness } } : {}),
      },
    }),
    [ydoc, awareness],
  )

  return (
    <div className="space-y-3">
      {canWrite && <ConnectionBanner state={connection} />}
      {!canWrite && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Bu dokümanı yalnızca görüntüleyebilirsin.
        </p>
      )}
      <BlockNoteView editor={editor} editable={canWrite} theme="light" />
    </div>
  )
}

function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null
  const message =
    state === 'rejected'
      ? 'Canlı düzenleme bağlantısı reddedildi. Sayfayı yenile; sorun sürerse yetkin değişmiş olabilir.'
      : state === 'disconnected'
        ? 'Bağlantı koptu, yeniden deneniyor. Bu sırada yazdıkların kaydedilmeyebilir.'
        : 'Canlı düzenlemeye bağlanılıyor…'
  return (
    <p
      className={
        state === 'connecting'
          ? 'rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground'
          : 'rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive'
      }
    >
      {message}
    </p>
  )
}
