-- ═══════════════════════════════════════════════════════════════════════════
-- BİRİM (DİSİPLİN KATMANI) — AŞAMA 1 / EKLEME
--
-- NE YAPAR: Tasarının ALTINA üçüncü bir katman kurar. Bölüm, şartname, sipariş,
-- fatura, rapor, tutanak, günlük iş ve saha tablolarına birim_id sütunu ekler,
-- mevcut TÜM veriyi 'elektrik' birimine atar, birimler tablosunu kurar ve
-- birim bazlı benzersizlik indekslerini AÇAR. Malzeme kütüphanesindeki her
-- ürüne de "birim":"elektrik" etiketi yazar (kütüphane ORTAK kalır, etiket
-- yalnızca hangi birimden girildiğini söyler).
--
-- NE YAPMAZ: Hiçbir şeyi silmez, hiçbir mevcut kısıtı kaldırmaz. Bu dosya
-- ÇALIŞTIRILDIKTAN SONRA uygulama bugünkü kodla HİÇBİR DEĞİŞİKLİK OLMADAN
-- çalışmaya devam eder — sütun eklenmiştir ama kimse ona bakmaz, varsayılanı
-- 'elektrik' olduğu için yeni kayıtlar da doğru yere düşer.
-- (migration_tasari_1.sql ile birebir aynı strateji.)
--
-- SIRA:
--   1) BU DOSYA  -> Supabase SQL Editor'da çalıştırılır (şimdi)
--   2) Sunucu + istemci kodu yayına alınır (birim_id artık okunur/yazılır)
--   3) migration_birim_2.sql -> anahtar (org_id, tasari_id, birim_id, id)'ye
--      devredilir, tasarı düzeyi benzersizlikler kaldırılır, varsayılan düşürülür
--
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- ───────────────────────────────────────────────────────────────────────────
-- HANGİ TABLO HANGİ KATMANDA (alınan karar, 27 Ekim 2026)
--
--   ORGANİZASYON GENELİ — değişmedi (tasari_id de birim_id de yok):
--     companies, proje_materials (+ data.birim ETİKETİ), alet_lib, gecici_lib,
--     katalog, users
--
--   TASARI GENELİ — birimler arasında ORTAK, birim_id ALMAZ:
--     proje_buildings, proje_lokasyonlar, proje_bina_modelleri   (fiziksel tesis)
--     alet_items                                                 (El Aleti zimmeti)
--     gecici_moves, gecici_orders                                (Mobilizasyon ambarı)
--     app_settings içinde binaGiris / binaPasif / binaOlusum + migration
--     bayrakları + markalar  (birim_id = '_tasari' sabit kimliğiyle durur)
--
--   BİRİME ÖZEL — birim_id ALIR:
--     proje_sections, proje_sartnames, proje_specs, proje_items, proje_orders,
--     proje_alternatives, ihtiyac_listeleri, faturalar, rapor_entries,
--     rapor_ekipler, tutanaklar, gunluk_isler, saha_panels, saha_lines,
--     saha_sockets, saha_settings, saha_linkleri, app_settings (kalan anahtarlar)
--
--   AYRIK — audit_log: damgalanır, okunurken filtrelenmez.
--   (lib/birim.js BIRIM_TABLOLARI ile aynı liste — iki taraf birlikte değişir)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. BİRİMLER TABLOSU ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.birimler (
  org_id      TEXT        NOT NULL,
  tasari_id   TEXT        NOT NULL,
  id          TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}',
  aktif       BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, tasari_id, id)
);
DROP TRIGGER IF EXISTS birimler_updated_at ON public.birimler;
CREATE TRIGGER birimler_updated_at BEFORE UPDATE ON public.birimler
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
ALTER TABLE public.birimler ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.birimler FROM anon, authenticated;

