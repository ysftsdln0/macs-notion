import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { can } from '@/lib/auth/policy'
import { listVisibleChannels } from '@/server/channels-query'
import { getDocumentTree, type DocumentNode } from '@/server/documents-query'
import { EmptyState } from '@/components/state/empty-state'
import { PageContainer, PageHeader } from '@/components/layout/page'
import { describeDocumentVisibility } from '@/lib/document-labels'
import { CreateDocumentDialog } from './create-document-dialog'
import { DocumentSearchBox } from './search-box'

function DocumentRow({ node, depth }: { node: DocumentNode; depth: number }) {
  return (
    <>
      <li>
        <Link
          href={`/docs/${node.id}`}
          className="flex items-center justify-between gap-3 px-3 py-2 transition-colors duration-150 hover:bg-muted/60"
          // Derinlik girintisi soldaki padding'i devralır; taban değer
          // px-3 ile aynı (0.75rem) olmalı ki kök satırlar hizadan kaymasın.
          style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
        >
          <span className="truncate">
            <span className="mr-1">{node.icon ?? '📄'}</span>
            {node.title || 'Adsız doküman'}
          </span>
          {/* Dar ekranda ikincil üstveri düşer, tarih kalır: üçü birden
              390px'e sığmıyor ve satırı yatayda taşırıyordu. */}
          <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{node.channel.name}</span>
            <span className="hidden sm:inline">
              {describeDocumentVisibility(node.visibility)}
            </span>
            <time className="font-mono">{node.updatedAt.toLocaleDateString('tr-TR')}</time>
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
    <PageContainer>
      <PageHeader
        title="Dokümanlar"
        action={<CreateDocumentDialog channels={writableChannels} parents={flatParents} />}
      />

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
        <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
          {tree.map((node) => (
            <DocumentRow key={node.id} node={node} depth={0} />
          ))}
        </ul>
      )}
    </PageContainer>
  )
}
