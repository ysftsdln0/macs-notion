# MACS Tasarım Briefi — Cesur & Renkli Yeniden Tasarım

> **Durum:** Taslak v1
> **Kapsam:** Tüm site (auth + onboarding + uygulama kabuğu)
> **Tasarım Yönü:** Cesur & renkli (Linear / Stripe estetiği)

---

## 1. Bağlam

MACS, bir öğrenci kulübünün iç koordinasyonu için kullanılan, self-hosted
çalışan Notion-benzeri bir çalışma alanıdır. Üyeler davet linkiyle Google
üzerinden giriş yapar; kanallar, dokümanlar, görevler, etkinlikler ve
sponsorluklar tek çatı altında yönetilir.

**Mevcut durum:** shadcn/ui varsayılan teması — nötr zinc/gri palet, minimal
beyaz sidebar, sade listeler. Fonksiyonel ama kimliksiz; "kendi sunucusunda
yaşayan kulüp aracı" hissini yansıtmıyor.

**Hedef kitle:** Üniversite öğrenci kulübü üyeleri (18–25). Ürünü günlük
kullanan, Slack/Notion/Linear'e alışkın, görsel kaliteye duyarlı bir kitle.

---

## 2. Tasarım Okuması (Design Read)

> Bu, "öğrenci kulübünün iç koordinasyon uygulaması" için, "cesur ve renkli"
> bir dil kullanan, Linear'in sıkı bilgi mimarisi + Stripe'nin canlı renk
> anlayışının birleşimi olan bir **B2B SaaS çalışma alanı estetiği** olarak
> okunuyor. Temel: güçlü tipografi, tek aksan rengi, renkli vurgularla
> süslenmiş nötr zemin.

**Diyaller:**
- Tasarım sapması (variance): **6** — düzenli ızgara, yer yer asimetri
- Hareket yoğunluğu (motion): **5** — akıcı ama sakin; hiçbir şey dans etmez
- Görsel yoğunluk (density): **6** — bilgi yoğun ama ferah

---

## 3. Hedefler

| Hedef | Ölçüt |
|---|---|
| Marka kimliği oluşturmak | "MACS" logosu + tek aksan renk; her sayfada tutarlı |
| Kullanılabilirliği korumak | Mevcut bilgi mimarisi ve içerik yapısı **değişmez** |
| Cesur ama profesyonel | Renk cüreti; okunabilirlikten ve netlikten ödün yok |
| Kurulum hissi | Karanlık modda da aynı marka tanınırlığı |
| Performans | Mevcut LCP/INP hedefleri korunur; görsel işlem maliyeti artmaz |

**Hedef dışı:** Sayfa yapısı, routing, veri modeli ve fonksiyonellik
**değişmez**. Bu salt bir görsel katman işidir.

---

## 4. Tasarım İlkeleri

1. **Tek aksan, tek palet.** Tüm site tek bir aksan renk ailesi kullanır
   (öneri: **turkuaz→yeşil** veya **elektrik mavisi**). Sayfadan sayfaya
   renk geçişi yoktur.
2. **Nötr zemin + renkli vurgu.** Zemin nötr (soğuk gri/neredeyse beyaz), renk
   yalnızca: aktif nav, butonlar, rozetler, boş durum illüstrasyonları ve
   kanal ikonlarında.
3. **Linear disiplini, Stripe canlılığı.** Bilgi mimarisi ve boşluk düzeni
   Linear gibi sıkı; renk kullanımı Stripe gibi iddialı.
4. **Görsel hiyerarşi kontrastla, yalnız boyutla değil.** Tipografi
   ağırlık + renk kontrastıyla hiyerarşi kurar.
5. **Durumlar tasarımın parçasıdır.** Yükleme iskeletleri, boş durumlar ve
   hata durumları da yeni dili konuşur (asla "CSS'siz" kalmaz).
6. **Hareket motivasyonludur.** Animasyon yalnızca hiyerarşi (ne tıklanır),
   geri bildirim (bir şey değişti) veya geçiş (sayfa açılışı) için.

---

## 5. Renk Sistemi

Global değişkenler `src/app/globals.css` içinde shadcn token'ları olarak
güncellenir (mevcut oklch yapısı korunur).

### Palet (uygulanan — koyu lacivert aksan)

Turkuaz/yeşil A seçeneği önerildi ve **reddedildi**; karar ve gerekçe §11'de.
Aksan tek bir `--brand` değişkeninden okunur: `--primary`, `--ring`,
`--chart-1`, `--sidebar-primary` ve `--sidebar-ring` hepsi ona bağlıdır, o
yüzden aksan değişimi her iki tema bloğunda tek satırdır.

