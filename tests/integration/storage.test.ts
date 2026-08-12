import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { deleteFile, loadFile, sanitizeFileName, saveFile } from '@/lib/storage'
import { resolveEntityAccess } from '@/server/entity-access'
import { resetDb } from '../helpers/reset-db'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'macs-uploads-'))
  vi.stubEnv('UPLOAD_DIR', dir)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

describe('storage', () => {
  it('yazar, geri okur ve siler', async () => {
    const storagePath = await saveFile(Buffer.from('fiş içeriği'))
    expect(storagePath.startsWith(dir)).toBe(true)
    expect((await loadFile(storagePath))?.toString()).toBe('fiş içeriği')

    await deleteFile(storagePath)
    expect(await loadFile(storagePath)).toBeNull()
    // İkinci silme hata fırlatmaz.
    await expect(deleteFile(storagePath)).resolves.toBeUndefined()
  })

  it('disk yolu dosya adından üretilmez — dizin dışına çıkılamaz', async () => {
    const storagePath = await saveFile(Buffer.from('x'))
    // Yol UUID'den gelir; ad hiç kullanılmaz.
    expect(path.dirname(storagePath)).toBe(dir)
    const files = await readdir(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).not.toContain('..')
  })

  it('olmayan dosya null döner, istisna fırlatmaz', async () => {
    expect(await loadFile(path.join(dir, 'yok'))).toBeNull()
  })

  it('sanitizeFileName yol ve başlık enjeksiyonunu temizler', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    // basename sondaki eğik çizgiyi de atar.
    expect(sanitizeFileName('fis"; rm -rf /')).toBe('fis_; rm -rf')
    expect(sanitizeFileName('satır\nsonu.pdf')).toBe('satır_sonu.pdf')
    expect(sanitizeFileName('   ')).toBe('dosya')
    expect(sanitizeFileName('a'.repeat(400)).length).toBe(200)
  })
})

describe('ek yetkisi bağlı olduğu varlıktan gelir', () => {
  let admin: { id: string }
  let lead: { id: string }
  let member: { id: string }
  let channelId: string

  async function actorOf(id: string) {
    const user = await db.user.findUniqueOrThrow({ where: { id }, include: { memberships: true } })
    return {
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
    }
  }

  beforeEach(async () => {
    await resetDb()
    admin = await db.user.create({ data: { name: 'Admin', globalRole: 'ADMIN' } })
    lead = await db.user.create({ data: { name: 'Lider' } })
    member = await db.user.create({ data: { name: 'Üye' } })
    const channel = await db.channel.create({
      data: {
        name: 'Sponsorluk', slug: 'sponsorluk', visibility: 'OPEN', createdById: lead.id,
        members: {
          create: [
            { userId: lead.id, channelRole: 'LEAD' },
            { userId: member.id, channelRole: 'MEMBER' },
          ],
        },
      },
    })
    channelId = channel.id
  })

  it('bütçe kalemini yalnızca admin ve LEAD okur, yalnızca admin yazar', async () => {
    const entry = await db.budgetEntry.create({
      data: {
        kind: 'EXPENSE', title: 'Baskı', category: 'tanitim',
        amount: '100.00', channelId, createdById: admin.id,
      },
    })

    const forAdmin = await resolveEntityAccess(await actorOf(admin.id), 'BudgetEntry', entry.id)
    expect(forAdmin?.canRead).toBe(true)
    expect(forAdmin?.canWrite).toBe(true)

    const forLead = await resolveEntityAccess(await actorOf(lead.id), 'BudgetEntry', entry.id)
    expect(forLead?.canRead).toBe(true)
    expect(forLead?.canWrite).toBe(false)

    const forMember = await resolveEntityAccess(await actorOf(member.id), 'BudgetEntry', entry.id)
    expect(forMember?.canRead).toBe(false)
    expect(forMember?.canWrite).toBe(false)
  })

  it('sponsoru kanal üyesi okur ve yazar', async () => {
    const sponsor = await db.sponsor.create({
      data: { name: 'ACME', channelId, createdById: lead.id },
    })
    const forMember = await resolveEntityAccess(await actorOf(member.id), 'Sponsor', sponsor.id)
    expect(forMember?.canRead).toBe(true)
    expect(forMember?.canWrite).toBe(true)
    expect(forMember?.title).toBe('ACME')
  })

  it('arşivlenmiş varlık ve bilinmeyen tür null döner', async () => {
    const sponsor = await db.sponsor.create({
      data: { name: 'Eski', channelId, createdById: lead.id, archivedAt: new Date() },
    })
    expect(await resolveEntityAccess(await actorOf(admin.id), 'Sponsor', sponsor.id)).toBeNull()
    expect(await resolveEntityAccess(await actorOf(admin.id), 'Kimlik', sponsor.id)).toBeNull()
  })
})
