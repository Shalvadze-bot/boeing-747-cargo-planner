# A330-243F PMC Packing Optimizer V2

## Mimari

**Standart · ZX-11** ve **V2 · Avianca Contour 1** aynı yük listesini, yatay yön izinlerini ve fiziksel PMC tabanını kullanır. Arayüz seçili yöntemi, çizilen profilin adını, hesap süresini ve bağımsız doğrulama sonucunu gösterir. Standart yöntem mevcut uzun yük, manuel taşıma, istif ve AI karşılaştırması akışlarını sürdürür. V2 dik, tek kat, ortogonal ve taşmasız araştırma yerleşimi üretir.

1. `runContourPacking` cm cinsinden yükleri ve adetleri doğrular, mm cinsinden tekil parçaları üretir ve yatay yön adaylarını açık izinle sınırlar. Ağırlık verilmediğinde bilinmiyor olarak saklanır.
2. `researchModelFor`, sürümlü Contour 1 modelini palet sınırı, ayna yönü, datumlar, sayısal tolerans ve çalışma aralığıyla kurar. Yerleşim boyunca aynı model kullanılır.
3. `placementRange`, parçanın gerçek yüksekliğinden izinli X aralığını ters çatı hesabıyla çıkarır. Adaylar boş dikdörtgenlerin uç noktalarında konumlanır ve sığma ile açıklık açısından puanlanır. Bir parça yerleştirildiğinde etrafındaki aralık dahil engel, boş dikdörtgenleri en fazla dört şeride böler. İç içe alanlar elenir.
4. Her kabul edilecek yerel aday bağımsız doğrulayıcının ileri çatı, konum, izin ve çakışma hesabından geçer. Her karşılaştırılan nihai plan baştan kontrol edilir. FAIL sonuçları elenir. UNKNOWN, eksik veri veya ölçülecek yerleşim olmadığını bildirir.
5. Dört deterministik sıralama, son üç paleti yeniden paketleme turu ve en dar açıklığı yükseltmeye yönelik ek turlar kullanılır. Aynı girdi ve aday bütçesi aynı koordinatları üretir. Süre bütçesi etkinse makine hızı kısmi sonucun kapsamını etkileyebilir.
6. Öncelikler yerleşen parça sayısı, PMC sayısı, en dar dikey açıklık ve paletler genelinde en büyük artık dikdörtgenlerin toplam alanıdır. Bireysel sığmama veya taban alanı alt sınırı tam sevkiyatın imkânsızlığını kanıtlayabilir. Aramanın sonuç bulamaması, aday sınırı, süre sınırı ve eksik girdi ayrı durumlar olarak raporlanır.

Worker, sayısal hesapları arayüz iş parçacığı dışında yürütür. V2'nin varsayılan aday sınırı 120.000, tarayıcı hesap süresi sınırı 25 saniyedir. Sonuç, fiziksel cm koordinatlarına bir kez dönüştürülür. 2D çatı izdüşümü ve 3D kesit, sonuçtaki aynı araştırma modelinden hesaplanır. Girdiler değiştiğinde önceki çizim kendi profiliyle gösterilir ve doğrulama UNKNOWN olur. V2 kayıtları güncel model ve palet üyeliğiyle yeniden kontrol edilerek açılır. JSON'da motor sonucu, geometrik model ve doğrulama durumu yer alır.

## Karşılaştırma

Darwin arm64, Node.js 22.23.2. Her senaryo iki ısınma ve dokuz ölçüm. Aynı Contour 1 kesiti, 34,2 mm yatay datum, 0 mm dikey datum, açık yatay izinler, tek kat, senaryo başına aynı palet sınırı ve motor başına 120.000 aday üst sınırı kullanıldı. Standart motorun karşılaştırma çalıştırması, ZX-11 yerine aynı araştırma çatısını ve paket aralığını kullanır. İlk uygun adayı seçme ve mevcut sıralama yöntemi korunur. Uygulamadaki Standart seçeneği ZX-11'i kullanır.

| Veri | Aralık (mm) | Yerleşim / PMC | En dar açıklık (mm), standart → V2 | Medyan süre (ms), standart → V2 | Bağımsız kontrol |
| --- | ---: | ---: | ---: | ---: | --- |
| Alan alt sınırı kanıtlı sentetik | 5 | 5/5 · 2 | 112,9111 → 112,9111 | 0,532 → 1,205 | İkisi PASS |
| Sentetik ağır paket grupları | 2,5 | 50/50 · 11 | 97,7722 → 107,9111 | 22,458 → 10,523 | İkisi PASS |
| 39 parçalı yerel proje kopyası | 0 | 39/39 · 10 | 23,7444 → 148,1889 | 10,457 → 6,171 | İkisi PASS |
| 39 parçalı yerel proje kopyası | 2,5 | 39/39 · 10 | 18,8833 → 143,3278 | 9,500 → 6,130 | İkisi PASS |
| 39 parçalı yerel proje kopyası | 2,6 | 39/39 · 10 | 18,6889 → 143,1333 | 8,836 → 6,027 | İkisi PASS |

| Ölçüm | Standart | V2 |
| --- | ---: | ---: |
| 39 parça, 2,5 mm · taban ve hacim kullanımı | %69,82 · %44,78 | %69,82 · %44,78 |
| 39 parça, 2,5 mm · en büyük artık dikdörtgenlerin toplamı | 13,65 m² | 12,94 m² |
| 39 parça, 2,5 mm · üretilen aday / reddedilen aday | 12.784 / 12.667 | 2.855 / 0 |
| Ağır sentetik, 2,5 mm · taban ve hacim kullanımı | %74,49 · %38,43 | %74,49 · %38,43 |
| Ağır sentetik, 2,5 mm · en büyük artık dikdörtgenlerin toplamı | 12,93 m² | 10,31 m² |
| Ağır sentetik, 2,5 mm · üretilen aday / reddedilen aday | 34.335 / 34.185 | 4.798 / 0 |
| 39 parça, 2,5 mm · medyan heap artışı | 1.841 KiB | 5.260 KiB |
| Ayrı Node süreçlerinde tepe RSS | 78.128 KiB | 73.280 KiB |

Her motor dokuz ölçümde aynı koordinatları üretti. V2, uygun aralığı aday üretmeden önce daraltır. Bu ön eleme reddedilen aday sayacına dahil değildir. Heap artışı ölçüm öncesi ve sonrası farktır. RSS, ilgili motor sürecinin tüm senaryolardaki tepesidir. Küçük örnekte ek arama süreyi artırdı. 39 parçalık örnekte açıklık için ayrılan yer, ölçülen en büyük boş alanı düşürdü. Bu ölçümler genel performans veya optimumluk garantisi vermez.

Sentetik ağır sette 50 taşıma paketi ve 201 iç ürün vardır. Geometriye 50 paket gönderildi. Bir sentetik brüt-net uyuşmazlığı karantinaya alındı ve ilgili paketin ağırlığı bilinmiyor olarak işlendi. Özgün ağır yük tablosu, 39 parçalık özgün manifesto ve brifingde belirtilen referans koordinatları eldeki kaynaklarda yoktu. [Veri ve matematik denetimi](PMC-ENGINEERING-AUDIT.md)

```sh
node scripts/benchmark-pmc.mjs
node scripts/benchmark-pmc.mjs --project /yerel/proje-kopyasi.json --runs 9 --candidate-limit 120000
```

Karşılaştırma aracı, özel proje dosyasını belirtilen yerel konumdan okur ve yalnızca toplu sonuçları yazar. Ayrıntılı parça satırları ve koordinatlar depo dışında tutulur.
