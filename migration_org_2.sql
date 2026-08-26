-- ═══════════════════════════════════════════════════════════════════════════
-- ORGANİZASYON (ÇOK KİRACILI YAPI) — AŞAMA 2 / DEVİR TESLİM
--
-- ⚠ ÖNCE KODU YAYINA ALIN. Bu dosya, benzersizliği "tüm sistemde tek" olmaktan
-- çıkarıp "organizasyon içinde tek" haline getirir. Eski kısıtlar kalkmadan
-- İKİNCİ BİR ORGANİZASYON kendi ayarlarını, bina kodlarını veya ekiplerini
-- kaydedemez — çünkü ilk organizasyon o anahtarları çoktan kullanmıştır.
--
-- SIRA:
--   1) migration_org_1.sql çalıştırıldı           (org_id sütunları + yeni indeksler)
--   2) Sunucu kodu yayında                        (org_id okunuyor ve yazılıyor)
--   3) BU DOSYA                                   (eski global kısıtlar kalkar)
--
-- BU DOSYA VERİ SİLMEZ. Yalnızca kısıt ve varsayılan düzeyinde çalışır; tek satır
-- bile eklenmez, çıkarılmaz, değiştirilmez.
--
-- 1. AŞAMA ÇALIŞTIRILMADAN BUNU ÇALIŞTIRMAYIN — aradığı indeksleri bulamaz ve
-- hata verip durur (bilerek: yarım bırakılmış bir kısıt düzeni en kötü sonuçtur).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. VARLIK TABLOLARI — birincil anahtar (org_id, id) olur
--
--    Bugün anahtar tek başına id. İki organizasyonun aynı id'yi üretmesi
--    durumunda upsert karşı tarafın satırını ezerdi (index.html uid()).
--
--    USING INDEX: 1. aşamada kurulan <tablo>_org_id_uidx indeksi doğrudan
--    birincil anahtara terfi ettirilir — indeks yeniden kurulmaz, tablo
--    yeniden yazılmaz, işlem büyük tablolarda da anlıktır.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  eski TEXT;
  varlik TEXT[] := ARRAY[
    'companies','tutanaklar','alet_items','alet_lib',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_lib','gecici_moves','gecici_orders',
    'proje_sartnames','proje_materials','proje_specs','proje_items',
    'proje_orders','proje_alternatives','proje_bina_modelleri','proje_lokasyonlar',
    'gunluk_isler','ihtiyac_listeleri','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY varlik LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;

    /* ÖNCE "zaten devredilmiş mi" bakılır, sonra indeks aranır. Sıra önemli:
       devir sırasında <tablo>_org_id_uidx indeksi <tablo>_pkey adına DÖNÜŞÜR,
       yani dosya ikinci kez çalıştırıldığında o adda bir indeks bulunmaz.
       Ters sırada olsaydı, işi bitmiş bir veritabanında "1. aşamayı çalıştırın"
       diye hata verirdi. */
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p'
        AND array_length(conkey, 1) = 2
    ) THEN
      RAISE NOTICE 'zaten devredilmis: %', t;
      CONTINUE;
    END IF;

    -- 1. aşama çalıştırılmamışsa burada durulur; yarım iş bırakmaktansa hata verir.
    IF to_regclass('public.' || t || '_org_id_uidx') IS NULL THEN
      RAISE EXCEPTION 'Once migration_org_1.sql calistirilmali (eksik indeks: %)', t || '_org_id_uidx';
    END IF;

    SELECT conname INTO eski FROM pg_constraint
    WHERE conrelid = ('public.' || t)::regclass AND contype = 'p';

    IF eski IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, eski);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
                   t, t || '_pkey', t || '_org_id_uidx');
    RAISE NOTICE 'birincil anahtar (org_id, id) oldu: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 2. ANAHTAR/DEĞER TABLOLARI — birincil anahtar (org_id, key) olur
--
--    Her organizasyonun kendi 'binaGiris', 'tutanakAntet', kat listesi vb.
--    ayarı olacak. Bugünkü PRIMARY KEY(key) bunu doğrudan engelliyor.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  eski TEXT;
  kv TEXT[] := ARRAY['app_settings','saha_settings'];
BEGIN
  FOREACH t IN ARRAY kv LOOP
    -- Sıra 1. bölümdeki gibi: önce devir kontrolü, sonra indeks kontrolü
    -- (indeks devirde <tablo>_pkey adına dönüşür).
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p' AND array_length(conkey, 1) = 2
    ) THEN
      RAISE NOTICE 'zaten devredilmis: %', t;
      CONTINUE;
    END IF;
    IF to_regclass('public.' || t || '_org_key_uidx') IS NULL THEN
      RAISE EXCEPTION 'Once migration_org_1.sql calistirilmali (eksik indeks: %)', t || '_org_key_uidx';
    END IF;

    SELECT conname INTO eski FROM pg_constraint
    WHERE conrelid = ('public.' || t)::regclass AND contype = 'p';
    IF eski IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, eski);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
                   t, t || '_pkey', t || '_org_key_uidx');
    RAISE NOTICE 'birincil anahtar (org_id, key) oldu: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. AD/KOD BENZERSİZLİĞİ — global olmaktan çıkar