> **Revizyon (denetim sonrası):** Tek `--brand` değişkeni iki işi birden
> yapamıyordu. `--brand`'in açıklığı (L 0.1915) `--foreground`'unkiyle
> (L 0.21) neredeyse aynı, **kontrastları 1.04:1** — yani aksan olarak
> kullanıldığı her yerde (aktif nav, link, `text-primary`) "biraz koyu yazı"dan
> başka bir şey okunmuyordu. `bg-primary/10` de renkli bir tint değil gri bir
> yıkamaydı. Koyu modda aksan çalışıyordu, açık modda çalışmıyordu.
>
> Token ikiye ayrıldı, ikisi de aynı lacivert ailesinde:
> - `--brand` → marka işareti (logo kutusu, wordmark noktası)
> - `--primary` → etkileşim aksanı (aktif nav, buton, link, focus, chart-1)
>
> Açık modda `--primary` = `oklch(0.48 0.11 262)` (`#3A5C9B`). Ölçülen
> kontrastlar: buton metni 6.34:1, zemin üstünde 6.34:1, sidebar zemininde
> 6.07:1 (hepsi AA üstü), gövde metninden ayrışma 2.68:1. Koyu modda ayrım
> gereksiz (koyu lacivert o zeminde okunmaz), `--primary` = `var(--brand)`.

| Token | Açık mod | Koyu mod | Kullanım |
|---|---|---|---|
| `--brand` | oklch(0.1915 0.0517 262.2) — `#07132B` lacivert | oklch(0.6541 0.1137 263.6) — `#6C8FD6` | Yalnızca marka işareti |
| `--primary` | oklch(0.48 0.11 262) — `#3A5C9B` | `var(--brand)` | Etkileşim aksanı; `--ring`/`--chart-1`/`--sidebar-*` bunu okur |
| `--background` | oklch(0.985 0.003 240) — soğuk beyaz | oklch(0.155 0.015 240) — mavi-siyah | Sayfa zemini |
| `--foreground` | oklch(0.21 0.02 260) | oklch(0.96 0.008 240) | Ana metin |
| `--card` | oklch(1 0 0) | oklch(0.2 0.018 240) | Kartlar |
| `--primary-foreground` | oklch(0.985 0.002 250) | oklch(0.16 0.03 260) | Aksan üstü metin |
| `--muted` | oklch(0.96 0.006 240) | oklch(0.26 0.018 240) | Hover zemini |
| `--sidebar` | oklch(0.97 0.005 240) | oklch(0.185 0.018 240) | Kenar çubuğu |
| `--ring` | `var(--brand)` | `var(--brand)` | Focus halkası |
| `--radius` | 0.75rem | aynı | Tek radius ölçeği (tutarlılık kilidi) |

### Ayrıca tanımlanacaklar

- `--accent-glow`: aksan renginin %10-15 saydamlıkta "bulanık blob" varyantı
  (boş durumlar ve arka plan vurguları için; gradient **değil**).
- Kanal rozetleri için 5–6 parlak ama doygunluğu <80% tutulmuş yardımcı renk
  (turkuaz, amber, rose, mor, mavi). Yalnızca kanal ikonları ve kategori
  rozetlerinde; birincil eylemlerde asla.
- Chart serisi (`--chart-1..5`) yeni aksan ailesiyle uyumlu hale getirilir.

> **Palet disiplini:** Zeminler soğuk gri tondadır (sıcak bej/krem yasak).
> Aksan asla neon değil; doygunluk <80%.

---

## 6. Tipografi

**Mevcut: Geist Sans + Geist Mono** (`next/font/google`). Geist değiştirilmez
— Linear ailesine yakın, iyi performanslı, halihazırda yüklü.

| Element | Kural |
|---|---|
| H1 (sayfa başlıkları) | `text-2xl` → `font-semibold tracking-tight` |
| Bölüm başlıkları | `text-sm font-medium text-muted-foreground uppercase tracking-wide` — seyrek kullanılır (eyebrow disiplini) |
| Gövde | `text-sm leading-relaxed` |
| Sayılar/veri | `font-mono` (chart, rozet sayaçları, tarihler) |
| Marka | "MACS" wordmark: `font-semibold tracking-tight` + aksan renkli nokta `.` veya yanına ikon |

- **İtalik vurgu kuralı:** Başlık içinde vurgu gerekiyorsa aynı ailenin
  italik/kalın varyantı kullanılır; serif geçişi yok.