-- Her mevcut tasarı 'elektrik' birimiyle doğar: bugüne kadarki tüm veri oraya
-- atanıyor (aşağıdaki DEFAULT). BYKARA'nın tasarılarına İnşaat ve Mekanik de
-- açılır (kullanıcı kararı); diğerleri Çalışma Alanı > Yeni Birim ile eklenir.
INSERT INTO public.birimler (org_id, tasari_id, id, data)
SELECT org_id, id, 'elektrik', '{"ad":"Elektrik"}'::jsonb FROM public.tasarilar
ON CONFLICT (org_id, tasari_id, id) DO NOTHING;

INSERT INTO public.birimler (org_id, tasari_id, id, data)
SELECT org_id, id, 'insaat', '{"ad":"İnşaat"}'::jsonb FROM public.tasarilar WHERE org_id = 'bykara'
ON CONFLICT (org_id, tasari_id, id) DO NOTHING;

INSERT INTO public.birimler (org_id, tasari_id, id, data)
SELECT org_id, id, 'mekanik', '{"ad":"Mekanik"}'::jsonb FROM public.tasarilar WHERE org_id = 'bykara'
ON CONFLICT (org_id, tasari_id, id) DO NOTHING;

-- ─── 2. birim_id SÜTUNU (varsayılan 'elektrik') ──────────────────────────────
DO $$
DECLARE
  t TEXT;
  -- id + data desenindeki BİRİME ÖZEL varlık tabloları
  varlik TEXT[] := ARRAY[
    'tutanaklar',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries',
    'proje_sartnames','proje_specs','proje_items','proje_orders','proje_alternatives',
    'gunluk_isler','ihtiyac_listeleri','faturalar',
    'audit_log'    -- damgalanır ama filtrelenmez
  ];
  diger TEXT[] := ARRAY['app_settings','saha_settings','rapor_ekipler','proje_sections','saha_linkleri'];
BEGIN
  FOREACH t IN ARRAY (varlik || diger) LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS birim_id TEXT NOT NULL DEFAULT %L', t, 'elektrik');
    RAISE NOTICE 'birim_id eklendi: %', t;
  END LOOP;
END $$;

-- Kullanıcı: varsayılan birimi + girebildiği birimler ("[]" = tümü, bina erişimiyle aynı kural)
ALTER TABLE public.users   ADD COLUMN IF NOT EXISTS birim_id TEXT  NOT NULL DEFAULT 'elektrik';
ALTER TABLE public.users   ADD COLUMN IF NOT EXISTS birimler JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.users.birimler IS 'Erişim izni olan birim kimlikleri — JSON dizi, boş = tüm birimler';
CREATE INDEX IF NOT EXISTS users_birim_idx ON public.users (org_id, tasari_id, birim_id);
-- Davet de birim erişim listesini taşır (kabulde kullanıcıya yazılır)
ALTER TABLE public.invites ADD COLUMN IF NOT EXISTS birimler JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── 3. TASARI GENELİ AYARLAR: ortak kimliğe taşınır ─────────────────────────
-- Bina listesi, migration bayrakları ve marka listesi tasarının tüm birimlerinde
-- aynıdır. birim_id = '_tasari' (lib/birim.js ORTAK_BIRIM) ile durur; sunucu
-- app_settings okurken aktif birim + '_tasari' satırlarını birlikte döner.
-- (lib/birim.js ORTAK_AYARLAR ile aynı liste — iki taraf birlikte değişir)
UPDATE public.app_settings
   SET birim_id = '_tasari'
 WHERE key IN ('binaGiris','binaPasif','binaOlusum',
               'tavaSeed','tavaSeedV','specWipeV','matLibV','sectionsBackfillV',
               'specLinkV','specCatFixV','matFieldsV','siparisSectionV','markalar')
   AND birim_id <> '_tasari';

-- ─── 4. KÜTÜPHANE ETİKETİ: her ürün hangi birimden girildi ─────────────────
-- proje_materials ORTAK kalır (tasari_id / birim_id sütunu YOK). Etiket data
-- içinde: bugüne kadar girilen her ürün Elektrik biriminden girildi.
UPDATE public.proje_materials
   SET data = data || jsonb_build_object('birim', 'elektrik')
 WHERE org_id = 'bykara'
   AND NOT (data ? 'birim');

