-- ═══════════════════════════════════════════════════════════════════════════
-- TASARI (PROJE KATMANI) — AŞAMA 2 / DEVİR TESLİM
--
-- ⚠ ÖNCE KODU YAYINA ALIN. Bu dosya, benzersizliği "organizasyon içinde tek"
-- olmaktan çıkarıp "tasarı içinde tek" haline getirir. Eski kısıtlar kalkmadan
-- İKİNCİ BİR TASARI kendi ayarlarını, bina kodlarını veya ekiplerini kaydedemez —
-- çünkü AKKUYU NGS o anahtarları çoktan kullanmıştır.
--
-- SIRA:
--   1) migration_tasari_1.sql çalıştırıldı    (tasari_id sütunları + yeni indeksler)
--   2) Sunucu kodu yayında                     (tasari_id okunuyor ve yazılıyor)
--   3) BU DOSYA                                (eski org-only kısıtlar kalkar)
--
-- BU DOSYA VERİ SİLMEZ. Yalnızca kısıt, indeks ve varsayılan düzeyinde çalışır;
-- tek satır bile eklenmez, çıkarılmaz, değiştirilmez.
--
-- 1. AŞAMA ÇALIŞTIRILMADAN BUNU ÇALIŞTIRMAYIN — aradığı indeksleri bulamaz ve
-- hata verip durur (bilerek: yarım bırakılmış bir kısıt düzeni en kötü sonuçtur).
--
-- ⚠ İLERİDE YENİ BİR TASARI ÖZEL TABLO KURARSANIZ: önce migration_tasari_1.sql'i,
-- sonra bu dosyayı TEKRAR çalıştırın. İkisi de tekrar çalıştırılabilir; devri
-- tamamlanmış tablolara dokunmaz, yenisini yakalar.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. VARLIK TABLOLARI — birincil anahtar (org_id, tasari_id, id) olur
--
--    Bugünkü anahtar (org_id, id). Asıl tehlike YEDEKTEN GERİ YÜKLEME:
--    bir tasarının yedeğindeki id'ler birebir aynıdır, tasarı ayrımı anahtarda
--    yoksa aynı organizasyonun başka bir tasarısına yükleme birincil anahtarı
--    ihlal eder (ya da upsert'te karşı tasarının satırını ezer).
--
--    USING INDEX: 1. aşamada kurulan <tablo>_tas_id_uidx indeksi doğrudan
--    birincil anahtara terfi ettirilir — indeks yeniden kurulmaz, tablo yeniden
--    yazılmaz, işlem anlıktır.
--
--    audit_log LİSTEDE YOK: tasarıya göre filtrelenmediği için anahtarı da
--    değişmez. (org_id, id) anahtarı ve (org_id, created_at, id) indeksi olduğu
--    gibi kalır.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  eski TEXT;
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

    /* ÖNCE "zaten devredilmiş mi" bakılır, sonra indeks aranır. Sıra önemli:
       devir sırasında <tablo>_tas_id_uidx indeksi <tablo>_pkey adına DÖNÜŞÜR,
       yani dosya ikinci kez çalıştırıldığında o adda bir indeks bulunmaz.
       Ters sırada olsaydı, işi bitmiş bir veritabanında "1. aşamayı çalıştırın"
       diye hata verirdi. (migration_org_2.sql ile aynı desen.) */
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p'
        AND array_length(conkey, 1) = 3
    ) THEN
      RAISE NOTICE 'zaten devredilmis: %', t;
      CONTINUE;
    END IF;

    IF to_regclass('public.' || t || '_tas_id_uidx') IS NULL THEN
      RAISE EXCEPTION 'Once migration_tasari_1.sql calistirilmali (eksik indeks: %)', t || '_tas_id_uidx';
    END IF;

    SELECT conname INTO eski FROM pg_constraint
    WHERE conrelid = ('public.' || t)::regclass AND contype = 'p';

    IF eski IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, eski);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
                   t, t || '_pkey', t || '_tas_id_uidx');
    RAISE NOTICE 'birincil anahtar (org_id, tasari_id, id) oldu: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 2. ANAHTAR/DEĞER TABLOLARI — birincil anahtar (org_id, tasari_id, key) olur
