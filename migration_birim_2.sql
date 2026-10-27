-- ═══════════════════════════════════════════════════════════════════════════
-- BİRİM (DİSİPLİN KATMANI) — AŞAMA 2 / ANAHTAR DEVRİ
--
-- ÖN KOŞUL: migration_birim_1.sql çalıştırılmış VE birim katmanını okuyup
-- yazan sunucu kodu yayında olmalı. Bu dosya yalnızca o sıradan sonra güvenlidir:
--   1) Birincil anahtar (org_id, tasari_id, id) -> (org_id, tasari_id, birim_id, id)
--      Aynı tasarıda iki birim aynı kimlikli satır yazabilsin diye ŞART. Devir
--      PRIMARY KEY USING INDEX ile yapılır: 1. aşamadaki benzersiz indeks tablo
--      yeniden taranmadan anahtara dönüşür.
--   2) app_settings / saha_settings anahtarı (org_id, tasari_id, birim_id, key)
--   3) Tasarı düzeyi benzersizlikler (bölüm adı, ekip adı) kaldırılır - İnşaat
--      kendi "Ekip 1"ini ve kendi bölümünü açabilsin.
--   4) birim_id DEFAULT düşürülür: bir hata veriyi sessizce Elektrik'e
--      doldurmasın. Bundan sonra birim_id yazmayan her INSERT NOT NULL ile döner.
--      SUNUCU KODU 2. ADIMDA YAYINA GİRMEMİŞSE bu, her yazmayı kırar - sıra bu
--      yüzden önemli.
--
-- Tekrar çalıştırmak güvenlidir ("zaten devredilmiş" kontrolü).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. VARLIK TABLOLARI: birincil anahtar devri ────────────────────────────
DO $$
DECLARE
  t TEXT;
  eski TEXT;
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
    -- Önce "zaten devredilmiş mi" (4 sütunlu anahtar), sonra indeks aranır:
    -- devirde <tablo>_bir_id_uidx adı <tablo>_pkey'e döner, ikinci çalıştırmada bulunmaz.
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p'
        AND array_length(conkey, 1) = 4
    ) THEN
      RAISE NOTICE 'zaten devredilmis: %', t;
      CONTINUE;
    END IF;
    IF to_regclass('public.' || t || '_bir_id_uidx') IS NULL THEN
      RAISE EXCEPTION 'Once migration_birim_1.sql calistirilmali (eksik indeks: %)', t || '_bir_id_uidx';
    END IF;
    SELECT conname INTO eski FROM pg_constraint
    WHERE conrelid = ('public.' || t)::regclass AND contype = 'p';
    IF eski IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, eski);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
                   t, t || '_pkey', t || '_bir_id_uidx');
    RAISE NOTICE 'birincil anahtar (org_id, tasari_id, birim_id, id) oldu: %', t;
  END LOOP;
END $$;

-- ─── 2. ANAHTAR/DEĞER TABLOLARI ──────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  eski TEXT;
  kv TEXT[] := ARRAY['app_settings','saha_settings'];
BEGIN
  FOREACH t IN ARRAY kv LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p' AND array_length(conkey, 1) = 4
    ) THEN
      RAISE NOTICE 'zaten devredilmis: %', t;
      CONTINUE;
    END IF;
    IF to_regclass('public.' || t || '_bir_key_uidx') IS NULL THEN
      RAISE EXCEPTION 'Once migration_birim_1.sql calistirilmali (eksik indeks: %)', t || '_bir_key_uidx';
    END IF;
    SELECT conname INTO eski FROM pg_constraint
    WHERE conrelid = ('public.' || t)::regclass AND contype = 'p';
    IF eski IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, eski);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
                   t, t || '_pkey', t || '_bir_key_uidx');
    RAISE NOTICE 'birincil anahtar (org_id, tasari_id, birim_id, key) oldu: %', t;
  END LOOP;
END $$;

-- ─── 3. TASARI DÜZEYİ BENZERSİZLİKLER KALDIRILIR ────────────────────────────
DO $$
DECLARE
  eskiler TEXT[] := ARRAY['rapor_ekipler_tas_name_uidx', 'proje_sections_tas_name_uidx'];
  yeniler TEXT[] := ARRAY['rapor_ekipler_bir_name_uidx', 'proje_sections_bir_name_uidx'];
  k INT;
BEGIN
  FOR k IN 1 .. array_length(eskiler, 1) LOOP
    -- Yenisi kurulmadan eskisini DÜŞÜRME: aradaki pencerede benzersizlik kalmazdı.
    IF to_regclass('public.' || yeniler[k]) IS NULL THEN
      RAISE EXCEPTION 'Once migration_birim_1.sql calistirilmali (eksik indeks: %)', yeniler[k];
    END IF;
    IF to_regclass('public.' || eskiler[k]) IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', eskiler[k]);
      RAISE NOTICE 'tasari duzeyi benzersizlik kaldirildi: %', eskiler[k];
    ELSE
      RAISE NOTICE 'zaten kaldirilmis: %', eskiler[k];
    END IF;
  END LOOP;
END $$;

-- Tasarı düzeyi sayfalama indeksleri: birimlisi onların yerini aldı
DROP INDEX IF EXISTS public.proje_sections_tas_sort_idx;
DROP INDEX IF EXISTS public.rapor_ekipler_tas_created_idx;
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
    IF to_regclass('public.' || t || '_tas_created_idx') IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', t || '_tas_created_idx');
      RAISE NOTICE 'eski sayfalama indeksi dusuruldu: %', t || '_tas_created_idx';
    END IF;
  END LOOP;
END $$;

-- ─── 4. VARSAYILAN DÜŞÜRÜLÜR ─────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  hepsi TEXT[] := ARRAY[
    'tutanaklar','saha_panels','saha_lines','saha_sockets','rapor_entries',
    'proje_sartnames','proje_specs','proje_items','proje_orders','proje_alternatives',
    'gunluk_isler','ihtiyac_listeleri','faturalar','audit_log',
    'app_settings','saha_settings','rapor_ekipler','proje_sections','saha_linkleri',
    'users'
  ];
BEGIN
  FOREACH t IN ARRAY hepsi LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN birim_id DROP DEFAULT', t);
    RAISE NOTICE 'birim_id varsayilani dusuruldu: %', t;
  END LOOP;
END $$;
