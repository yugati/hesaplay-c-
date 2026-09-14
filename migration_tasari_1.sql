-- ═══════════════════════════════════════════════════════════════════════════
-- TASARI (PROJE KATMANI) — AŞAMA 1 / EKLEME
--
-- NE YAPAR: Organizasyonun ALTINA ikinci bir katman kurar. İş verisi taşıyan
-- tablolara tasari_id sütunu ekler, mevcut TÜM veriyi 'akkuyu-ngs' tasarısına
-- atar, tasarilar tablosunu kurar ve tasarı bazlı benzersizlik indekslerini AÇAR.
--
-- NE YAPMAZ: Hiçbir şeyi silmez, hiçbir mevcut kısıtı kaldırmaz, hiçbir satırın
-- data alanını değiştirmez. Bu dosya ÇALIŞTIRILDIKTAN SONRA uygulama bugünkü
-- kodla HİÇBİR DEĞİŞİKLİK OLMADAN çalışmaya devam eder — sütun eklenmiştir ama
-- kimse ona bakmaz, varsayılanı 'akkuyu-ngs' olduğu için yeni kayıtlar da doğru
-- yere düşer. Bu bilinçli: sunucu kodu henüz tasarı filtresi uygulamıyor ve bu
-- dosyanın çalıştırılmasıyla kodun yayına alınması arasındaki pencerede sistem
-- sağlam kalmalı. (migration_org_1.sql ile birebir aynı strateji.)
--
-- SIRA:
--   1) BU DOSYA  -> Supabase SQL Editor'da çalıştırılır (şimdi)
--   2) Sunucu + istemci kodu yayına alınır (tasari_id artık okunur/yazılır)
--   3) migration_tasari_2.sql -> anahtar (org_id, tasari_id, id)'ye devredilir,
--      eski org-only benzersizlik kısıtları kaldırılır, varsayılan düşürülür
--
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- ───────────────────────────────────────────────────────────────────────────
-- HANGİ TABLO HANGİ KATMANDA (alınan karar: "kütüphane ortak, iş verisi ayrı")
--
--   ORGANİZASYON GENELİ — tasari_id ALMAZ, tüm tasarılar aynı satırları görür:
--     companies         Şirket/tedarikçi listesi   (sipariş + tutanak antedi)
--     proje_materials   Malzeme künyesi            (stok kodu = kimlik)
--     alet_lib          Alet künyesi
--     gecici_lib        Geçici elektrik künyesi
--     users             Kullanıcılar
--   Gerekçe: bunlar KATALOGDUR, iş kaydı değil. Aynı malzeme her projede aynı
--   stok kodunu taşır; her tasarıda 696 künyeyi yeniden girmek kataloğun varlık
--   sebebini ortadan kaldırırdı.
--
--   TASARI ÖZEL — tasari_id alır, her tasarı kendi satırlarını görür:
--     şartname, şartname kalemi, sipariş, sipariş satırı, alternatif,
--     bina, bölüm, bina modeli, lokasyon, saha, rapor, ekip, tutanak,
--     günlük iş, ihtiyaç listesi, fatura, alet demirbaşı, geçici hareket,
--     app_settings, saha_settings
--
--   AYRIK DURUM — audit_log:
--     tasari_id sütununu ALIR ve yazılırken DAMGALANIR, ama okunurken
--     FİLTRELENMEZ. Denetim kaydı organizasyon düzeyinde bir güvenlik
--     defteridir: yöneticinin "kim ne yaptı" sorusunun cevabı, olayın hangi
--     projede geçtiğine göre bölünmemeli. Damga yine de yazılır ki kaydı
--     okuyan kişi olayın hangi tasarıda geçtiğini görebilsin.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. TASARILAR — organizasyonun proje listesi
--
--    organizations ile aynı desen (id + data), tek farkı org_id taşıması:
--    tasarı her zaman BİR organizasyona aittir. Anahtar (org_id, id) — iki
--    farklı organizasyon aynı tasarı kimliğini kullanabilir, birbirlerini
--    görmezler.
--
--    DİKKAT: bu tablo da organizations gibi BİLEREK /api/veri beyaz listesine
--    girmeyecek. Oradan erişilebilseydi herhangi bir kullanıcı kendini başka
--    bir tasarıya taşıyabilir ya da tasarı uydurabilirdi.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasarilar (
  org_id      TEXT        NOT NULL,
  id          TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}',
  aktif       BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, id)
);