- Boyutlar mevcut ölçeğin üstüne çıkmaz (içerik yoğun bir uygulama;
  pazarlama sayfası değil).

---

## 7. Uygulama Kabuğu (Sidebar + Layout)

`src/components/layout/sidebar.tsx` yeniden kurgulanır:

| Öğe | Mevcut | Yeni |
|---|---|---|
| Zemin | `bg-muted/30` (yarı saydam gri) | `bg-sidebar` + ince sağ kenar `border-r` |
| Logo | Düz "MACS" metni | İkon + wordmark; aksan renkli işaret |
| Nav linkleri | Düz metin, hover: muted | **Aktif durum:** aksan tonunda arka plan (`bg-primary/10`) + metin `text-primary font-medium` + 3px sol aksan çubuğu |
| Rozet (okunmamış) | `bg-primary` yuvarlak | Aksan dolgulu, mono sayı, `min-w` ile sabit genişlik |
| Bölüm başlıkları | `uppercase text-muted-foreground` | Aynı ama renk kontrastı artırılmış; aralarına ince ayırıcı `divide-y` değil, `space-y` |
| Kanal satırları | `# ikon` | Emoji/ikon tabanlı `h-5 w-5` kutu + isim; aktif kanal aksan arka plan |
| Genişlik | `w-60` | `w-72` (288px) — renkli kanal kutusu + isim tek satıra sığsın diye (mobilde daraltılabilir panel ayrı iş) |
| Scroll alanı | — | Uzun kanal listeleri için kendi scroll alanı |

**Yeni — üst çubuk (opsiyonel):** İçerik alanı üstünde, sayfa başlığını ve
arama alanını taşıyan ince bir topbar (`h-14`, yarı saydam, scroll'da
`backdrop-blur`). Mevcut sayfa yapısına dokunmadan eklenebilir.

---

## 8. Sayfa Sayfa Tedavi

### 8.1 Auth — `/login`, `/invite/[token]`, onboarding

| Sayfa | Tedavi |
|---|---|
| Login | Split düzen: solda marka paneli (açık zemin üzerinde aksan renkli gradyan blob + wordmark + tek satır değer önerisi), sağda kart içinde Google butonu. Kart: ince border + hafif aksan-tint gölge. Hata mesajları `role="alert"` korunur. |
| Invite | Login ile aynı kabuk; token bilgisi + kulüp adı vurgulu kart. |
| Onboarding | Adım göstergesi (1-2-3), aksan renkli ilerleme çubuğu; her adım kendi ikonlu boş durumunu kullanır. |

> Mobil: split düzen `<md` altında tek kolona düşer; marka paneli üstte
> kompakt versiyon.

### 8.2 Ana sayfa (aktivite akışı)

- "Son hareketler" listesi kartlı yapıdan **ayırıcılı satır listesine**
  (`divide-y`) geçer; her satırda ikonlu eylem rozeti (örn. kanal açıldı,
  üye eklendi) + mono tarih sağda.
- Boş durum: mevcut `EmptyState` bileşeni aksan blob'lu, ikonlu, tek CTA'lı
  kompozisyona yükseltilir.

### 8.3 İçerik sayfaları (docs, tasks, events, sponsors, members, admin, trash, inbox)

Ortak şablon (bir kez uygulanır, tümüne yayılır):

1. **Sayfa başlık bloğu:** H1 + sağ üstte tek birincil CTA (davet et, kanal
   aç, görev oluştur…). CTA tek satıra sığar, etiket ≤3 kelime.
2. **Durum çubukları:** Inbox'ta okunmamış satırlar aksan tonda sol kenar
   çizgisi; events'te geçmiş/gelecek ayrımı rozetlerle.
3. **Tablo/liste:** `divide-y` ince çizgiler; satır hover'da muted zemin;
   yıldızlı/sabitlenmiş öğeler aksan renkte.
4. **Boş durumlar:** hepsi ikon + açıklama + aksiyon ile; örn. "Henüz görev
   yok — ilk görevi oluştur".
5. **Admin/trash:** daha sıkı tipografi (mono sayılar), koyu modda tehlikeli
   eylemler kırmızı-ton korunur (`--destructive` değişmez).

### 8.4 Kanal sayfaları `/c/[slug]`

- Kanal başlığı: ikon + ad + üye sayısı rozeti.
- İçerik alt başlıkları (docs/görev/etkinlik sekmeleri) aksan alt çizgili
  aktif sekme stili alır.

---

## 9. Bileşen Katmanı (`src/components/ui`)

Tüm UI bileşenleri token güncellemesinden geçer; **imza değişiklikleri
olmaz** (kullanım yerleri kırılmaz):

