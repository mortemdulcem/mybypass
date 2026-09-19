# Bağımsız Orbita Morfometri

## Amaç
3B BT orbita ölçümlerinden cinsiyet tayini tezine ait bağımsız uygulamayı oluştur. EpiClock, metilasyon, zorlanmış intihar ve lens kalınlığı bu projenin kapsamı dışındadır.

## Uygulama gereksinimleri
- FMS/EC tanıyıcısında kullanıcı yalnız kaynak BT'yi sağlar; FMS, EC, Po/Or veya rim eğrisini elle işaretlemesi istenmez. Kullanıcı tam otomatik aday üretimini açıkça istemiştir. Yarı otomatik/manuel girdi akışı bu hedefin yerine geçirilmemeli; mevcut otomasyonun aday üretememesi kullanıcıya işaretleme işi devredilerek çözülmüş sayılmamalıdır.
- Sade arayüz: büyük döndürülebilir 3B model; bağlantılı aksiyel, koronal, sagittal kesitler; ölçüm ve Excel dışa aktarma paneli.
- Ölçümler gerçek DICOM geometrisi, fiziksel koordinatlar ve tanımlanmış segmentasyona dayanmalı. Kamera, zoom veya sadeleştirilmiş yüzey ölçümü değiştirmemeli.
- Frankfort hizalaması ortak rijit dönüşümle yapılmalı; landmark koordinatları elle eşitlenmemeli.
- Kemik maskesinin hacmi orbital boşluk hacmi olarak raporlanmamalı. İnce duvarları değiştiren threshold/closing işlemleri kontrol edilmeli.
- GLaMM ve PaliGemma 2 birlikte isteniyor. Model sürümleri, çıktıları, fiziksel dönüşümleri ayrı izlenmeli. Uyuşmazlık kullanıcı incelemesine sunulmalı.
- İki modelin anlaşması anatomik doğruluğun kanıtı değildir. Ağırlıklar, görev uyarlaması ve GPU altyapısı doğrulanmadan entegrasyon çalışıyor denmemeli.
- Aynalama yalnızca karşılaştırma içindir; tahmin edilen anatomi gerçek sağ/sol ölçümünün yerine geçmez.
- Çoklu vaka landmark aktarımı için ALPACA protokolü `docs/alpaca-protocol.md` içinde tanımlıdır. ALPACA tahminleri uzman onayı öncesinde doğrulanmış ölçüm sayılmaz; yerel Slicer çalıştırması ve kaynak/çıktı dönüşümleri doğrulanmadan entegrasyon çalışıyor denmemeli.
- Mimics zorunlu bağımlılık değildir. Open3DViewer yalnızca arayüz referansıdır, DICOM ölçüm motoru değildir.