DROP TRIGGER IF EXISTS tasarilar_updated_at ON public.tasarilar;
CREATE TRIGGER tasarilar_updated_at BEFORE UPDATE ON public.tasarilar
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Kapı kapalı doğsun: anon/authenticated bu tabloyu hiç görmez
-- (asama3_anon_kapat.sql ile aynı kural). service_role RLS'i atladığı için
-- /api/* erişimi etkilenmez.
ALTER TABLE public.tasarilar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tasarilar FROM anon, authenticated;

-- BUGÜNKÜ TEK PROJE. Mevcut tüm iş verisinin sahibi budur.
INSERT INTO public.tasarilar (org_id, id, data)
VALUES ('bykara', 'akkuyu-ngs', '{"ad":"AKKUYU NGS"}'::jsonb)
ON CONFLICT (org_id, id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 2. tasari_id SÜTUNU — yalnızca İŞ VERİSİ tablolarına
--
--    NOT NULL DEFAULT 'akkuyu-ngs': mevcut satırların hepsi tek hamlede
--    AKKUYU NGS'ye yazılır. PostgreSQL 11+ bu işlemi tabloyu yeniden yazmadan
--    yapar, 1207 satırlık proje_items'ta da 6389 satırlık audit_log'da da anlıktır.
--
--    Varsayılan GEÇİCİDİR. Aşama 2'de düşürülecek: kalıcı bir varsayılan,
--    tasari_id yazmayı unutan bir hatanın veriyi sessizce AKKUYU NGS'ye
--    doldurması demektir. Kod her zaman açıkça yazmaya başladığında varsayılan gider.
--
--    LİSTEDE OLMAYAN TABLOLAR (companies, proje_materials, alet_lib, gecici_lib,
--    users) BİLEREK YOKTUR — yukarıdaki katman tablosuna bakın. Buraya eklemek,
--    malzeme kütüphanesini her projede sıfırlamak demektir.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  -- id + data desenindeki TASARI ÖZEL varlık tabloları
  -- (api/veri.js TASARI_TABLOLARI ile aynı liste — iki taraf birlikte değişir)
  varlik TEXT[] := ARRAY[
    'tutanaklar','alet_items',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_moves','gecici_orders',
    'proje_sartnames','proje_specs','proje_items',
    'proje_orders','proje_alternatives','proje_bina_modelleri','proje_lokasyonlar',
    'gunluk_isler','ihtiyac_listeleri','faturalar',
    'audit_log'   -- damgalanır ama filtrelenmez (bkz. başlıktaki ayrık durum)
  ];
  -- anahtar/değer ve basit liste tabloları (api/veri.js DIGER_TABLOLAR'ın tasarı özel olanları)
  diger TEXT[] := ARRAY['app_settings','saha_settings','rapor_ekipler','proje_buildings','proje_sections'];
BEGIN
  FOREACH t IN ARRAY (varlik || diger) LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tasari_id TEXT NOT NULL DEFAULT %L', t, 'akkuyu-ngs');
    RAISE NOTICE 'tasari_id eklendi: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. MEVCUT VERİYİ AKKUYU NGS'YE TAŞI
--
--    Yukarıdaki DEFAULT zaten tüm mevcut satırları 'akkuyu-ngs' yapar; bu blok
--    dosyayı İKİNCİ kez çalıştıranlar ve sütunu elle eklemiş olanlar için
--    güvenlik ağıdır. Boş/NULL kalmış hiçbir satır bırakmaz.
--
--    org_id <> 'bykara' olan satır bugün YOK (tek kiracı). İleride başka bir
--    organizasyon eklenirse bu UPDATE onun verisine DOKUNMAZ — kendi tasarısını
--    kendi kurar.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  n BIGINT;
  toplam BIGINT := 0;
  hepsi TEXT[] := ARRAY[
    'tutanaklar','alet_items','saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_moves','gecici_orders','proje_sartnames','proje_specs',
    'proje_items','proje_orders','proje_alternatives','proje_bina_modelleri',
    'proje_lokasyonlar','gunluk_isler','ihtiyac_listeleri','faturalar','audit_log',
    'app_settings','saha_settings','rapor_ekipler','proje_buildings','proje_sections'
  ];
BEGIN
  FOREACH t IN ARRAY hepsi LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '  atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;
    -- Bosta kalmis satirlari yakala (sutun elle, varsayilansiz eklenmisse)
    EXECUTE format(
      'UPDATE public.%I SET tasari_id = %L WHERE org_id = %L AND (tasari_id IS NULL OR tasari_id = %L)',
      t, 'akkuyu-ngs', 'bykara', ''
    );
    /* SONUCU RAPORLA. Yukaridaki UPDATE normalde 0 satir dondurur - sutunun
       DEFAULT'u mevcut satirlarin hepsini zaten AKKUYU NGS yapmistir. Bu yuzden
       "kac satir guncellendi" yerine "su an kac satir AKKUYU NGS'de" yaziyoruz:
       aksi halde dosyayi calistiran kisi bastan asagi 0 gorup hicbir seyin
       tasinmadigini sanirdi. Beklenen degerler (canli olcum, 14 Eylul 2026):
       proje_items 1207, rapor_entries 1093, proje_specs 846, audit_log 6389. */
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tasari_id = %L', t, 'akkuyu-ngs') INTO n;
    toplam := toplam + n;
    RAISE NOTICE '  AKKUYU NGS: % satir  <- %', lpad(n::text, 6), t;
  END LOOP;
  RAISE NOTICE '────────────────────────────────────';
  RAISE NOTICE '  AKKUYU NGS tasarisinda TOPLAM % satir', toplam;
  RAISE NOTICE '  (kutuphane haric: companies / proje_materials / alet_lib / gecici_lib';
  RAISE NOTICE '   organizasyon genelinde ortak kaldi, tasariya baglanmadi)';
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4. TASARI BAZLI BENZERSİZLİK — varlık tabloları
--
--    Bugünkü anahtar (org_id, id). Bu, iki tasarının aynı id'yi üretmesi
--    durumunda upsert'in KARŞI TASARININ satırını ezmesi demek (id üreteci
--    index.html uid() — zaman damgası + rastgele karakter; çakışma ihtimali
--    düşük ama sonucu sessiz veri bozulması). Asıl tehlike YEDEKTEN GERİ
--    YÜKLEME: aynı id'ler birebir aynıdır, tasarı ayrımı anahtarda yoksa
--    A projesinin yedeği B'ye yüklenirken birincil anahtarı ihlal eder.
--
--    Doğru anahtar (org_id, tasari_id, id). Burada YALNIZCA ekleniyor; eski
--    (org_id, id) birincil anahtarı Aşama 2'de kaldırılıp yerini bu alacak.
--    İkisi bir arada durabilir.
--
--    Ayrıca (org_id, tasari_id, created_at, id) indeksi: artımlı yükleme tam
--    olarak bu sırayla sayfalıyor (src/supabase.js sbGetAll). Tasarı filtresi
--    eklendiğinde bu indeks olmasa her açılış tam tablo taramasına dönerdi.
--
--    audit_log LİSTEDE YOK: okurken tasarıya göre filtrelenmiyor, dolayısıyla
--    tasarılı indekse ihtiyacı da yok. Onun (org_id, created_at, id) indeksi
--    olduğu gibi kalır ve çalışmaya devam eder.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  varlik TEXT[] := ARRAY[
    'tutanaklar','alet_items',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_moves','gecici_orders',
    'proje_sartnames','proje_specs','proje_items',
    'proje_orders','proje_alternatives','proje_bina_modelleri','proje_lokasyonlar',
    'gunluk_isler','ihtiyac_listeleri','faturalar'
  ];
