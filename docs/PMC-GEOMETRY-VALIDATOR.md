# PMC Geometry Validator V1 — araştırma prototipi

Bu bağımsız modül mevcut ZX-11 optimizer'ı veya UI'yı değiştirmez. Uçuş/yükleme onayı vermez. Avianca A330-200F Contour 1, s. 4: https://www.aviancacargo.com/downloads/oversize_eng.pdf#page=4 (operatör broşürü; hedef A330-243F'ye uygulanabilirlik doğrulanmamıştır). PMC nominal ölçüsü: https://www.air-cargo-products.de/pmc-pallet-96-x-125.html.

- Nominal PMC: 3175 × 2438,4 mm; araştırma net tabanı 3005 × 2268,4 mm (her kenarda 85 mm varsayımı).
- Kesit (x,z) inç: (0,0),(0,96),(38,96),(74,72),(92,37),(92,0). Yatay datum: yüksek kenardan 34,2 mm; dikey datum 0 mm varsayımı; y boyunca sabit kesit varsayımı. `mirrored` yüksek kenarı tersine çevirir.
- Girdi: ayrı kimlikli fiziksel birimler (`widthMm,lengthMm,heightMm,allowedOrientations`), yerel kullanılabilir taban koordinatları (`uMm,vMm,zMm`), sıfır tabanlı `palletIndex`, açık `yaw0/yaw90` yönü, yerleşen boyutlar ve `unplacedIds`. Tüm uzunluklar mm. İzinler veri olarak verilmelidir. Üst üste yerleşim destek analizi V1 kapsamı dışındadır.
- `minHorizontalGapMm` dikey izdüşümleri örtüşen paketler için yatay çalışma aralığı; `numericalToleranceMm` sadece sayısal hata (0–0,01 mm), operasyonel tolerans değil.
- `PASS`: verilen araştırma geometrisinde yerleştirilen parçalar geçerli. `complete`: her beklenen parça yerleşmiş; açıkça yerleşmeyenler varsa false. `FAIL`: bilinen ihlal veya hatalı veri. `UNKNOWN`: gerekli veri/izin veya kapsam eksik. `operationalStatus` daima UNKNOWN.
- `fromLegacyPmcPlan(rows,result,model)` mevcut optimizer'ın fiziksel taban başlangıcından ölçülen cm ve global y koordinatlarını yerel mm'ye dönüştürür; uzun yük/çoklu pozisyon aktarımı desteklenmez. Araştırma konturu ve eski ZX-11 farklıdır; eski optimizer sonucu yeni modelde FAIL olabilir. Otomatik UI veya optimizer değişikliği yok.

```js
import {makeResearchModel, validatePmcGeometry, fromLegacyPmcPlan} from './src/pmc-geometry-validator.mjs';
const model = makeResearchModel({minHorizontalGapMm: 2.5});
const assessment = validatePmcGeometry(fromLegacyPmcPlan(rows, result, model));
```

Test: `node --test tests/pmc-geometry-validator.test.mjs`. Sentetik örnekler kullanılır; müşteri sevkiyat verisi bu herkese açık depoya eklenmemiştir.

Gerçek net taban, kontur datumları, paket izinleri, clearance, ağırlık merkezi, floor/running load, destek/ezilme dayanımı, restraint ve kapı geçişi için ilgili kontrollü belgeler ve uzman doğrulaması gerekir. Bu modül bir optimizer değildir; palet sayısının optimumluğunu kanıtlamaz.
