# Boeing 747-400F Cargo Load Planner

Türkçe, görsel kargo yerleşim simülasyonu. Koyu arayüz, sarı vurgular ve sürükle bırak palet yerleştirme içerir.

**SİMÜLASYON — Uçuş operasyonları için onaylı değildir. Gerçek yükleme için onaylı uçak ve operatör limitleri gerekir.** Uçak çizimi, pozisyonlar ve limitler örnektir; teknik yükleme planı olarak kullanılamaz.

[Çalışan Sites uygulaması](https://cargo-planner-747-taha.jonahshalvadze.chatgpt.site) — mevcut paylaşım izinlerine göre ChatGPT ile giriş gerektirir.

![Uygulama önizlemesi](docs/preview.png)

## Özellikler

- Palet ekleme, sürükleyerek veya tıklayarak pozisyona yerleştirme.
- Ana ve alt güverte görünümü; boyuna yük dağılımı grafiği.
- Pozisyon ağırlığı, ölçü, toplam yük ve bölge yükü kontrolleri.
- Örnek boyuna denge ve sol–sağ yük farkı kontrolleri.
- Palet sabitleme; sabitlenen yükleri koruyan otomatik öneri.
- Mevcut ve önerilen planı karşılaştırma; yerleşemeyen paletlerin nedenlerini gösterme.
- Tarayıcıda yerel kayıt, JSON indirme ve örnek planı sıfırlama.
- Küçük ekranlar için dokunulabilir pozisyon listesi.

Öneri motoru sınırlı genişlikte sezgisel arama kullanır; matematiksel olarak en iyi çözüm garantisi vermez. Uçak boş ağırlığı, yakıt, gerçek ağırlık merkezi zarfı, zemin/bağlama limitleri, tehlikeli maddeler ve operasyonel yükleme sırası modellenmez.

## Yerel çalıştırma

Node.js 22 ve npm gerekir.

```sh
npm ci
npm run dev
```

Terminalde gösterilen yerel adresi açın. Veriler aynı tarayıcının `localStorage` alanında saklanır; ekip üyeleri arasında canlı senkronizasyon yoktur.

## Derleme ve kontroller

```sh
npm run build
node --test tests/engine.test.mjs
npm run test:sites
```

Derleme `dist/client` altında istemci dosyaları, `dist/server/index.js` altında Sites worker dosyası üretir.

## Kaynak yapısı

| Yol | İçerik |
| --- | --- |
| `src/App.jsx` | Arayüz ve etkileşimler |
| `src/engine.mjs` | Örnek profil, yerleşim kontrolleri ve öneri motoru |
| `src/styles.css` | Görsel tasarım ve uyarlanabilir düzen |
| `public/assets/` | Uçak ve palet görselleri |
| `tests/` | Öneri motoru ve Sites worker kontrolleri |
| `worker/` | Sites sunucu giriş noktası |
| `.openai/hosting.json` | Mevcut Sites projesinin kimliği ve yapılandırması |

## Birlikte geliştirme

Değişiklikleri ayrı dallarda hazırlayıp pull request açın. Birleştirmeden önce yukarıdaki derleme ve kontrolleri çalıştırın. Gerçek uçak verisi eklenecekse kaynağı, sürümü ve operatör onayı ayrıca belgelenmelidir.

GitHub'a yapılan değişiklikler Sites uygulamasını otomatik yayımlamaz. Bu depo ilk yayınlanan prototipin kaynak kopyasıdır; güncellenen sürümün Sites'a aktarımı ayrı bir adımdır. `.openai/hosting.json` mevcut projeyi işaret eder; yeni, bağımsız bir Sites uygulaması oluşturulacaksa yeni proje kimliği kullanılmalıdır.