| Bileşen | Değişiklik |
|---|---|
| `button.tsx` | `default` variant: aksan dolgu + `primary-foreground`; hover'da hafif parlaklık (`brightness-110`), `:active`'de `translate-y-[1px]`. Ghost/outline variantları nötr korunur. |
| `card.tsx` | Radius ölçeği aynı; gölge `--card` tonuna tintli, siyah değil. |
| `avatar.tsx` | Aksan-tint zemin + ilk harf; çevresine 1px ring. |
| `badge.tsx` | Ton bazlı variantlar (aksany, nötr, amber…) — mevcut variantlar korunur, renkler yenilenir. |
| `input.tsx` | Focus ring aksan (`--ring`), hata durumu `--destructive` border. |
| `dialog.tsx`, `dropdown-menu.tsx` | Border + popover zemini token'larla güncellenir; davranış değişmez. |
| `skeleton.tsx` | Aksan-tint shimmer (gri yerine `--primary/10` bazlı). |

> **Tutarlılık kilidi:** Tek radius ölçeği (`--radius: 0.75rem`).
> Butonlar 0.75rem, kartlar aynı, rozetler tam yuvarlak — kural her yerde
> aynı uygulanır.

---

## 10. Hareket (Motion)

Seviye: **sıvı CSS + az sayıda giriş animasyonu** (MOTION 5/10).

| An | Uygulama |
|---|---|
| Sayfa başlığı girişi | `opacity 0→1` + `translate-y-2→0`, 0.3s, `cubic-bezier(0.16,1,0.3,1)` |
| Liste satırları | Staggered giriş (delay 30ms/satır) — yalnızca ilk görünümde |
| Nav hover/active | 150ms renk/transform geçişi |
| Rozet değişimi | `scale` pop (durum değişimi geri bildirimi) |
| Scroll tabanlı | **Yok** — bu bir uygulama, vitrin değil |

**Kurallar:** Yalnızca `transform` + `opacity` animasyonu; `prefers-reduced-
motion` altında tümü devre dışı (mevcut `tw-animate-css` + `motion` varsa
oradan; yeni bağımlılık eklenmez).

---

## 11. Açık/Koyu Mod

- Mevcut `next-themes` yapısı korunur; iki mod da **aynı güncellemede**
  tamamlanır.
- Koyu mod zemini saf siyah değil (oklch L 0.16-0.19, mavi-siyah ton).
- Aksan renk koyu modda bir kademe açılır (kontrastı korumak için) — marka
  tanınırlığı kaybolmaz.

> **Uygulama notu:** Denetimde `next-themes`'in hiçbir provider ile
> kurulmadığı görüldü (yalnızca `sonner.tsx` import ediyordu) — `.dark` sınıfı
> hiçbir zaman uygulanmıyor, uygulama fiilen yalnızca açık moddaydı. Uygulama
> sırasında `src/components/theme-provider.tsx` eklendi: `attribute="class"`,
> `disableTransitionOnChange`; kök layout'a bağlandı ve
> `suppressHydrationWarning` eklendi. Varsayılan tema için aşağıdaki karara
> bakın — `defaultTheme="light"`, `enableSystem` kapalı.

> **Karar (kullanıcı onayıyla revize):** Turkuaz aksan reddedildi. Yerine
> koyu lacivert `#07132B` (oklch 0.1915 0.0517 -97.8) kullanıldı; koyu modda
> aksan aynı ailenin açık tonu `#6C8FD6` (oklch 0.6541 0.1137 -96.4) oldu.
> Tema varsayılanı AÇIK (`defaultTheme="light"`, `enableSystem` kapalı).
> Aurora blobları navy ile çakışmasın diye chart renklerine (mavi/rose/amber)
> geçirildi; kanal tint'lerinde turkuaz → mavi. Sidebar `w-60` → `w-72`
> (288px). Animasyonlar yumuşatıldı: fade-up 0.65s (oklch değil, easing
> 0.22,1,0.36,1), pop 0.45s, aurora 28s, shimmer 2.4s, nav geçişleri 200ms.

---

## 12. Erişilebilirlik & Performans Sınırları

- Tüm metin WCAG AA: gövde ≥4.5:1, büyük metin ≥3:1. CTA üzeri metin
  kontrastı her variant için doğrulanır.
- Buton etiketleri tek satır; form etiketleri placeholder değil, input üstünde.
- Focus halkası her etkileşimli öğede (`--ring`, 2px).
- Görsel işlem bütçesi: yeni `backdrop-blur` en fazla 1 eşzamanlı element
  (topbar); gradient arka planlar statik SVG/blob olarak raster değil.