## Literatür ve bilimsel doğruluk
- Kullanıcının belirlediği Skeleton·ID 3B kraniyometrik işaretler kılavuzu (`https://3d-craneometric-landmarks.manual.skeleton-id.com/en`, `/en/v6` kaynakçası dahil) anatomik tanımlar, görseller ve yerleştirme kuralları için projenin uzman başvuru kaynağıdır. Bu kaynak mevcutken “uzman referansı yok” denmemelidir. Kaynakta tanım bulunması ile uygulamanın belirli bir BT'de ürettiği koordinatın doğrulanması ayrı konulardır; eksik olgu-özel etiket veya değerlendirme varsa yalnız bu eksik açıkça adlandırılmalıdır.
- Çalışmanın odağı orbital morfometride **cinsiyet farkıdır**. Anatomik tanımlar literatürden seçilmeli; iki grupta aynı nokta, sınır ve ölçüm protokolü kullanılmalı, beklenen cinsiyet farkına göre maske veya landmark değiştirilmemelidir.
- Literatür tanımları ve mevcut ölçümler arasındaki eşleştirme `docs/cinsiyet-farki-literatur-protokolu.md` içinde belgelenir. Bir tanımın literatürde bulunması, olgudaki koordinatın veya maskenin kendiliğinden anatomik olarak onaylandığı anlamına gelmez.
- Ekli tez taslağı doğrulanmış sonuç veya veri seti değildir. İçindeki örneklem, başarı, AUC ve diğer sayılar gerçek analiz yapılmadan sonuç olarak kullanılmamalı.
- Kaynakça girdileri asıl yayın, DOI veya yayıncı kaydı üzerinden doğrulanmalı. Doğrulanamayan kaynaklar açıkça belirtilmeli; kaynak veya sayısal sonuç uydurulmamalı.
- Ekli AI sohbeti bilimsel kaynak değildir. HTML ölçüm prototipi doğrulanmış DICOM motoru değildir.
- Literatürden alınan yöntem, kullanıcının istediği yöntem ve gerçekten uygulanıp doğrulanan yöntem ayrı belirtilmeli.
- Ölçüm tanımları, anatomik landmarklar, sağ/sol yönleri ve birimler açıkça belgelenmeli; kaynak ve yöntem değişiklikleri izlenebilir olmalı.
- Sağ ve sol aynı anatomik kurallarla fakat kendi görüntü, nokta ve maskeleri üzerinden bağımsız değerlendirilir. Doğal asimetri korunur; iki tarafı eşitlemek için aynalama, koordinat kopyalama veya hedef hacme uydurma yapılmaz. Sağ–sol farkı tek başına hata ölçütü değildir.
- Gerçek gözlemci içi/gözlemciler arası tekrar ölçümleri olmadan ICC üretme; gerçek veriler olmadan sınıflandırma başarısı raporlama.
- Kullanıcı her ölçümün üç bağımsız tekrarının ham değerlerinin saklanmasını, ortalamalarının sonraki grup/bölge analizine girmesini istiyor. Aynı deterministik girdiyi üç kez çalıştırmak bağımsız tekrar değildir. Hasta × taraf × bölge bağımlılığını koruyun; yüzey vertex sayısını hasta örneklem büyüklüğü saymayın.
- Rapor geçmişindeki hasta eşleştirmesi yerel, uygulamanın ürettiği anonim kodlarla açıkça yapılır; farklı seriler kendiliğinden farklı hasta sayılmaz. Eşleme veya geçerli üç tekrar yoksa hasta düzeyinde analiz yapılmaz. Tek grupta sağ–sol sonuçları betimseldir; cinsiyet karşılaştırması veya sınıflandırma başarısı üretilmez.
- Anatomik referans kontrolündeki işaretlemeler yalnızca kaynak okuma/inceleme kaydıdır, uzman anatomik onayı değildir. Güncel görüntü ve maske revizyonuna bağlı kayıt XLSX/JSON raporuna eklenir; görüntü veya maske değiştiğinde eski kayıt kullanılamaz.
- Arka sınır çizim aracı, sağ/sol optik kanal orbital girişi ve üst/alt orbital fissür ağızları için kesit imlecinden gerçek LPS noktalarını kaydeder. Çizimler düzenlenebilir ve taslak olarak aktarılabilir; kapalı kontur geometrisi anatomik onay veya maskeye uygulanmış kapatma değildir. Eski maskelerin posterior-düzlem tanımı yeni protokol diye yeniden etiketlenmez.
- Yetkilendirilmiş maske düzenlemeleri anatomik kabul beklemeden ayrı çalışma kopyasına uygulanabilir. Kaynak/geometri ve açık etiket rolleri korunur; bu yol inceleme durumunu onaylıya çevirmez veya klinik rapor kilidini açmaz. Özgün dosyalar korunur.
- Orbital duvar kalınlığı haritası, dört noktalı rim kalınlığından ayrı bir analizdir. Sağ/sol kavite yüzeyinden fiziksel iç–dış ölçüm çizgileri örneklenir; üst, alt, medial ve lateral duvarlar ayrı özetlenir. En ince/en kalın değerler yalnız geçerli örnekler arasındaki uç değerlerdir; örnekleme kapsamı, konumları ve reddedilen çizgiler saklanır. Açıklıklar, çözünürlük altı ve birden çok kemik aralığı içeren belirsiz geçişler sıfır kalınlık sayılmaz. HU eşik geçişi tek başına toplam anatomik duvarın veya korteks–diploe–korteks sınırlarının doğrulanması değildir; deneysel sonuçlar 11–14 numaralı rim satırlarının yerine geçirilmez.
- Literatür kataloğu eğitim veri seti değildir. Tam metin, özet ve arama alıntısı düzeyindeki incelemeleri ayır; yayın lisansını hasta verisi/model ağırlığı lisansı kabul etme.
- Ölçüm tablosuyla eğitilen MLP/lojistik model, görüntüden öğrenen 3B segmentasyon ağı olarak sunulmamalı. Cinsiyet sınıfları bağımsız çalışma kayıtlarından gelmeli; toplumsal cinsiyet veya kişisel kimlik çıkarımı yapılmamalı.
- Tüm taramalar, sağ/sol ölçümler ve tekrarlar hasta bazında aynı veri bölümünde kalmalı; ölçekleme yalnız eğitimden öğrenilmeli. Test sonucuna göre ayar seçilmemeli. Tek kohorttan ayrılmış test otomatik olarak dış doğrulama değildir.

