# A330-243F PMC mühendislik denetimi

Denetim tabanı `feature/pmc-geometry-validator-v1` dalındaki `b65bdbd` commit'idir. Model, ana güvertedeki tek PMC üzerinde dik, ortogonal parçaların araştırma geometrisini değerlendirir. Fiziksel taşıma kapasitesi ve operasyonel uygunluk ayrı mühendislik değerlendirmeleri gerektirir.

## Faz 1 · Matematik ve veri akışı

Avianca çiziminin 4. sayfasında A taban genişliği 92 inçtir. F oku yüksek yatay tavanın sonundan alçak kenara 54 inç, E oku ikinci kırılmadan alçak kenara 18 inç gösterir. Yüksek kenardan kırılmalar 38 ve 74 inçtir. B, C ve D yükseklikleri sırasıyla 96, 72 ve 37 inçtir. Doğrusal parçaların eğimleri 0, −2/3 ve −35/18'dir. Broşürde Contour 1, Avianca'nın yan yana düzenindeki ilk 16 konum için tanımlanır. [Avianca Cargo, A330-200F Contours, s. 4](https://www.aviancacargo.com/downloads/oversize_eng.pdf#page=4)

- Nominal taban 2438,4 × 3175 mm. Araştırma tabanı, her kenarda 85 mm içeride başlar ve 2268,4 × 3005 mm'dir. Yatay datum 34,2 mm, dikey datum 0 mm ve boyuna sabit kesit araştırma varsayımlarıdır.
- Eski motor fiziksel ön-sol başlangıcından cm kullanır. Yerel araştırma koordinatları `u = 10x − 85` ve `v = 10y − 3175p − 85` ile elde edilir. Dış kenar modellenen kesitte normal yönde `34,2 + u + w`, aynada `34,2 + 2268,4 − u` noktasına karşılık gelir. Kullanılan palet sıra numarası sıfırdan başlar.
- Doğrulayıcı, kutunun iki kenarında ve araya düşen her kırılma noktasında çatıyı ölçer. Karşılaştırmada `z + h + dikey datum` kullanılır. Boyut ve çakışma kontrolleri üç eksendeki kutu aralıklarına dayanır. Sıfır paket aralığında temas geçerlidir. Pozitif yatay aralık, dikey içleri örtüşen kutularda X veya Y eksenlerinden en az birinde sağlanmalıdır. Sayısal tolerans varsayılan 0,000001 mm'dir.
- Form ve dosya içe aktarma, yük satırlarını oluşturur. Standard worker satırları sayılara çevirip ZX-11 yerleşimini üretir. AI önerisi ve önceki plan, ayrı ZX-11 kabul kontrolünden geçer. Contour 1 doğrulayıcısı motorlar veya görselleştiricilerden bağımsızdır ve yerleşimi salt okunur veri olarak inceler.
- Arayüz geçerli hesap sonucunu imzasıyla izler. Geometri işaretleri 2D kutu ve 3D yüzlere aynı parça kimliğiyle ulaşır. Eski plan saklaması yük ve ayarları, seçili planı ve sınırlı geçmişi saklar. Uçak aktarımı, şematik uçak listesine ayrı PMC kayıtları üretir. Aktarımda görülen ZX-11 veya Contour 1 sonucu, konuma özel yükleme onayı vermez.
- `PASS` mevcut araştırma geometrisindeki yerleşen parçaların durumudur. Sevkiyatın tüm parçalarının yerleşmesi ayrı bir alandır. Boş plan, eksik izin, kapsam dışı yön, bilinmeyen boyuna profil veya değerlendirilemeyen istif koşulu `UNKNOWN` üretebilir. Bilinen ihlaller `FAIL` önceliğine sahiptir. Operasyon durumu daima `UNKNOWN`.

| Öncelik | Bulgular | Düzeltme |
| --- | --- | --- |
| Yüksek | Formdan gelen metin adet, yerleşim üretildiği halde araştırma aktarımını kesiyordu. | Kaynak satırlarda ondalık sayıları açıkça dönüştür, sonlu ve tam adet koşullarını uygula. |
| Yüksek | Aktarım, bildirilen yatay dönüşü yeniden tahmin ediyor ve çelişkili palet temasını gözden kaçırıyordu. | Varsa bildirilen yönü boyutlarla doğrula. Tek palet teması ile atamayı karşılaştır. Tipi bozuk yerleşim koordinatlarını reddet. |
| Yüksek | Tüm parçaların açıkça yerleşmediği boş girdi, çekirdek API'de doğrulanmış geometri olmadan `PASS` döndürebiliyordu. | Geometri sonucu `UNKNOWN`. Yerleşim tamamlığı, ölçülen geometrinin sonucundan bağımsız. |
| Yüksek | Önceki planı geri yüklerken ham palet sınırı, worker'ın sayısal sonucu üzerine yazılabiliyordu. | Geri yükleme hedef ayarlarını worker ile aynı işlev üzerinden normalleştir. İşlem sırasında eski işaretleri gizle. |
| Orta | Ekrandaki ZX-11, ayrı Contour 1 kontrolünden yalnızca hesap tamamlanınca ayırt edilebiliyordu. 3D çizim aynı ölçüleri ayrı sayısal sabitlerden alıyordu. | Profilleri her sonuç durumunda adlandır. 3D kesiti ortak ZX-11 ölçülerinden çiz. |
| Orta | JSON dışa aktarımı araştırma ayarları ve sonucu içermiyordu. | Mevcut alanları koruyan `geometryValidation` bölümü ekle. |
| Orta | 390 piksel ekranda bir erişilebilirlik etiketi sayfa genişliğini 853 piksele çıkarıyordu. | Etiketi tablonun kendi kaydırma alanıyla sınırla. |

Çakışma kontrolünün palet başına en kötü durumu O(n²). Arayüz 200 parça ile sınırlı. Doğrulayıcının modelleştirdiği dikey aralık veya temas, ezilme dayanımını ya da yük yolu kapasitesini belirlemez. Ağırlık merkezi, zemin ve hat yükü, bağlama, kapı geçişi ve hedef operatör onayı araştırma kapsamı dışındadır.

## Faz 2 · Derleme, gerileme ve karşılaştırma verileri

Node.js 22.23.2, npm 10.9.8. Kilitli kurulum `npm ci --offline` ile 122 paket, 4 saniye. CI taban derlemesi `VITE_BASE_PATH=/boeing-747-cargo-planner/ npm run build` ile 3,36 saniye. Başlangıçtaki `node --test tests/*.test.mjs` 160/160, 16,82 saniye. Vite 500 kB üzeri bazı sıkıştırılmamış paketler için uyarı verdi.

Yeni çekirdek vakaları, boş plan ve tam sevkiyatta hatalı geometriyi, dönüş ve palet ataması çelişkilerini, metin alanlarını ve 240 deterministik sınır örneğini kapsar. Bağımsız çatı fonksiyonu, broşürden elle türetilen üç parça denklemini kullanır.

1440 × 900 tarayıcıda standart yerleşim, datumlar, aralık, `PASS`/`FAIL`/`UNKNOWN`, hata üzerinden parça seçimi, kırmızı SVG kenarları, eski işaretlerin kaybolması, aynalama, sentetik AI önerisi ve standart plana geri dönüş çalıştırıldı. Aynalı JSON'da araştırma modeli de aynalıydı. Uzun yük modunda kapsam uyarısı korundu, seçilen parça X=9,42 cm'den 8,50 cm'ye taşındı. İki örnek PMC, şematik uçak listesine eklendi. 390 × 844 görünümünde sentetik bir CSV satırı onaylanarak iki parça eklendi. AI çağrıları yerel simüle yanıtlarla çalıştırıldı.

Düzeltme sonrası 390 pikselde belge 390 piksel, tablo kaydırıcısı 360 piksel ve iç tablo 860 piksel ölçüldü. Tarayıcı günlüğünde hata veya uyarı görülmedi. Faz 2 kabul derlemesi 3,40 saniye, tam takım 165/165 ve 17,24 saniye, odaklı doğrulama takımı 25/25 ve 0,09 saniye. Kayıtlı yüksek öncelikli doğrulayıcı kusurları giderildi.

### Veri seti 001

Yerel proje dışa aktarımı, 39 ayrı birim, 10 PMC ve 0 mm aralıkta 148,1889 mm en dar dikey açıklık içeriyor. Bağımsız doğrusal hesap aynı açıklığı verdi. Aynı sabit koordinatlar 2,5 ve 2,6 mm aralıkta 49 çift ihlali üretti. Brifingdeki 48,1889, 43,3278 ve 43,1333 mm değerleri başka koordinatlara aittir. Bu koordinatlar ile tam özgün manifesto elde edilemedi. Sonuçlar araştırma aktarımına aittir.

Taban için 8 PMC hem alt sınır hem yapıcı sonuçtur. Her boyut en az 1000 mm olduğundan bir Y kesitinde en fazla iki dikdörtgen bulunur. Y aralıkları iki çakışmasız zincire ayrılabilir. Üçlü zincir yalnızca Y boyu 1000 mm olan üç döndürülmüş parçayı alır. İki üçlü zincir, X genişliği en az 1200 mm olan parçaları yan yana sığdıramaz. Dolayısıyla tabanda palet başına en fazla beş birim vardır. Yedi adet 3+2 düzen ve bir adet 2+2 düzen, 39 birimi dikdörtgen tabanda yerleştirir.

Merkezli Contour 1'de 10 PMC alt sınırı için olası beşli düzen 3+2 olmalıdır. Üçlü zincirdeki her parçanın eni en az 1200 mm'dir. İki yüksek parça Y'de karşılaşırsa toplam enleri en az 2200 mm ve dış kenardaki tavan en çok 1139,3 mm olur. Veri kopyasında 1190 mm'nin altında yalnızca bir parça bulunur. Üçlü zincir boyuna 3000 mm kaplar. Bir alçak parçanın yerinden ve serbest tabandan oluşan toplam boy en fazla 1005 mm olduğundan, ikili zincirdeki iki yüksek parça yüksek bir üçlü parça ile çakışmadan yerleşemez. Alçak parça ikili zincirdeyse kalan yüksek parça, yalnızca 5 mm serbest boyda kalamaz. Palet başına en çok dört birim ve eldeki geçerli 10 PMC düzeni, 0 mm aralıkta araştırma modelindeki asgari değeri doğrular.

### Veri seti 002

Araştırma kayıtlarında 50 paket grubu, 201 iç ürün ve 45.305,5 kg kayıtlı brüt kütle belirtiliyor. Kaynak çalışma kitabı yerel erişilebilir dosyalarda bulunamadı. Kayıt, paket 20/50 için brütün netten düşük olduğunu bildiriyor. Kaynak hücreleri, formül ve önbellek bağımsız doğrulanamadığı için iki kütle de düzeltilmiş kabul edilmedi. Hiyerarşi ve ağırlık tutarlılığı için sentetik grup kullanılmalıdır.

## Faz 3 ve 4 · V2 ve son doğrulama

- `VITE_BASE_PATH=/boeing-747-cargo-planner/ npm run build` başarılı. Vite süresi 3,48 saniye. `node --test tests/*.test.mjs` 173/173 başarılı, 17,48 saniye. `npm run build` yerel önizleme köküyle başarılı, 3,34 saniye. Mevcut paket boyutu uyarısı iki derlemede de görüldü.
- Tarayıcıda 39 parçalı yerel kopya Standart ile açıldı, V2'ye geçildi ve paket aralığı 2,5 mm yapıldı. Ayar değişikliği UNKNOWN, yeniden hesaplama PASS verdi. 2D görünüm dört çatı izdüşümü çizgisi, 3D görünüm Avianca Contour 1 kesiti gösterdi. Sayfa yeniden açıldığında V2, 2,5 mm, 39/39 ve 143,33 mm korundu.
- 1440 × 900 ve 390 × 844 ekranlar kaydedildi. V2'de mobil belge genişliği 390 pikseldi. Doğrulanan senaryoda tarayıcı hatası veya uyarısı görülmedi.
- Yöntemler aynı geometriyle tekrar çalıştırıldı. Birim, palet, açıklık, süre, bellek, kullanım, artık dikdörtgen ve aday sayılarına ilişkin ölçümler [V2 karşılaştırma raporunda](PMC-PACKING-OPTIMIZER-V2.md) yer alır.
