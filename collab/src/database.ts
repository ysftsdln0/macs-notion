import { PrismaClient } from '../generated/prisma/client.js'

const db = new PrismaClient()

/** DocState'ten yükler; documentName = Document.id. */
export async function loadDocumentState(documentName: string): Promise<Uint8Array | null> {
  const state = await db.docState.findUnique({ where: { documentId: documentName } })
  return state ? new Uint8Array(state.ydoc) : null
}

/** DocState'e yazar (upsert). */
export async function storeDocumentState(documentName: string, state: Uint8Array): Promise<void> {
  await db.docState.upsert({
    where: { documentId: documentName },
    create: { documentId: documentName, ydoc: Buffer.from(state) },
    update: { ydoc: Buffer.from(state) },
  })
}
