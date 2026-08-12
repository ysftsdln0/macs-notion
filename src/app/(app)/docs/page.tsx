import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { getDocumentTree, type DocumentNode } from '@/server/documents-query'
import { EmptyState } from '@/components/state/empty-state'
import { describeDocumentVisibility } from '@/lib/document-labels'
import { CreateDocumentDialog } from './create-document-dialog'
import { DocumentSearchBox } from './search-box'

function DocumentRow({ node, depth }: { node: DocumentNode; depth: number }) {
  return (
    <>
      <li>
        <Link
          href={`/docs/${node.id}`}
          className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-muted"
          style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
        >
          <span className="truncate">
            <span className="mr-1">{node.icon ?? '📄'}</span>
            {node.title || 'Adsız doküman'}
          </span>
          <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <span>{node.channel.name}</span>
            <span>{describeDocumentVisibility(node.visibility)}</span>
            <time>{node.updatedAt.toLocaleDateString('tr-TR')}</time>
          </span>
        </Link>
      </li>
      {node.children.map((child) => (
        <DocumentRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

export default async function DocsPage() {
  const actor = await requireActor()
  const [tree, channels] = await Promise.all([
    getDocumentTree(actor),
    listVisibleChannels(),
  ])

  // Aynı can() kararı — createDocument action'ının authorize'ıyla birebir.
  // Buradaki kullanım salt kolaylıktır; action yetkiyi tekrar denetler.
  const writableChannels = channels
    .filter((c) =>
      can(actor, 'document:create', {
        kind: 'document:new', channelId: c.id, channelVisibility: c.visibility,
      }),
    )
    .map((c) => ({ id: c.id, name: c.name, visibility: c.visibility }))

  const flatParents: { id: string; title: string; channelId: string }[] = []
  const collect = (nodes: DocumentNode[]) => {
    for (const node of nodes) {
      flatParents.push({ id: node.id, title: node.title, channelId: node.channel.id })
      collect(node.children)
    }
  }
  collect(tree)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dokümanlar</h1>
        <CreateDocumentDialog channels={writableChannels} parents={flatParents} />
      </header>

      <DocumentSearchBox />

      {tree.length === 0 ? (
        <EmptyState
          title="Henüz doküman yok"
          description="Kanal altında iç içe sayfalar açarak notlarınızı ortak düzenleyin."
          action={
            <CreateDocumentDialog
              channels={writableChannels}
              parents={flatParents}
              triggerLabel="İlk dokümanı oluştur"
            />
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {tree.map((node) => (
            <DocumentRow key={node.id} node={node} depth={0} />
          ))}
        </ul>
      )}
    </div>
  )
}