-- ─── 5. RAPOR: kaç satır nerede ──────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  n BIGINT;
  toplam BIGINT := 0;
  hepsi TEXT[] := ARRAY[
    'tutanaklar','saha_panels','saha_lines','saha_sockets','rapor_entries',
    'proje_sartnames','proje_specs','proje_items','proje_orders','proje_alternatives',
    'gunluk_isler','ihtiyac_listeleri','faturalar','audit_log',
    'app_settings','saha_settings','rapor_ekipler','proje_sections','saha_linkleri'
  ];
BEGIN
  FOREACH t IN ARRAY hepsi LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '  atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE birim_id = %L', t, 'elektrik') INTO n;
    toplam := toplam + n;
    RAISE NOTICE '  ELEKTRIK: % satir  <- %', lpad(n::text, 6), t;
  END LOOP;
  EXECUTE 'SELECT count(*) FROM public.app_settings WHERE birim_id = ''_tasari''' INTO n;
  RAISE NOTICE '  TASARI ORTAK ayar satiri: %', n;
  EXECUTE 'SELECT count(*) FROM public.proje_materials WHERE data->>''birim'' = ''elektrik''' INTO n;
  RAISE NOTICE '  Kutuphanede ELEKTRIK etiketli urun: %', n;
  RAISE NOTICE '────────────────────────────────────';
  RAISE NOTICE '  ELEKTRIK biriminde TOPLAM % satir', toplam;
  RAISE NOTICE '  (bina, lokasyon, 3D model, El Aleti zimmeti ve Mobilizasyon ambari';
  RAISE NOTICE '   tasari genelinde ortak kaldi, birime baglanmadi)';
END $$;

-- ─── 6. BİRİM BAZLI BENZERSİZLİK VE SAYFALAMA İNDEKSLERİ ────────────────────
-- Benzersizlik ŞİMDİ kurulur, anahtar devri 2. aşamada. Sunucu kodu yayına
-- girdiğinde upsert çakışma hedefi (org_id, tasari_id, birim_id, id) olur ve bu
-- indeks o hedefi karşılar; 2. aşama bu indeksi birincil anahtara dönüştürür.
DO $$
DECLARE
  t TEXT;
  varlik TEXT[] := ARRAY[
    'tutanaklar','saha_panels','saha_lines','saha_sockets','rapor_entries',
    'proje_sartnames','proje_specs','proje_items','proje_orders','proje_alternatives',
    'gunluk_isler','ihtiyac_listeleri','faturalar'
  ];
BEGIN
  FOREACH t IN ARRAY varlik LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (org_id, tasari_id, birim_id, id)',
                   t || '_bir_id_uidx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id, tasari_id, birim_id, created_at, id)',
                   t || '_bir_created_idx', t);
    RAISE NOTICE 'indeksler kuruldu: %', t;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS app_settings_bir_key_uidx    ON public.app_settings   (org_id, tasari_id, birim_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS saha_settings_bir_key_uidx   ON public.saha_settings  (org_id, tasari_id, birim_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS rapor_ekipler_bir_name_uidx  ON public.rapor_ekipler  (org_id, tasari_id, birim_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS proje_sections_bir_name_uidx ON public.proje_sections (org_id, tasari_id, birim_id, name);
CREATE INDEX IF NOT EXISTS proje_sections_bir_sort_idx   ON public.proje_sections (org_id, tasari_id, birim_id, sort_order);
CREATE INDEX IF NOT EXISTS rapor_ekipler_bir_created_idx ON public.rapor_ekipler  (org_id, tasari_id, birim_id, created_at);
CREATE INDEX IF NOT EXISTS saha_linkleri_bir_idx         ON public.saha_linkleri  (org_id, tasari_id, birim_id, created_at DESC);
-- Çalışma Alanı haritasındaki "son işlem" sayacı birime göre okur
CREATE INDEX IF NOT EXISTS audit_log_bir_created_idx     ON public.audit_log      (org_id, tasari_id, birim_id, created_at DESC);