## Veri güvenliği
- Bu paket hasta arşivi, DICOM, hasta listesi, veritabanı veya kimlik bilgisi içermez.
- Hasta görüntülerini izin almadan dış AI servislerine gönderme. Veriyi public dizinine koyma.
- Sentetik anatomi, demo hasta, uydurma ölçüm veya sahte AI çıktısı kullanma. Gerçek DICOM yüklenmeden görüntü ve ölçüm alanları boş kalmalı. Ölçümler yalnızca yüklenen gerçek veriden, açıkça tanımlanan yöntemlerle hesaplanmalı.
- Mevcut başka projelerin veritabanlarını değiştirme veya otomatik şema gönderme.
- Aktarım arşivleri yalnızca orbita tezine ait kod içermeli. Başka projelerin tablo, rota ve yardımcı modüllerini bu uygulamaya dahil etme. Temizlenmiş eski orbital şema yalnızca referanstır; otomatik migration/push kaynağı değildir.

## Referanslar
- Google Keras örneği: https://github.com/google/generative-ai-docs/blob/main/site/en/gemma/docs/paligemma/inference-with-keras.ipynb
- İstenen PaliGemma kaynağı: kaggle://keras/paligemma2/keras/pali_gemma2_mix_3b_224
- GLaMM altyapı yönergesi: https://github.com/mbzuai-oryx/groundingLMM/blob/main/docs/offline_demo.md
- Kaggle erişimi ve GPU gereksinimleri kurulumdan önce doğrulanmalı. 224×224 giriş orbital anatomik doğruluk kanıtı değildir.
- Sonradan eklenen yerel PDF kaynaklarının bibliyografisi, incelenen sayfaları ve kullanım sınırları `docs/additional-reference-review.md` içindedir. Bu sınırlı kaynak incelemesi hasta analizi veya model eğitimi değildir; ham PDF'ler aktarım paketine dahil edilmez.

## Başlangıç durumu
Bu bir aktarım paketidir, tamamlanmış uygulama değildir. Önce bu gereksinimleri oku, bağımsız uygulamayı oluştur. Ekli manuel HTML prototipini yalnızca referans olarak kullan. Model çalıştırma altyapısı yoksa bunu açıkça belirt; sahte model çıktısı üretme.

## Çalıştırma
- Analiz tabloları kullanıcının 43-parametre Excel düzenini izlemeli ve her yeni hesaplama yerel rapor geçmişinde saklanmalıdır. Tekrar istatistikleri ile hasta grubu istatistikleri ayrılmalı; aynı kaynağın farklı raporları bağımsız hasta sayılmamalıdır. Eksik ölçümler ve yetersiz örneklem açıkça belirtilir.
- Ana kullanıcı akışı DICOM girdisinden NRRD, segmentasyona bağlı STL ve maske JSON üretmektir; kullanıcıdan bu türetilmiş dosyaları önceden hazırlaması beklenmez. Dış maske/landmark içe aktarma isteğe bağlıdır. Kemik adayı orbital kavite veya otomatik anatomik landmark sonucu değildir.
- `npm install` ile bağımlılıkları kurun.
- Yönetilen çalışma alanı, model hesabına bellek bırakmak için `npm run build` ardından `npm run preview` ile çalışır; sunucu `0.0.0.0:5000` üzerinde dinler. Kaynak değişikliklerinden sonra derlemeyi yenileyin. `npm run dev` yalnız geliştirme içindir.
- Üretim derlemesi için `npm run build`, parser/routing testleri için `npm test` kullanın.
- Arayüz boş başlar. DICOM (sıkıştırılmamış Little Endian veya kayıpsız RLE, tek kare/tek fragment, 16-bit MONOCHROME2 CT), kendi başına NRRD/NRDD (raw/gzip, üç boyutlu signed/unsigned/integer/float scalar) ve STL (ASCII/binary) dosyaları yalnızca yerel tarayıcı belleğinde işlenir. ZIP ve RAR arşivleri bounded yerel açma ile desteklenir; bir arşiv birden fazla desteklenen seri/volume/mesh içeriyorsa kullanıcı seçimi zorunludur. ZIP64, encrypted archive, detached NRRD data file ve desteklenmeyen sıkıştırmalar açıkça reddedilir. RAR gerçek libarchive.js WebAssembly worker'ıyla açılır; kabul-only sahte fallback yoktur.
- NRRD `space directions`, `space origin` ve LPS/RAS `space` dönüşümüyle LPS geometriye çevrilir. `space units` yoksa görüntüleme sürer, ancak kullanıcı spacing'in mm olduğunu doğrulayana kadar landmark, mask hacmi ve fiziksel mm ölçümleri kapalıdır. NRRD scalar değerleri HU olarak gösterilmez.
- STL birim ve hasta yönelimi taşımadığından yalnızca döndürülebilir/zoom yapılabilir üçgen yüzey olarak gösterilir; STL'den hacim, HU, kemik veya orbital kavite sonucu çıkarılmaz.

