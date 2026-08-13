/**
 * Dekoratif aurora blob'ları. Yalnızca görsel katmandır; `pointer-events-none`.
 * Yavaş süzülme animasyonu CSS'te (`animate-aurora`), reduced-motion'da kapanır.
 *
 * Baskın blob marka aksanını (`--primary`) okur: giriş ekranındaki renk hikâyesi
 * uygulamanınkiyle aynı aileden olsun diye. Destek tonları ondan sapmayacak
 * kadar yakın (chart-2 mavi) ya da yalnızca geniş yüzeyde beliren bir sıcaklık
 * kırıntısı (chart-4 rose).
 *
 * `compact` dar yüzeyler (kart) için üçüncü blob'u hiç basmaz. Sonsuz animasyon
 * + `blur-3xl` pahalı bir çift olduğu için bu bileşen bilinçli olarak sayılıdır:
 * yalnızca auth kabuğunda kullanılır, listelerde/boş durumlarda değil — aksi
 * halde tek sayfada aynı anda dönen birden fazla blur katmanı olurdu.
 */
export function Aurora({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="animate-aurora absolute -top-1/4 -left-1/4 h-[70%] w-[70%] rounded-full bg-primary/25 blur-3xl" />
      <div
        className="animate-aurora absolute -right-1/4 -bottom-1/4 h-[65%] w-[65%] rounded-full bg-chart-2/20 blur-3xl"
        style={{ animationDelay: '-9s' }}
      />
      {variant === 'full' && (
        <div
          className="animate-aurora absolute top-1/3 left-1/2 h-[50%] w-[50%] -translate-x-1/2 rounded-full bg-chart-4/14 blur-3xl"
          style={{ animationDelay: '-17s' }}
        />
      )}
    </div>
  )
}