BEGIN
  FOREACH t IN ARRAY varlik LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (org_id, tasari_id, id)',
                   t || '_tas_id_uidx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id, tasari_id, created_at, id)',
                   t || '_tas_created_idx', t);
    RAISE NOTICE 'indeksler kuruldu: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 5. TASARI BAZLI BENZERSİZLİK — anahtar/ad taşıyan tablolar
--
--    Çakışması KESİN olanlar bunlar. Bugün proje_buildings üzerinde
--    (org_id, code) benzersiz: ikinci tasarı kendi '00UYB' binasını AÇAMAZ,
--    çünkü o kod ilk tasarıda kullanılmış. Aynısı her tasarının kendi
--    'katListesi' ayarı, kendi 'Ekip 1' kaydı, kendi bölüm adları için geçerli.
--
--    Bu, yapının en kritik noktasıdır: kod tarafı tasarı filtresi uygulasa bile
--    bu indeksler kurulmadan ikinci tasarı BOŞ KALMAYA mahkûmdur — yazma
--    denemeleri 23505 ile geri döner.
--
--    Eski org-only kısıtlar Aşama 2'de kaldırılır; bunlar o zaman devralır.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_tas_key_uidx     ON public.app_settings     (org_id, tasari_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS saha_settings_tas_key_uidx    ON public.saha_settings    (org_id, tasari_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS rapor_ekipler_tas_name_uidx   ON public.rapor_ekipler    (org_id, tasari_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS proje_buildings_tas_code_uidx ON public.proje_buildings  (org_id, tasari_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS proje_sections_tas_name_uidx  ON public.proje_sections   (org_id, tasari_id, name);