--
--    Her tasarının kendi 'katListesi', 'binaGiris', 'tutanakAntet', taslak
--    listesi olacak. Bugünkü PRIMARY KEY (org_id, key) bunu doğrudan engelliyor:
--    ikinci tasarı kendi kat listesini yazamaz, 23505 alır.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  eski TEXT;
  kv TEXT[] := ARRAY['app_settings','saha_settings'];
BEGIN
  FOREACH t IN ARRAY kv LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p' AND array_length(conkey, 1) = 3
    ) THEN
      RAISE NOTICE 'zaten devredilmis: %', t;
      CONTINUE;
    END IF;
    IF to_regclass('public.' || t || '_tas_key_uidx') IS NULL THEN
      RAISE EXCEPTION 'Once migration_tasari_1.sql calistirilmali (eksik indeks: %)', t || '_tas_key_uidx';
    END IF;

    SELECT conname INTO eski FROM pg_constraint
    WHERE conrelid = ('public.' || t)::regclass AND contype = 'p';
    IF eski IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, eski);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
                   t, t || '_pkey', t || '_tas_key_uidx');
    RAISE NOTICE 'birincil anahtar (org_id, tasari_id, key) oldu: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. AD/KOD BENZERSİZLİĞİ — organizasyon geneli olmaktan çıkar
--
--    migration_org_1.sql şu benzersiz İNDEKSLERİ kurmuştu (kısıt değil, indeks):
--      rapor_ekipler_org_name_uidx    (org_id, name)
--      proje_buildings_org_code_uidx  (org_id, code)
--      proje_sections_org_name_uidx   (org_id, name)
--
--    Bunlar kalkmazsa ikinci tasarı kendi '00UYB' binasını AÇAMAZ — o kod
--    AKKUYU NGS'de kullanılmıştır. Yerlerini 1. aşamada kurulan tasarı bazlı
--    indeksler alır (…_tas_code_uidx / …_tas_name_uidx).
--
--    Bu tabloların id birincil anahtarı OLDUĞU GİBİ KALIR.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  i TEXT;
  eskiler TEXT[] := ARRAY[
    'rapor_ekipler_org_name_uidx',
    'proje_buildings_org_code_uidx',
    'proje_sections_org_name_uidx'
  ];
  yeniler TEXT[] := ARRAY[
    'rapor_ekipler_tas_name_uidx',
    'proje_buildings_tas_code_uidx',
    'proje_sections_tas_name_uidx'
  ];
  k INT;
BEGIN
  FOR k IN 1 .. array_length(eskiler, 1) LOOP
    -- Yenisi kurulmadan eskisini DÜŞÜRME: aradaki pencerede hiçbir benzersizlik
    -- kalmaz ve iki aynı bina kodu yazılabilir hale gelirdi.
    IF to_regclass('public.' || yeniler[k]) IS NULL THEN
      RAISE EXCEPTION 'Once migration_tasari_1.sql calistirilmali (eksik indeks: %)', yeniler[k];
    END IF;
    IF to_regclass('public.' || eskiler[k]) IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', eskiler[k]);
      RAISE NOTICE 'org geneli benzersizlik kaldirildi: %', eskiler[k];
    ELSE
      RAISE NOTICE 'zaten kaldirilmis: %', eskiler[k];
    END IF;
  END LOOP;
END $$;

-- Eski org bazlı sıralama indeksleri de gereksizleşti: her sorgu artık tasarıyı
-- da süzüyor, yerlerine …_tas_sort_idx / …_tas_created_idx geçti. Düşürmek yazma
-- maliyetini azaltır; geri istenirse migration_org_1.sql yeniden kurar.
DROP INDEX IF EXISTS public.proje_buildings_org_sort_idx;
DROP INDEX IF EXISTS public.proje_sections_org_sort_idx;
DROP INDEX IF EXISTS public.rapor_ekipler_org_created_idx;

