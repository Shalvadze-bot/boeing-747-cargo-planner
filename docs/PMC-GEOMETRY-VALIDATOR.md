# PMC Geometry Validator V1 — araştırma prototipi

Bağımsız modül, araştırma geometrisini değerlendirir. Kaynak broşür, Avianca'nın A330-200F Contour 1 kesitini tanımlar. Hedef A330-243F ve operatör için uygulanabilirlik doğrulanmadı. [Avianca Cargo, s. 4](https://www.aviancacargo.com/downloads/oversize_eng.pdf#page=4) · [Nominal PMC ölçüsü](https://www.air-cargo-products.de/pmc-pallet-96-x-125.html)

- Nominal PMC: 3175 × 2438,4 mm; araştırma net tabanı 3005 × 2268,4 mm (her kenarda 85 mm varsayımı).
- Kesit (x,z) inç: (0,0),(0,96),(38,96),(74,72),(92,37),(92,0). Yatay datum: yüksek kenardan 34,2 mm; dikey datum 0 mm varsayımı; y boyunca sabit kesit varsayımı. `mirrored` yüksek kenarı tersine çevirir.
- Girdi: ayrı kimlikli fiziksel birimler (`widthMm,lengthMm,heightMm,allowedOrientations`), yerel kullanılabilir taban koordinatları (`uMm,vMm,zMm`), sıfır tabanlı `palletIndex`, açık `yaw0/yaw90` yönü, yerleşen boyutlar ve `unplacedIds`. Tüm uzunluklar mm. İzinler veri olarak verilmelidir. Üst üste yerleşim destek analizi V1 kapsamı dışındadır.
- `minHorizontalGapMm` dikey izdüşümleri örtüşen paketler için yatay çalışma aralığı; `numericalToleranceMm` sadece sayısal hata (0–0,01 mm), operasyonel tolerans değil.
- `PASS`, ölçülen yerleşen parçaların araştırma geometrisine uyduğunu gösterir. `complete` tüm beklenen parçaların yerleşip yerleşmediğini bildirir. `FAIL` bilinen geometri veya veri kusurunu gösterir. `UNKNOWN` girdi, kapsam veya ölçülecek yerleşim eksikliğini gösterir. `operationalStatus` daima UNKNOWN.
- `fromLegacyPmcPlan(rows,result,model)` fiziksel taban başlangıcından ölçülen cm ve global Y koordinatlarını yerel mm'ye dönüştürür. Metin olarak saklanmış ondalık ölçü ve adetleri açıkça ayrıştırır. Uzun yük ve çoklu pozisyon sonucu bu aktarımın kapsamı dışındadır.

```js
import {makeResearchModel, validatePmcGeometry, fromLegacyPmcPlan} from './src/pmc-geometry-validator.mjs';
const model = makeResearchModel({minHorizontalGapMm: 2.5});
const assessment = validatePmcGeometry(fromLegacyPmcPlan(rows, result, model));
```

Test: `node --test tests/pmc-geometry-validator.test.mjs`. Sentetik örnekler kullanılır; müşteri sevkiyat verisi bu herkese açık depoya eklenmemiştir.

Gerçek net taban, kontur datumları, paket izinleri, clearance, ağırlık merkezi, floor/running load, destek/ezilme dayanımı, restraint ve kapı geçişi için ilgili kontrollü belgeler ve uzman doğrulaması gerekir. Bu modül bir optimizer değildir; palet sayısının optimumluğunu kanıtlamaz.

## Arayüz entegrasyonu (araştırma)

A330-243F PMC planının güncel sonucunda Geometry Validator paneli otomatik çalışır. Standart mod ZX-11 ile yerleştirir ve çizer. Contour 1 kontrolü ayrı çalışır ve 2D ile 3D çizimlerde ihlalleri kırmızı kenarla gösterir. V2 motoru yerleştirme, çizim ve doğrulama için aynı Contour 1 modelini kullanır. Eski, hesaplanan ve geri yüklenen planlarda panel UNKNOWN gösterir ve eski işaretleri kaldırır. Datumlar ve paket aralığı standart modda araştırma kontrolüne, V2'de ise yeniden hesaplamaya girer. JSON dışa aktarımı kullanılan araştırma modeli, ayarlar ve sonucu içerir. [V2 mimarisi ve karşılaştırma](PMC-PACKING-OPTIMIZER-V2.md)

Ek test: `node --test tests/pmc-geometry-integration.test.mjs`.