-- Bina ve bölüm listeleri sort_order ile sıralı çekiliyor (src/supabase.js SIRA_BINA)
CREATE INDEX IF NOT EXISTS proje_buildings_tas_sort_idx  ON public.proje_buildings (org_id, tasari_id, sort_order);
CREATE INDEX IF NOT EXISTS proje_sections_tas_sort_idx   ON public.proje_sections  (org_id, tasari_id, sort_order);
CREATE INDEX IF NOT EXISTS rapor_ekipler_tas_created_idx ON public.rapor_ekipler   (org_id, tasari_id, created_at);


-- ─────────────────────────────────────────────────────────────
-- 6. KULLANICILAR — varsayılan tasarı
--
--    tasari_id: kullanıcı giriş yaptığında HANGİ tasarıda açılacağı. Bir
--    "kilit" DEĞİL, bir başlangıç noktası: alınan karara göre organizasyondaki
--    HERKES tasarılar arasında geçebilir (organizasyon değiştirmenin aksine —
--    o süper yöneticiye özel kalır).
--
--    Neden users.sections gibi bir yetki listesi değil? Çünkü tasarı seçimi bir
--    gezinti hareketidir, bir yetki sınırı değil. Modül yetkileri (sections /
--    permissions) olduğu gibi çalışmaya devam eder ve her tasarıda aynı şekilde
--    uygulanır: rapor yetkisi olmayan kişi hiçbir tasarıda rapor göremez.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasari_id TEXT NOT NULL DEFAULT 'akkuyu-ngs';

CREATE INDEX IF NOT EXISTS users_tasari_idx ON public.users (org_id, tasari_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA — aşağıdakileri çalıştırıp sonuçları kontrol edin.
--
-- a) tasari_id sütunu kaç tabloya eklendi? (users dahil 25 beklenir)
--
--    SELECT count(*) FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='tasari_id';
--
-- b) AKKUYU NGS dışında kalan satır var mı? (hepsi 0 dönmeli)
--
--    SELECT 'proje_items' t, count(*) FROM public.proje_items  WHERE tasari_id <> 'akkuyu-ngs'
--    UNION ALL SELECT 'proje_specs',  count(*) FROM public.proje_specs   WHERE tasari_id <> 'akkuyu-ngs'
--    UNION ALL SELECT 'rapor_entries',count(*) FROM public.rapor_entries WHERE tasari_id <> 'akkuyu-ngs'
--    UNION ALL SELECT 'app_settings', count(*) FROM public.app_settings  WHERE tasari_id <> 'akkuyu-ngs'
--    UNION ALL SELECT 'users',        count(*) FROM public.users         WHERE tasari_id <> 'akkuyu-ngs';
--
-- c) Taşınan satır sayıları beklenen mi? (ölçülen canlı değerlerle karşılaştırın:
--    proje_items 1207, rapor_entries 1093, proje_specs 846, audit_log 6389)
--
--    SELECT 'proje_items' t, count(*) FROM public.proje_items  WHERE tasari_id = 'akkuyu-ngs'
--    UNION ALL SELECT 'rapor_entries',count(*) FROM public.rapor_entries WHERE tasari_id = 'akkuyu-ngs'
--    UNION ALL SELECT 'proje_specs',  count(*) FROM public.proje_specs   WHERE tasari_id = 'akkuyu-ngs'
--    UNION ALL SELECT 'audit_log',    count(*) FROM public.audit_log     WHERE tasari_id = 'akkuyu-ngs';
--
-- d) KÜTÜPHANE DOKUNULMAMIŞ OLMALI — bu sorgu HATA vermeli ("column does not
--    exist"). Hata vermiyorsa kütüphane yanlışlıkla tasarıya bağlanmış demektir:
--
--    SELECT tasari_id FROM public.proje_materials LIMIT 1;
--
-- e) Tasarı kaydı yerinde mi?
--
--    SELECT * FROM public.tasarilar;
-- ═══════════════════════════════════════════════════════════════════════════