-- Varlık tablolarının org bazlı sayfalama indeksleri de aynı sebeple düşer.
-- audit_log HARİÇ — o hâlâ yalnızca org_id ile sayfalanıyor.
DO $$
DECLARE
  t TEXT;
  varlik TEXT[] := ARRAY[
    'tutanaklar','alet_items','saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_moves','gecici_orders','proje_sartnames','proje_specs',
    'proje_items','proje_orders','proje_alternatives','proje_bina_modelleri',
    'proje_lokasyonlar','gunluk_isler','ihtiyac_listeleri','faturalar'
  ];
BEGIN
  FOREACH t IN ARRAY varlik LOOP
    IF to_regclass('public.' || t || '_org_created_idx') IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', t || '_org_created_idx');
      RAISE NOTICE 'eski sayfalama indeksi dusuruldu: %', t || '_org_created_idx';
    END IF;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4. tasari_id VARSAYILANI DÜŞÜRÜLÜR
--
--    1. aşamada DEFAULT 'akkuyu-ngs' vardı; mevcut satırları tek hamlede
--    doldurmak içindi. Kalıcı bırakılırsa, tasari_id yazmayı unutan bir hata
--    veriyi SESSİZCE AKKUYU NGS'ye doldurur — yani yeni projeye girilen kalem
--    eski projede belirir ve kimse fark etmez. Varsayılan kalkınca aynı hata
--    gürültülü bir NOT NULL ihlaline dönüşür.
--
--    Kod artık her yazmada tasari_id'yi açıkça koyuyor (api/veri.js satırlara
--    zorla yazıyor, api/users.js insert'te veriyor), o yüzden bu güvenlidir.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  hepsi TEXT[] := ARRAY[
    'tutanaklar','alet_items','saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_moves','gecici_orders','proje_sartnames','proje_specs',
    'proje_items','proje_orders','proje_alternatives','proje_bina_modelleri',
    'proje_lokasyonlar','gunluk_isler','ihtiyac_listeleri','faturalar','audit_log',
    'app_settings','saha_settings','rapor_ekipler','proje_buildings','proje_sections',
    'users'
  ];
BEGIN
  FOREACH t IN ARRAY hepsi LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tasari_id DROP DEFAULT', t);
    RAISE NOTICE 'tasari_id varsayilani dusuruldu: %', t;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA
--
-- a) Birincil anahtarlar 3 sütunlu oldu mu? (18 tablo + app_settings +
--    saha_settings = 20 satır dönmeli; audit_log 2 sütunlu KALMALI)
--
--    SELECT conrelid::regclass::text AS tablo, array_length(conkey,1) AS sutun
--    FROM pg_constraint WHERE contype='p'
--      AND connamespace='public'::regnamespace AND array_length(conkey,1)=3
--    ORDER BY 1;
--
-- b) Eski org geneli benzersizlikler kalktı mı? (0 satır dönmeli)
--
--    SELECT indexname FROM pg_indexes WHERE schemaname='public'
--      AND indexname IN ('rapor_ekipler_org_name_uidx',
--                        'proje_buildings_org_code_uidx',
--                        'proje_sections_org_name_uidx');
--
-- c) Varsayılan kalktı mı? (0 satır dönmeli)
--
--    SELECT table_name FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='tasari_id'
--      AND column_default IS NOT NULL;
--
-- d) GERÇEK TEST — ikinci bir tasarı aynı bina kodunu yazabiliyor mu?
--    Uygulamadan yeni bir tasarı açıp AKKUYU NGS'deki bir bina kodunu
--    ('00UYB' gibi) girin. 23505 almıyorsanız devir tamamdır.
-- ═══════════════════════════════════════════════════════════════════════════
