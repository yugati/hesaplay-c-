-- ════════════════════════════════════════════════════════════════
-- TUTANAK MODULU — KURULUM (organizasyon uyumlu, kapı kapalı)
--
-- NEREDE ÇALIŞTIRILIR:
--   Supabase Dashboard -> SQL Editor -> yeni sorgu -> yapıştır -> Run
--
-- Tekrar çalıştırmak zararsızdır. Tablo yoksa kurar, varsa eksiklerini tamamlar.
--
-- ⚠ BU DOSYA 26 AĞU 2026'DA YENİDEN YAZILDI. Eski hali iki şeyi yanlış yapıyordu:
--
--   1) ANON KAPISINI AÇIYORDU. İçinde
--        CREATE POLICY "tutanaklar_anon_all" ... FOR ALL TO anon USING (true)
--        GRANT SELECT, INSERT, UPDATE, DELETE ... TO anon
--      satırları vardı. Bunlar Aşama 3'ten (asama3_anon_kapat.sql) ÖNCE yazılmıştı;
--      bugün çalıştırılsalar kapatılan arka kapıyı yeniden açar, siteyi açan
--      herkes giriş yapmadan tutanakları okuyup silebilirdi. Artık açılmıyor.
--
--   2) ORGANİZASYON SÜTUNU YOKTU. Tablo org_id olmadan doğardı ve /api/veri onu
--      sorgularken hata verirdi (her sorgu org'a daraltılıyor). Artık diğer 27
--      tabloyla birebir aynı düzende doğuyor: org_id + (org_id, id) birincil
--      anahtar + org bazlı indeksler.
--
-- Bu dosyayı çalıştırdıktan sonra migration_org_1/org_2'yi TEKRAR çalıştırmanız
-- GEREKMEZ — burada zaten son düzen kuruluyor. (Yine de çalıştırırsanız zarar
-- vermez, ikisi de tekrar çalıştırılabilir.)
-- ════════════════════════════════════════════════════════════════

-- set_updated_at() supabase_schema.sql'in başında tanımlıdır; bu dosya tek başına
-- çalıştırılabilsin diye burada da garanti ediliyor.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 1. TABLO ───────────────────────────────────────────────────
-- org_id'nin VARSAYILANI YOK: kod her yazmada açıkça koyuyor (api/veri.js
-- satırlara zorla yazıyor). Varsayılan bırakılsaydı, org_id yazmayı unutan bir
-- hata veriyi sessizce 'bykara'ya doldururdu; varsayılansız aynı hata gürültülü
-- bir NOT NULL ihlaline dönüşür. Diğer 27 tabloda da durum böyle
-- (bkz. migration_org_2.sql 4. bölüm).
CREATE TABLE IF NOT EXISTS public.tutanaklar (
  id          TEXT        NOT NULL,
  org_id      TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, id)
);

-- ─── 2. ESKİ SÜRÜMDEN GEÇİŞ ─────────────────────────────────────
-- Tablo daha önce bu dosyanın ESKİ haliyle kurulduysa: org_id yoktur ve birincil
-- anahtar tek başına id'dir. Aşağıdaki blok o durumu bugünkü düzene taşır.
DO $$
DECLARE eski TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tutanaklar' AND column_name = 'org_id'
  ) THEN
    -- Var olan satırlar tek kiracı dönemine aittir, hepsi BYKARA'nındır.
    ALTER TABLE public.tutanaklar ADD COLUMN org_id TEXT NOT NULL DEFAULT 'bykara';
    ALTER TABLE public.tutanaklar ALTER COLUMN org_id DROP DEFAULT;
    RAISE NOTICE 'org_id eklendi (mevcut satirlar bykara sayildi)';
  END IF;

  -- Birincil anahtar tek sütunluysa (org_id, id) yapılır
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tutanaklar'::regclass AND contype = 'p' AND array_length(conkey, 1) = 1
  ) THEN
    SELECT conname INTO eski FROM pg_constraint
    WHERE conrelid = 'public.tutanaklar'::regclass AND contype = 'p';
    EXECUTE format('ALTER TABLE public.tutanaklar DROP CONSTRAINT %I', eski);
    ALTER TABLE public.tutanaklar ADD CONSTRAINT tutanaklar_pkey PRIMARY KEY (org_id, id);
    RAISE NOTICE 'birincil anahtar (org_id, id) oldu';
  END IF;
END $$;

-- ─── 3. İNDEKSLER ───────────────────────────────────────────────
-- (org_id, created_at, id): artımlı yükleme tam bu sırayla sayfalıyor
-- (src/supabase.js sbGetAll). Org filtresi eklendiği için bu indeks olmadan
-- her açılış tam tablo taramasına dönerdi.
CREATE INDEX IF NOT EXISTS tutanaklar_org_created_idx ON public.tutanaklar (org_id, created_at, id);
-- Tutanak numarasına göre arama; numara organizasyon içinde anlamlı olduğu için önek org_id.
CREATE INDEX IF NOT EXISTS tutanaklar_org_no_idx      ON public.tutanaklar (org_id, (data->>'no'));

-- ─── 4. KAPI KAPALI ─────────────────────────────────────────────
-- Veriye tek yol /api/veri; o da sunucuda service_role ile çalışır ve RLS'i atlar.
-- anon/authenticated'ın bu tabloda hiçbir işi yok (bkz. asama3_anon_kapat.sql).
ALTER TABLE public.tutanaklar ENABLE ROW LEVEL SECURITY;

-- Eski sürüm çalıştırılmışsa açtığı politikaları geri al
DROP POLICY IF EXISTS "tutanaklar_anon_all" ON public.tutanaklar;
DROP POLICY IF EXISTS "tutanaklar_auth_all" ON public.tutanaklar;
REVOKE ALL ON public.tutanaklar FROM anon, authenticated;

-- ─── 5. TRIGGER ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tutanaklar_updated_at ON public.tutanaklar;
CREATE TRIGGER tutanaklar_updated_at BEFORE UPDATE ON public.tutanaklar
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();


-- ════════════════════════════════════════════════════════════════
-- DOĞRULAMA — çalıştırıp sonuçlara bakın
--
-- a) Sütunlar yerinde mi? (id, org_id, data, created_at, updated_at dönmeli)
--
--    SELECT column_name, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='tutanaklar' ORDER BY ordinal_position;
--
-- b) Birincil anahtar iki sütunlu mu? (2 dönmeli)
--
--    SELECT array_length(conkey,1) FROM pg_constraint
--    WHERE conrelid='public.tutanaklar'::regclass AND contype='p';
--
-- c) anon/authenticated'a açık politika ya da yetki kaldı mı? (ikisi de boş dönmeli)
--
--    SELECT policyname, roles FROM pg_policies
--    WHERE schemaname='public' AND tablename='tutanaklar';
--
--    SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema='public' AND table_name='tutanaklar'
--      AND grantee IN ('anon','authenticated');
-- ════════════════════════════════════════════════════════════════