- Yeni bağımlılık **eklenmez**; mevcut kütüphane setiyle (lucide + shadcn +
  tailwind v4) yapılır.

---

## 13. Teslimat Sırası

1. `globals.css` token güncellemesi (açık+koyu) → tüm site anında
   aksan/radius/renk alır
2. Sidebar yenilemesi (aktif durumlar, rozetler, logo)
3. UI bileşenleri (button, badge, card, skeleton, input)
4. Auth sayfaları (login, invite, onboarding)
5. İçerik sayfaları ortak şablonu + boş durumlar
6. Hareket katmanı + `prefers-reduced-motion` kontrolü
7. Doğrulama: `pnpm typecheck`, `pnpm lint`, iki modda görsel kontrol

---

## 14. Açık Sorular

Aksan rengi (§5) ve koyu mod varsayılanı (§11) karara bağlandı. Denetim
turunda 1 ve 3 de kapandı:

1. ~~**Topbar**~~ → **Kapandı.** Masaüstünde topbar eklenmedi (yalın yapı
   korundu); mobilde ise zorunluydu, `h-14` üst çubuk eklendi: hamburger +
   marka + okunmamış sayacı + tema anahtarı.
2. **Kanal ikonları:** Mevcut emoji tabanlı ikonlar kalsın mı (renkli kutu
   arkasında) yoksa ikon kütüphanesine mi geçilsin? — hâlâ açık.
3. ~~**Tema geçişi**~~ → **Kapandı.** `ThemeToggle` eklendi
   (`src/components/layout/theme-toggle.tsx`): masaüstünde sidebar'ın sabit
   alt çubuğunda, mobilde üst çubukta. Hangi ikonun görüneceğini React state'i
   değil `dark:` varyantı seçiyor — `resolvedTheme` sunucuda bilinmediği için
   state'e bağlamak hidrasyon uyuşmazlığı üretirdi.

---

## 15. Denetim Turu (2026-08-13)

§13'ün 1-4 ve 6. adımları uygulanmıştı; 5. adım (içerik sayfaları ortak
şablonu) atlanmıştı. Bu tur onu kapattı ve üç kırık şeyi düzeltti.

**Kırıktı:**
- **Mobilde hiç gezinme yoktu.** `(app)/layout.tsx` sidebar'ı `hidden md:block`
  ile sarıyordu; 768px altında sidebar da, topbar da, hamburger de yoktu.
  Artık `SidebarNav` iki yüzey birden basıyor: masaüstünde sabit sol sütun,
  mobilde üst çubuk + soldan açılan çekmece (aynı `NavBody`).
- **Koyu mod erişilemezdi.** Tokenlar tanımlıydı ama hiçbir yerde `setTheme`
  çağrılmıyordu (§14.3).
- **Açık modda aksan aksan gibi okunmuyordu** (§5'teki revizyon notu).

**Tutarsızdı, tekleştirildi:**
- Sayfa kabuğu: `src/components/layout/page.tsx` → `PageContainer`
  (`narrow` = max-w-3xl, `wide` = max-w-6xl), `PageHeader`, `SectionHeading`.
  Önceden sekiz sayfa `max-w-3xl`, dördü (görevler, etkinlikler, sponsorlar,
  bütçe) konteynersizdi; H1'lerin ikisinde `tracking-tight` vardı, on ikisinde
  yoktu; bölüm başlığının iki ayrı stili vardı.
- Yarıçap ölçeği üç basamağa indirildi (globals.css'teki nota bakın); çıplak
  `rounded` (4px) tamamen kaldırıldı.
- Liste/tablo satırları tek dile geçti: `divide-y` + `bg-card` + `hover:bg-muted/60`,
  tarihler `font-mono`, dar ekranda ikincil üstveri düşer.

**Hareket kısıldı:** `animate-fade-up` 0.65s → 0.4s (her rota değişiminde
oynuyor), ana sayfa satır gecikmesi 40ms → 25ms ve 10 satır → 8 satırda
sabitleniyor.

**Aurora disipline edildi:** Baskın blob artık `--primary` okuyor (önce
`chart-2` mavi + `chart-4` rose + `chart-3` amber idi; giriş ekranının renk
hikâyesi uygulamanınkiyle uyuşmuyordu). `EmptyState`'ten tamamen çıkarıldı —
bir sayfada birden çok boş durum olabiliyor ve her biri iki `blur-3xl`
katmanı + 28sn'lik sonsuz animasyon açıyordu.