--
--    rapor_ekipler.name, proje_buildings.code, proje_sections.name bugün TÜM
--    SİSTEMDE benzersiz. İki şirketin de '00UYB' binası ya da 'Ekip 1'i olamaz.
--    Bu tabloların id (UUID) birincil anahtarı OLDUĞU GİBİ KALIR; kalkan yalnızca
--    tek sütunluk global UNIQUE kısıtı. Yerine 1. aşamada kurulan org bazlı
--    benzersiz indeksler geçer.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tablo, c.conname AS ad
    FROM pg_constraint c
    WHERE c.contype = 'u'
      AND c.conrelid IN (
        'public.rapor_ekipler'::regclass,
        'public.proje_buildings'::regclass,
        'public.proje_sections'::regclass
      )
      AND array_length(c.conkey, 1) = 1   -- yalnizca TEK SUTUNLU (global) olanlar
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tablo, r.ad);
    RAISE NOTICE 'global benzersizlik kaldirildi: % / %', r.tablo, r.ad;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4. org_id VARSAYILANI DÜŞÜRÜLÜR
--
--    1. aşamada DEFAULT 'bykara' vardı; mevcut satırları tek hamlede doldurmak
--    içindi. Kalıcı bırakılırsa, org_id yazmayı unutan bir hata veriyi SESSİZCE
--    BYKARA'ya doldurur. Varsayılan kalkınca aynı hata gürültülü bir NOT NULL
--    ihlaline dönüşür — yani fark edilir.
--
--    Kod artık her yazmada org_id'yi açıkça koyuyor (api/veri.js: satırlara zorla
--    yazılıyor; api/users.js: insert'te veriliyor), o yüzden bu güvenlidir.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  hepsi TEXT[] := ARRAY[
    'companies','tutanaklar','alet_items','alet_lib',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_lib','gecici_moves','gecici_orders',
    'proje_sartnames','proje_materials','proje_specs','proje_items',
    'proje_orders','proje_alternatives','proje_bina_modelleri','proje_lokasyonlar',
    'gunluk_isler','ihtiyac_listeleri','audit_log',
    'app_settings','saha_settings','rapor_ekipler','proje_buildings','proje_sections',
    'users'
  ];
BEGIN
  FOREACH t IN ARRAY hepsi LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id DROP DEFAULT', t);
  END LOOP;
  RAISE NOTICE 'org_id varsayilanlari dusuruldu';
END $$;


-- ─────────────────────────────────────────────────────────────
-- 5. 3D MODEL KOVASI KAPATILIR  ← BU BÖLÜM ORGANİZASYONDAN BAĞIMSIZDIR
--
--    BULGU: 'bina-modelleri' kovası hâlâ public=true ve storage.objects üzerinde
--    anon'a açık okuma/yazma/silme politikaları duruyor (supabase_schema.sql:649
--    ve sonrası). Aşama 3 yalnızca TABLO yetkilerini geri almıştı, depolama
--    politikalarına dokunmamıştı. Yani bugün model dosyaları, yolunu bilen
--    herkese anahtarsız açık — ve bu, az önce kurulan dosya izolasyonunu 'model'
--    türü için tamamen boşa çıkarır.
--
--    NEDEN GÜVENLİ: uygulama bu kovadan zaten DOĞRUDAN okumuyor. Model adresi
--    /api/dosya'dan imzalı olarak alınıyor (src/supabase.js:715 -> dosyaUrl ->
--    /api/dosya). İmzalı adresler private kovada da çalışır, davranış değişmez.
--
--    İSTEMEZSENİZ BU BÖLÜMÜ ATLAYABİLİRSİNİZ — yukarıdaki 4 bölüm bundan bağımsız
--    çalışır. Atlarsanız 3D modeller organizasyonlar arasında ayrışmamış kalır.
-- ─────────────────────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'bina-modelleri';

DROP POLICY IF EXISTS "bina_modelleri_public_read" ON storage.objects;
DROP POLICY IF EXISTS "bina_modelleri_anon_write"  ON storage.objects;
DROP POLICY IF EXISTS "bina_modelleri_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "bina_modelleri_anon_delete" ON storage.objects;


-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA
--
-- a) Varlık tablolarının birincil anahtarı iki sütunlu mu? (hepsi 2 dönmeli)
--
--    SELECT c.conrelid::regclass::text AS tablo, array_length(c.conkey,1) AS sutun
--    FROM pg_constraint c
--    JOIN pg_class r ON r.oid = c.conrelid
--    JOIN pg_namespace n ON n.oid = r.relnamespace
--    WHERE c.contype='p' AND n.nspname='public'
--      AND r.relname IN ('proje_items','app_settings','saha_settings','companies')
--    ORDER BY 1;
--
-- b) Tek sütunlu global UNIQUE kalmış mı? (hiç satır dönmemeli)
--
--    SELECT c.conrelid::regclass::text, c.conname
--    FROM pg_constraint c
--    WHERE c.contype='u' AND array_length(c.conkey,1)=1
--      AND c.conrelid IN ('public.rapor_ekipler'::regclass,
--                         'public.proje_buildings'::regclass,
--                         'public.proje_sections'::regclass);
--
-- c) org_id varsayılanı kalmış mı? (hiç satır dönmemeli)
--
--    SELECT table_name FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='org_id' AND column_default IS NOT NULL;
--
-- d) Model kovası kapandı mı? (public = false dönmeli)
--
--    SELECT id, public FROM storage.buckets WHERE id IN ('belgeler','bina-modelleri');
-- ═══════════════════════════════════════════════════════════════════════════