## Yerel otomatik model sınırı
- Ayrı “Tam otomatik FMS / EC” akışı yalnız kaynak BT alır; manuel landmark/rim girişi veya kullanıcıdan checkpoint yüklemesi istemez. Sabit sunucu model dizinindeki altı çıkışlı modelin ağırlıkları ve çalışma bağımlılıkları hazır değilse başlatılmaz; sayısal eski tanıyıcıya sessiz geçiş yapılmaz.
- Bu öğrenilmiş akışın eşit-alan EC ve otomatik bilateral açıklık eksenleri ayrı deneysel protokoldür; Frankfort hizalaması veya standart yarı-yükseklik EC ölçümü diye sunulmaz, standart landmarkları değiştirmez. Adaylar pending kalır; ısı-haritası skoru doğruluk yüzdesi değildir. Ağın EC çıkışıyla geometrik EC'nin uyuşması bağımsız anatomik doğrulama değildir.
- Eğitim/tahmin altyapısının bulunması eğitilmiş FMS/EC ağırlığının veya bağımsız gerçek BT değerlendirmesinin bulunduğu anlamına gelmez. Sağlanan manuel ZIP ve kılavuz görselleri doğrudan eğitim/test doğrusu yapılmaz.
- “Target-CT anatomi adayları” panelindeki tarama, hazır model değil sayısal görüntü kanıtı prototipidir. Açık yerel işleme izniyle başlatılır; ilerleme, iptal ve sonuç indirme aynı oturuma ait `/api/anatomy` servisi üzerinden yürür. Her iş türü için aynı anda en fazla bir aktif iş kabul edilir; model ve anatomi işleri ayrı izlenir.
- Anatomi çıktısı mevcut BT'nin fiziksel geometrisi ve kalibre HU özetiyle yeniden doğrulanmadan kullanılamaz. Kaynak değişimi işi iptal eder ve sonucu geçersiz kılar. Çözümlenmeyen noktalar boş kalır; bulunan adaylar yalnız kullanıcının seçimiyle pending eklenir, mevcut noktayı değiştirmek ayrıca açık karar gerektirir.
- Yerel anatomi iş testi: `node scripts/validate-target-ct-anatomy-job-ui.mjs --authorized-local-medical-data --zip <gerçek-DICOM.zip> --output .local/patient-output/anatomy-job-ui-check`. Gerçek BT bulunmaması başarı sayılmaz; sentetik kontrol, gerçek BT uçtan uca doğrulamasının veya anatomik doğruluk incelemesinin yerine geçmez.
- Dosya açma ve kesit görüntüleme tarayıcıda kalır. Kullanıcı otomatik tespiti açıkça başlattığında DICOM kimlik alanları çıkarılmış HU, geçerlilik maskesi ve geometri yalnız kendi Replit çalışma alanındaki Python işlemine aktarılır. Bu, görüntünün tümüyle anonim olduğunu garanti etmez.
- Model ağırlıkları hasta işlenmeden önce hazır bulunmalı; hasta zamanı dış ağ bağlantıları engellenmeli ve telemetri kapalı olmalıdır. Model çıktıları oturum sahipliğiyle korunur, özel dizinler statik olarak sunulmaz.
- Hazır modelin göz küresi, lens ve optik sinir sınıfları orbital boşluk veya onaylı anatomik landmark değildir. Tahminler deneysel olarak etiketlenir; eksik 43-parametre hesapları tamamlanmış gibi gösterilmez.
- Bu hesap servisi yönetilen çalışma alanı içindir. Herkese açık üretim yayını öncesinde kullanıcı kimlik doğrulaması, yetkilendirme ve hesap kotası ayrıca tasarlanmalıdır.