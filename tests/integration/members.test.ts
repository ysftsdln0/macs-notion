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
      id: user.id, globalRole: user.globalRole, isActive: user.isActive,
      memberships: user.memberships.map((m) => ({ channelId: m.channelId, channelRole: m.channelRole })),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
    }
  },
}))

const { deactivateMember, reactivateMember, updateMemberRole } = await import('@/server/members')

let superadmin: { id: string }
let admin: { id: string }
let target: { id: string }

beforeEach(async () => {
  await resetDb()
  superadmin = await db.user.create({ data: { name: 'Sahip', globalRole: 'SUPERADMIN' } })
  admin = await db.user.create({ data: { name: 'Başkan', globalRole: 'ADMIN' } })
  target = await db.user.create({ data: { name: 'Ayrılan' } })
})

describe('deactivateMember', () => {
  it('üyeyi pasife alır ve tüm oturumlarını siler', async () => {
    await db.session.create({
      data: { sessionToken: 'tok', userId: target.id, expires: new Date(Date.now() + 864e5) },
    })
    actorRef.current = admin.id

    const r = await deactivateMember({ userId: target.id })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.isActive).toBe(false)
    expect(await db.session.count({ where: { userId: target.id } })).toBe(0)
  })

  it('düz üye başkasını pasife alamaz', async () => {
    actorRef.current = target.id
    const r = await deactivateMember({ userId: admin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('admin kendini pasife alamaz', async () => {
    actorRef.current = admin.id
    const r = await deactivateMember({ userId: admin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('pasife alma Activity kaydı bırakır', async () => {
    actorRef.current = admin.id
    await deactivateMember({ userId: target.id })
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('member.deactivated')
    expect(activity.actorId).toBe(admin.id)
    expect(activity.entityId).toBe(target.id)
  })

  it('var olmayan kullanıcı için NOT_FOUND döner', async () => {
    actorRef.current = admin.id
    const r = await deactivateMember({ userId: 'clxxxxxxxxxxxxxxxxxxxxxxx' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  // "Tek diğer admin"i pasifleştirmek çağıranı tek kalan admin yapar. ADMIN
  // havuzu artık korunmuyor (defekt #2: assertActiveSuperadminSurvivesWithout
  // yalnızca SUPERADMIN'i sayar, bkz. "...artık ikisi de başarılı olur"
  // testi) — bu çağrı zaten koşulsuz başarılı olurdu. Burada asıl doğrulanan,
  // kendi kendini pasifleştirme engelinin (bkz. "admin kendini pasife
  // alamaz") çağıranı her zaman hedeften ayrı ve aktif bıraktığı: kalan
  // aktif admin sayısı bu senaryoda 1'e düşer.
  it('tek diğer admin\'i pasifleştirmek, çağıranı tek aktif admin bırakarak başarılı olur', async () => {
    const secondAdmin = await db.user.create({ data: { name: 'İkinci Admin', globalRole: 'ADMIN' } })
    actorRef.current = admin.id

    const r = await deactivateMember({ userId: secondAdmin.id })

    expect(r.ok).toBe(true)
    const remainingActiveAdmins = await db.user.count({ where: { globalRole: 'ADMIN', isActive: true } })
    expect(remainingActiveAdmins).toBe(1)
  })

  // Defekt #2'nin düzeltilmesinin doğrudan sonucu: havuz koruması artık
  // ADMIN'i değil SUPERADMIN'i hedefliyor (bkz. members.ts'teki
  // assertActiveSuperadminSurvivesWithout). ADMIN havuzunun boşalması
  // artık geri alınabilir kabul edilir (SUPERADMIN yeniden atar), bu
  // yüzden iki admin birbirini eş zamanlı pasife alırsa ikisi de başarılı
  // olur — korunacak bir write-skew invariant'ı kalmadı.
  it('iki eş zamanlı deactivateMember isteği aynı iki admin birbirini hedef alırsa artık ikisi de başarılı olur', async () => {
    const secondAdmin = await db.user.create({ data: { name: 'İkinci Admin', globalRole: 'ADMIN' } })

    actorRef.current = admin.id
    const call1 = deactivateMember({ userId: secondAdmin.id })
    actorRef.current = secondAdmin.id
    const call2 = deactivateMember({ userId: admin.id })
    const [r1, r2] = await Promise.all([call1, call2])

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    const remainingActiveAdmins = await db.user.count({ where: { globalRole: 'ADMIN', isActive: true } })
    expect(remainingActiveAdmins).toBe(0)
  })
})

describe('reactivateMember', () => {
  it('pasif üyeyi yeniden etkinleştirir', async () => {
    await db.user.update({ where: { id: target.id }, data: { isActive: false } })
    actorRef.current = admin.id

    const r = await reactivateMember({ userId: target.id })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.isActive).toBe(true)
  })

  it('düz üye başkasını yeniden etkinleştiremez', async () => {
    const bystander = await db.user.create({ data: { name: 'Yoldan Geçen' } })
    await db.user.update({ where: { id: target.id }, data: { isActive: false } })
    actorRef.current = bystander.id

    const r = await reactivateMember({ userId: target.id })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(unchanged.isActive).toBe(false)
  })

  it('var olmayan kullanıcı için NOT_FOUND döner', async () => {
    actorRef.current = admin.id
    const r = await reactivateMember({ userId: 'clxxxxxxxxxxxxxxxxxxxxxxx' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('zaten aktif bir üyeyi etkinleştirmek de başarılı olur (idempotent)', async () => {
    actorRef.current = admin.id
    const r = await reactivateMember({ userId: target.id })
    expect(r.ok).toBe(true)
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(unchanged.isActive).toBe(true)
  })

  it('etkinleştirme Activity kaydı bırakır', async () => {
    await db.user.update({ where: { id: target.id }, data: { isActive: false } })
    actorRef.current = admin.id
    await reactivateMember({ userId: target.id })
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('member.reactivated')
    expect(activity.actorId).toBe(admin.id)
    expect(activity.entityId).toBe(target.id)
  })
})

// Paylaşılan havuz artık SUPERADMIN'dir (bkz. yukarıdaki not): bu race
// deseni ADMIN'de değil SUPERADMIN'de test edilir.
describe('karma yarış: deactivateMember ile updateMemberRole aynı superadmin havuzunu paylaşır', () => {
  it('updateMemberRole(B→MEMBER) ile deactivateMember(A) eş zamanlı çalışırsa en az bir aktif superadmin kalır', async () => {
    const superadminB = await db.user.create({ data: { name: 'B Süper', globalRole: 'SUPERADMIN' } })

    actorRef.current = superadmin.id
    const demoteB = updateMemberRole({ userId: superadminB.id, globalRole: 'MEMBER' })
    actorRef.current = superadminB.id
    const deactivateA = deactivateMember({ userId: superadmin.id })
    const [r1, r2] = await Promise.all([demoteB, deactivateA])

    const successCount = [r1, r2].filter((r) => r.ok).length
    expect(successCount).toBe(1)
    const failedResult = r1.ok ? r2 : r1
    expect(failedResult.ok).toBe(false)
    if (!failedResult.ok) expect(failedResult.error.code).toBe('CONFLICT')

    const remainingActiveSuperadmins = await db.user.count({ where: { globalRole: 'SUPERADMIN', isActive: true } })
    expect(remainingActiveSuperadmins).toBeGreaterThanOrEqual(1)
  })
})

describe('updateMemberRole', () => {
  // Kimin ADMIN olacağına yalnızca SUPERADMIN karar verir (defekt: eskiden
  // düz ADMIN da rol değiştirebiliyordu) — aktör superadmin olmalı.
  it('superadmin bir üyeyi ADMIN yapabilir', async () => {
    actorRef.current = superadmin.id
    const r = await updateMemberRole({ userId: target.id, globalRole: 'ADMIN' })
    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.globalRole).toBe('ADMIN')
  })

  it('düz üye rol değiştiremez', async () => {
    actorRef.current = target.id
    const r = await updateMemberRole({ userId: admin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  // Havuz koruması artık ADMIN'i değil SUPERADMIN'i hedefliyor (defekt #2):
  // updateMemberRole kendi kendini hedef almayı engellemez (deactivateMember
  // aksine), bu yüzden son superadmin kendini MEMBER'a düşürmeyi deneyerek
  // havuzu sıfırlamaya çalışabilir — engellenmesi gereken tam olarak budur.
  it('sistemde tek superadmin varsa kendisi MEMBER\'a düşürülemez', async () => {
    actorRef.current = superadmin.id
    const r = await updateMemberRole({ userId: superadmin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: superadmin.id } })
    expect(unchanged.globalRole).toBe('SUPERADMIN')
  })

  it('ikinci superadmin varken biri MEMBER\'a düşürülebilir', async () => {
    const secondSuperadmin = await db.user.create({ data: { name: 'İkinci Süper', globalRole: 'SUPERADMIN' } })
    actorRef.current = superadmin.id
    const r = await updateMemberRole({ userId: secondSuperadmin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: secondSuperadmin.id } })
    expect(updated.globalRole).toBe('MEMBER')
  })

  // Kalıntı defekt: guard eskiden yalnızca globalRole === 'MEMBER' hedefinde
  // tetikleniyordu — iki değerli dünyada (ADMIN/MEMBER) tek düşürme yolu
  // buydu, üçüncü kademe onu yanlışlamış: SUPERADMIN'den ADMIN'e düşürmek de
  // havuzdan çıkarır ama kontrolsüz geçiyordu. Devir teslim senaryosu
  // ("bir SUPERADMIN diğerini düşürebilir") tam olarak bu yolu kullanıyor,
  // bu yüzden sessiz kalması özellikle tehlikeli.
  it('sistemde tek superadmin varsa kendisi ADMIN\'e düşürülemez', async () => {
    actorRef.current = superadmin.id
    const r = await updateMemberRole({ userId: superadmin.id, globalRole: 'ADMIN' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: superadmin.id } })
    expect(unchanged.globalRole).toBe('SUPERADMIN')
  })

  it('ikinci superadmin varken biri ADMIN\'e düşürülebilir', async () => {
    const secondSuperadmin = await db.user.create({ data: { name: 'İkinci Süper', globalRole: 'SUPERADMIN' } })
    actorRef.current = superadmin.id
    const r = await updateMemberRole({ userId: secondSuperadmin.id, globalRole: 'ADMIN' })
    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: secondSuperadmin.id } })
    expect(updated.globalRole).toBe('ADMIN')
  })

  it('pasif superadmin sayılmaz: tek aktif superadmin kalıyorsa düşürme reddedilir', async () => {
    await db.user.create({ data: { name: 'Pasif Süper', globalRole: 'SUPERADMIN', isActive: false } })
    actorRef.current = superadmin.id
    const r = await updateMemberRole({ userId: superadmin.id, globalRole: 'MEMBER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CONFLICT')
  })

  it('iki eş zamanlı istek aynı iki superadmin birbirini düşürmeye çalışırsa yalnızca biri başarılı olur', async () => {
    const secondSuperadmin = await db.user.create({ data: { name: 'İkinci Süper', globalRole: 'SUPERADMIN' } })
    actorRef.current = superadmin.id

    const [r1, r2] = await Promise.all([
      updateMemberRole({ userId: superadmin.id, globalRole: 'MEMBER' }),
      updateMemberRole({ userId: secondSuperadmin.id, globalRole: 'MEMBER' }),
    ])

    const successCount = [r1, r2].filter((r) => r.ok).length
    expect(successCount).toBe(1)
    const failedResult = r1.ok ? r2 : r1
    expect(failedResult.ok).toBe(false)
    if (!failedResult.ok) expect(failedResult.error.code).toBe('CONFLICT')

    const remainingActiveSuperadmins = await db.user.count({ where: { globalRole: 'SUPERADMIN', isActive: true } })
    expect(remainingActiveSuperadmins).toBeGreaterThanOrEqual(1)
    expect(remainingActiveSuperadmins).toBe(1)
  })

  it('var olmayan kullanıcı için NOT_FOUND döner', async () => {
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: 'clxxxxxxxxxxxxxxxxxxxxxxx', globalRole: 'ADMIN' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('rol değişince Activity kaydı bırakır', async () => {
    actorRef.current = superadmin.id
    await updateMemberRole({ userId: target.id, globalRole: 'ADMIN' })
    const activity = await db.activity.findFirstOrThrow()
    expect(activity.verb).toBe('member.roleChanged')
    expect(activity.actorId).toBe(superadmin.id)
    expect(activity.entityId).toBe(target.id)
  })
})

describe('SUPERADMIN koruması', () => {
  it('ADMIN, SUPERADMIN’i pasife alamaz', async () => {
    actorRef.current = admin.id
    const r = await deactivateMember({ userId: superadmin.id })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  // Sıralı (eş zamanlı olmayan) bir çağrı bu CONFLICT'i asla üretemez:
  // deactivateMember'ın bir SUPERADMIN hedefine dokunabilmesi için çağıranın
  // da aktif bir SUPERADMIN olması ve kendini hedef almaması gerekir (bkz.
  // policy.ts — "sistem sahibine yalnızca sistem sahibi dokunur" +
  // "kimse kendini pasife alamaz"). Yani tek bir çağrıda çağıran her zaman
  // hedeften ayrı ve aktif kalır; "remaining" sayımına kendisi dahil olur
  // ve asla 0'a düşmez. Havuzu gerçekten sıfırlayabilecek tek senaryo, iki
  // aktif SUPERADMIN'in AYNI ANDA birbirini hedef aldığı yarış durumu —
  // updateMemberRole'deki simetriğiyle aynı mantık (bkz. "karma yarış").
  it('son aktif SUPERADMIN pasife alınamaz', async () => {
    const other = await db.user.create({ data: { name: 'İkinci', globalRole: 'SUPERADMIN' } })

    actorRef.current = superadmin.id
    const call1 = deactivateMember({ userId: other.id })
    actorRef.current = other.id
    const call2 = deactivateMember({ userId: superadmin.id })
    const [r1, r2] = await Promise.all([call1, call2])

    const successCount = [r1, r2].filter((r) => r.ok).length
    expect(successCount).toBe(1)
    const failedResult = r1.ok ? r2 : r1
    expect(failedResult.ok).toBe(false)
    if (!failedResult.ok) expect(failedResult.error.code).toBe('CONFLICT')

    const remainingActiveSuperadmins = await db.user.count({
      where: { globalRole: 'SUPERADMIN', isActive: true },
    })
    expect(remainingActiveSuperadmins).toBeGreaterThanOrEqual(1)
  })

  it('bir SUPERADMIN diğerini düşürebilir — devir teslim böyle yapılır', async () => {
    const eskiBaskan = await db.user.create({
      data: { name: 'Eski Başkan', globalRole: 'SUPERADMIN' },
    })
    actorRef.current = superadmin.id

    const r = await updateMemberRole({ userId: eskiBaskan.id, globalRole: 'MEMBER' })

    expect(r.ok).toBe(true)
    const updated = await db.user.findUniqueOrThrow({ where: { id: eskiBaskan.id } })
    expect(updated.globalRole).toBe('MEMBER')
  })

  it('ADMIN global rol değiştiremez', async () => {
    actorRef.current = admin.id
    const r = await updateMemberRole({ userId: target.id, globalRole: 'ADMIN' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN')
  })

  it('MEMBER_MANAGE taşıyan rol düz üyeyi pasife alır, Başkan’a dokunamaz', async () => {
    const role = await db.role.create({
      data: { name: 'İnsan Kaynakları', slug: 'insan-kaynaklari', position: 1,
              permissions: ['MEMBER_MANAGE'] },
    })
    const hr = await db.user.create({ data: { name: 'İK' } })
    await db.userRole.create({ data: { userId: hr.id, roleId: role.id } })
    actorRef.current = hr.id

    expect((await deactivateMember({ userId: target.id })).ok).toBe(true)

    const blocked = await deactivateMember({ userId: admin.id })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe('FORBIDDEN')
  })
})
