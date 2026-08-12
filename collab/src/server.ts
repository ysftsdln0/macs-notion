import { Server } from '@hocuspocus/server'
import { Logger } from '@hocuspocus/extension-logger'
import * as Y from 'yjs'
import { PrismaClient } from '../generated/prisma/client.js'
import { loadDocumentState, storeDocumentState } from './database.js'
import { authorizeDocument } from './authorize-document.ts'
import { extractTextFromYDoc } from '../../src/lib/doc-search-text.ts'

const db = new PrismaClient()

const server = Server.configure({
  port: Number(process.env.PORT ?? 1234),
  extensions: [new Logger()],

  async onAuthenticate({ token, documentName }) {
    const auth = await authorizeDocument(token, documentName)
    if (!auth.ok) {
      const reason =
        auth.reason === 'session' ? 'Oturum geçersiz'
        : auth.reason === 'document' ? 'Doküman bulunamadı'
        : 'Bu dokümanı düzenleme yetkin yok'
      throw new Error(reason)
    }
    return { actorId: auth.actorId }
  },

  async onLoadDocument({ documentName }) {
    return loadDocumentState(documentName)
  },

  async onStoreDocument({ documentName, document }) {
    // document artık tam yüklü Y.Doc — hem kalıcılık hem metin çıkarma ondan yapılır.
    const state = Y.encodeStateAsUpdate(document)
    await storeDocumentState(documentName, state)
    const text = extractTextFromYDoc(document)
    await db.document.update({
      where: { id: documentName },
      data: { searchText: text, updatedAt: new Date() },
    })
  },
})

server.listen()
console.log(`collab listening on :${process.env.PORT ?? 1234}`)
