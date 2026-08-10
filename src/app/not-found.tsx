import Link from 'next/link'

/**
 * `notFound()` bu uygulamada asıl yetkilendirme reddi mekanizmasıdır:
 * `/c/[slug]`, `/admin`, `/members`, `/channels/new` — hepsi bilinmeyen bir
 * kaynak ile erişimi olmayan bir kaynağı KASITLI OLARAK aynı yanıta
 * indirger (final review I4). Bu sayfa `src/app/` kökünde tek başına durur;
 * proje genelinde başka bir `not-found.tsx` YOKTUR, böylece her `notFound()`
 * çağrısı — nedeni ne olursa olsun — buraya düşer ve aynı Türkçe, aynı
 * belirsiz metni gösterir. Metin bilerek "yok" ile "erişimin yok"u ayırmaz:
 * ayırsaydı, kaynağın var olup olmadığı durum metninden sızardı.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
        <p className="text-sm text-muted-foreground">
          Bu sayfa yok ya da onu görüntüleme yetkin yok.
        </p>
        <Link href="/" className="inline-block text-sm text-primary hover:underline">
          Ana sayfaya dön
        </Link>
      </div>
    </main>
  )
}
