# Kargo Planlayıcı AI önizlemesi

Bu çalışma yerel inceleme içindir. Canlı site, GitHub ve üretim projesi verileri değişmez.

## Yerel deneme

Node.js 22 kullanın. İlk derleme için `npm ci` ve `npm run build` çalıştırın.

- Anahtarsız simülasyon: `npm run preview:ai -- --mock`.
- Gerçek OpenAI testi: `CARGO_AI_PREVIEW_PORT=4179 npm run preview:ai -- --with-key`. Terminal, anahtarı istemeden önce OpenAI ağına erişimi kontrol eder. Anahtar girdisi ekranda gösterilmez ve yalnızca bu sürecin belleğinde kalır.
- Tarayıcıda **AI Deneme Projesi · sentetik**, ardından **PMC · 3D paletleme** bölümünü açın. İlk gerçek çağrıyı mevcut sentetik yüklerle yapın.
- **Önizle** adayın 2D/3D görünümünü açar. **Planı Uygula** son kontrolden geçebilen iyileştirmeyi kaydeder. **Önceki Plana Dön** yerel motorla doğrulama yapar ve OpenAI isteği göndermez.

Sağ alttaki **Kargo Asistanı** penceresi küçültülebilir veya genişletilebilir. Sohbet açık proje oturumunda saklanır. Projeden çıkınca mesajlar temizlenir. PDF, görsel, .xlsx ve CSV dosyaları tarayıcıda okunur. Yük satırları ancak inceleme ve ayrı onaydan sonra PMC listesine eklenir. Sohbet soruları seçilen projenin sınırlı bağlamını OpenAI’a gönderir. Dosyaların kendisi gönderilmez.

Sohbet kartları mevcut motorla hesaplanır ve geçerli, farklı adayları gösterir. Tek PMC denemesi diğer paletlerin yerleşimini korur. Uçak içi yerleşim kartı mevcut şematik uçak motorunu kullanır. Hazır plan araçları ve dosya okuma OpenAI çağrısı gerektirmez.

Yerel çağrı kayıtları `.ai-preview/usage.sqlite` dosyasında toplanır. Anahtar, yük listesi ve e-posta kayıt tablosuna konmaz. Simüle çağrılar ayrı bir kayıt dosyasındadır. Deneme sunucusu yalnızca 127.0.0.1’e bağlanır.

## Sites ortamı

Sunucu tarafında `OPENAI_API_KEY` gizli değişkeni, belgelenmiş bir `OPENAI_MODEL`, iki hesaba kadar `CARGO_AI_ALLOWED_EMAILS` ve `CARGO_AI_LEDGER` SQLite uyumlu D1 bağlaması gerekir. Sites, `drizzle/0001_ai_usage.sql` şemasını yayımlama sırasında uygular. Pilot kullanıcılarını belirlemek ve gerçek API çağrılarını açmak için Sites çalışma zamanı değişkenlerini ayrı yapılandırın. Dosya içe aktarma ve yerel plan araçları anahtar olmadan kullanılabilir.

İnceleme ayarları: `CARGO_AI_MAX_CALLS` (varsayılan 3), `CARGO_AI_MAX_OUTPUT_TOKENS` (350), `CARGO_AI_MAX_INPUT_TOKENS` (16.000, korumacı metin kabul sınırı), `CARGO_AI_TIMEOUT_MS` (12.000), `CARGO_AI_CALLS_PER_HOUR` (24), `CARGO_AI_BUDGET_NANO_USD` (5.000.000.000, yani 5 USD). Fiyatı doğrulanmamış modeller etkinleştirilemez. Kullanım bilgisi döndürmeyen isteklerin ihtiyatlı rezervasyonu kalır. Ayarlar ve anahtar tarayıcıdaki JavaScript’e eklenmez.

AI yalnızca motorun bilinen arama stratejilerini seçer. PMC geometrisi, girilmiş sınırlar ve kilitler ayrı doğrulanır. Uçak içi yeni tahsis, bilinmeyen dayanım ve operasyonel yükleme onayı bu kapsamda hesaplanmaz.
