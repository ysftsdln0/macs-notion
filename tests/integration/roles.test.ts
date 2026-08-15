import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { resetDb } from '../helpers/reset-db'

const actorRef: { current: string | null } = { current: null }
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getActor: async () => {
    if (!actorRef.current) return null
    const user = await db.user.findUniqueOrThrow({
      where: { id: actorRef.current },
      include: {
        memberships: true,
        roles: { select: { role: { select: { permissions: true } } } },
      },
    })
    return {
      id: user.id,
      globalRole: user.globalRole,
      isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { createRole, updateRole, deleteRole, assignRole, unassignRole } =
  await import('@/server/roles')
const { getActor } = await import('@/lib/auth/session')

let superadmin: { id: string }
let admin: { id: string }
let member: { id: string }

beforeEach(async () => {
  await resetDb()
  superadmin = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  admin = await db.user.create({ data: { name: 'Başkan', globalRole: 'ADMIN' } })
  member = await db.user.create({ data: { name: 'Üye' } })
})

describe('createRole', () => {
  it('SUPERADMIN rol oluşturur, slug üretir, pozisyon verir', async () => {
    actorRef.current = superadmin.id

    const r = await createRole({
      name: 'Proje Koordinatörlüğü',
      color: '#3b82f6',
      permissions: ['CONTENT_READ_ALL'],
    })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    const role = await db.role.findUniqueOrThrow({ where: { id: r.data.id } })
    expect(role.slug).toBe('proje-koordinatorlugu')
    expect(role.permissions).toEqual(['CONTENT_READ_ALL'])
    expect(role.isSystem).toBe(false)
    expect(role.position).toBe(1)
  })

  it('ikinci rol bir sonraki pozisyonu alır', async () => {
    actorRef.current = superadmin.id
    await createRole({ name: 'Bir', color: null, permissions: [] })
    const second = await createRole({ name: 'İki', color: null, permissions: [] })

    expect(second.ok).toBe(true)
    if (!second.ok) return
    const role = await db.role.findUniqueOrThrow({ where: { id: second.data.id } })
    expect(role.position).toBe(2)
  })

  it('ADMIN rol oluşturamaz', async () => {
    actorRef.current = admin.id
    const r = await createRole({ name: 'Deneme', color: null, permissions: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  // Rol yönetimi bir izin DEĞİL: izinleri dağıtan yetki ayarlanabilir olsaydı,
  // onu taşıyan herkes kendine her şeyi yazabilirdi.
  it('her izne sahip bir rol taşıyan üye bile rol oluşturamaz', async () => {
    const godRole = await db.role.create({
      data: {
        name: 'Her Şey', slug: 'her-sey', position: 1,
        permissions: [
          'CONTENT_READ_ALL', 'CONTENT_WRITE_ALL', 'BUDGET_READ_ALL', 'BUDGET_WRITE_ALL',
          'MEMBER_MANAGE', 'INVITE_MANAGE', 'CHANNEL_CREATE', 'CHANNEL_MANAGE_ALL', 'TRASH_MANAGE',
        ],
      },
    })
    await db.userRole.create({ data: { userId: member.id, roleId: godRole.id } })
    actorRef.current = member.id

    const r = await createRole({ name: 'Kendi Rolüm', color: null, permissions: [] })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('aynı adla ikinci rol açılamaz', async () => {
    actorRef.current = superadmin.id
    await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    const r = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('geçersiz renk reddedilir', async () => {
    actorRef.current = superadmin.id
    const r = await createRole({ name: 'Renkli', color: 'mavi', permissions: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })
})

describe('updateRole', () => {
  it('izin listesini ve rengi değiştirir', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const r = await updateRole({
      roleId: created.data.id,
      name: 'Yönetim Kurulu',
      color: '#ef4444',
      permissions: ['CONTENT_READ_ALL', 'BUDGET_READ_ALL'],
    })

    expect(r.ok).toBe(true)
    const role = await db.role.findUniqueOrThrow({ where: { id: created.data.id } })
    expect(role.permissions).toEqual(['CONTENT_READ_ALL', 'BUDGET_READ_ALL'])
    expect(role.color).toBe('#ef4444')
  })

  // Kulübün YK'ya ne verdiğini zamanla değiştirmesi meşru; adı ise kod ve
  // seed tarafından tanınıyor.
  it('sistem rolünün izinleri değiştirilebilir ama adı değiştirilemez', async () => {
    const system = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1, isSystem: true },
    })
    actorRef.current = superadmin.id

    const permissionChange = await updateRole({
      roleId: system.id, name: 'Yönetim Kurulu', color: null,
      permissions: ['CONTENT_READ_ALL'],
    })
    expect(permissionChange.ok).toBe(true)

    const rename = await updateRole({
      roleId: system.id, name: 'Başka Ad', color: null, permissions: ['CONTENT_READ_ALL'],
    })
    expect(rename.ok).toBe(false)
    if (!rename.ok) expect(rename.error.code).toBe('CONFLICT')
  })

  it('olmayan rol NOT_FOUND döner', async () => {
    actorRef.current = superadmin.id
    const r = await updateRole({
      roleId: 'clzzzzzzzzzzzzzzzzzzzzzzz', name: 'Yok', color: null, permissions: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })
})

describe('deleteRole', () => {
  it('rolü ve atamalarını siler', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Geçici', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await assignRole({ userId: member.id, roleId: created.data.id })

    const r = await deleteRole({ roleId: created.data.id })

    expect(r.ok).toBe(true)
    expect(await db.role.count()).toBe(0)
    expect(await db.userRole.count()).toBe(0)
  })

  it('sistem rolü silinemez', async () => {
    const system = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1, isSystem: true },
    })
    actorRef.current = superadmin.id

    const r = await deleteRole({ roleId: system.id })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
    expect(await db.role.count()).toBe(1)
  })
})

describe('assignRole / unassignRole', () => {
  it('rolü atar ve veren kişiyi kaydeder', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const r = await assignRole({ userId: member.id, roleId: created.data.id })

    expect(r.ok).toBe(true)
    const assignment = await db.userRole.findFirstOrThrow({ where: { userId: member.id } })
    expect(assignment.grantedById).toBe(superadmin.id)
  })

  // Arayüzde çift tıklama kullanıcıya kırmızı bir mesaj göstermemeli.
  it('aynı rolü ikinci kez atamak hata vermez', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    await assignRole({ userId: member.id, roleId: created.data.id })
    const second = await assignRole({ userId: member.id, roleId: created.data.id })

    expect(second.ok).toBe(true)
    expect(await db.userRole.count()).toBe(1)
  })

  it('atamayı kaldırır', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await assignRole({ userId: member.id, roleId: created.data.id })

    const r = await unassignRole({ userId: member.id, roleId: created.data.id })

    expect(r.ok).toBe(true)
    expect(await db.userRole.count()).toBe(0)
  })

  it('ADMIN rol atayamaz', async () => {
    const role = await db.role.create({
      data: { name: 'Yönetim Kurulu', slug: 'yonetim-kurulu', position: 1 },
    })
    actorRef.current = admin.id

    const r = await assignRole({ userId: member.id, roleId: role.id })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('olmayan kullanıcıya rol atanamaz', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({ name: 'Yönetim Kurulu', color: null, permissions: [] })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const r = await assignRole({
      userId: 'clzzzzzzzzzzzzzzzzzzzzzzz', roleId: created.data.id,
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })
})

// İzinler token'da taşınmaz, her istekte veritabanından okunur — geri alınan
// bir rol oturum ömrü boyunca geçerli kalmaz.
describe('rol atama sonrası izinler', () => {
  it('rol atanan üye o rolün izinlerini anında kazanır', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({
      name: 'Yönetim Kurulu', color: null, permissions: ['CONTENT_READ_ALL'],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await assignRole({ userId: member.id, roleId: created.data.id })

    actorRef.current = member.id
    const actor = await getActor()

    expect(actor?.permissions).toEqual(['CONTENT_READ_ALL'])
  })

  it('rol geri alınınca izin de anında gider', async () => {
    actorRef.current = superadmin.id
    const created = await createRole({
      name: 'Yönetim Kurulu', color: null, permissions: ['CONTENT_READ_ALL'],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await assignRole({ userId: member.id, roleId: created.data.id })
    await unassignRole({ userId: member.id, roleId: created.data.id })

    actorRef.current = member.id
    const actor = await getActor()

    expect(actor?.permissions).toEqual([])
  })
})
