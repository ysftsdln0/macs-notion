import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { listArchivedDocuments } from '@/server/documents-query'
import { EmptyState } from '@/components/state/empty-state'
import { describeDocumentVisibility } from '@/lib/document-labels'
import { TrashRowActions } from './trash-row-actions'

// Bu route'a KASITLI OLARAK loading.tsx eklenmez — admin/page.tsx'teki
// notFound()/Suspense gerekçesinin aynısı geçerli.
export default async function TrashPage() {
  const actor = await requireActor()
  // Çöp kutusu bir admin ekranı: restoreDocument ve
  // permanentlyDeleteDocument action'ları da aynı kararı tekrar uygular.
  if (actor.globalRole !== 'ADMIN') notFound()

  const documents = await listArchivedDocuments()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Çöp kutusu</h1>
        <p className="text-sm text-muted-foreground">
          Arşivlenmiş dokümanlar. Geri yükleyebilir ya da kalıcı olarak silebilirsin.
        </p>
      </header>

      {documents.length === 0 ? (
        <EmptyState
          title="Çöp kutusu boş"
          description="Arşivlenen dokümanlar burada birikir."
        />
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="mr-1">{doc.icon ?? '📄'}</span>
                <span className="truncate">{doc.title || 'Adsız doküman'}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {doc.channel.name} · {describeDocumentVisibility(doc.visibility)}
                  {doc.archivedAt && ` · ${doc.archivedAt.toLocaleDateString('tr-TR')}`}
                </span>
              </span>
              <TrashRowActions documentId={doc.id} title={doc.title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
