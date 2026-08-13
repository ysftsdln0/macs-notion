/**
 * Testler ASLA geliştirme veritabanına yazmamalı.
 *
 * Bu dosya olmadan `pnpm test`, `.env.local`daki `DATABASE_URL`i (yani
 * geliştiricinin `pnpm dev` ile kullandığı `macs` veritabanını) kullanıyordu
 * ve `tests/helpers/reset-db.ts` her testten önce `user.deleteMany()`
 * çağırdığı için gerçek hesapları siliyordu — `Account` ve `Session` satırları
 * FK cascade ile birlikte gidiyordu. Sonuç: geliştirici davet linkiyle giriş
 * yapıp uygulamayı kullanıyor, sonra biri testleri çalıştırınca hesabı yok
 * oluyor ve bir sonraki girişte Auth.js `signIn` callback'i "kullanıcı yok,
 * davet çerezi de yok" diyerek reddediyordu (`AccessDenied` → "hesabın devre
 * dışı bırakılmış ya da geçerli bir davet linkin yok").
 *
 * Çözüm: test süreçleri veritabanı ADINI `_test` ekiyle değiştirir. Aynı
 * Postgres örneği, ayrı veritabanı.
 *
 * Fonksiyon İDEMPOTENT'tir: adı zaten `_test` ile biten bir URL olduğu gibi
 * döner. CI bu sayede dokunulmadan çalışır — orada `DATABASE_URL` zaten
 * `macs_test`e işaret eder ve `prisma migrate deploy` onu hazırlar.
 */
export function testDatabaseUrl(url: string): string {
  const parsed = new URL(url)
  // pathname "/macs" biçiminde; baştaki "/" atılır.
  const name = parsed.pathname.replace(/^\//, '')
  if (name === '' || name.endsWith('_test')) return url
  parsed.pathname = `/${name}_test`
  return parsed.toString()
}

/**
 * `process.env.DATABASE_URL`i test veritabanına çevirir ve sonucu döner.
 * Tanımlı değilse dokunmaz — Prisma'nın kendi hata mesajı daha açıklayıcı.
 */
export function applyTestDatabaseUrl(): string | undefined {
  const current = process.env.DATABASE_URL
  if (!current) return undefined
  const next = testDatabaseUrl(current)
  process.env.DATABASE_URL = next
  return next
}
