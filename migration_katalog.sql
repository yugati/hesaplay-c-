-- ═══════════════════════════════════════════════════════════════════════════
-- KATALOG — katalog
--
-- NEDEN: Ihtiyac Listesi ekraninin icinde ama o sistemin isleyisinden bagimsiz
-- bir alt bolum. Malzeme Kutuphanesi'nden bir urun secilir, ustune sabit
-- ozellikler (marka, model, olcu, malzeme, renk, birim) ve serbest bir not
-- eklenir. Siparis/hakedis/stok akisina HIC girmez - salt bir urun spesifikasyon
-- kaydidir.
--
-- Kayit bicimi diger varlik tablolariyla aynidir (id + JSONB data):
--   { id, matId, kod, ad, marka, birim, img,
--     ozellikler:{marka,model,olcu,malzeme,renk,birim,not},
--     olusturan, olusturmaTs, guncelleyen, guncellemeTs }
--
-- matId, Malzeme Kutuphanesi'ndeki (proje_materials) urune ISARET eder; kod/ad/
-- marka/birim/img o anki halin KOPYASIDIR - kutuphanedeki urun sonradan
-- silinse/degistirilse de katalog kaydi okunabilir kalir.
--
-- ORTAK TABLODUR (companies / proje_materials ile ayni karar - bkz. lib/tasari.js
-- ORTAK_TABLOLAR): tasari_id sutunu YOKTUR, tum tasarilar ayni katalogu gorur.
-- Kaynagi (Malzeme Kutuphanesi) da ortak oldugu icin katalog da ortak kalir.
--
-- SIRA:
--   1) BU DOSYAYI calistirin.
--   2) migration_org_1.sql'i TEKRAR calistirin  (org_id sutunu + indeksler)
--   3) migration_org_2.sql'i TEKRAR calistirin  (org_id birincil anahtara girer)
--   migration_tasari_1.sql'e EKLENMEZ - katalog tasariya ozel degildir.
--
-- Supabase Dashboard > SQL Editor'da calistirin. Tekrar calistirmak zararsizdir
-- (IF NOT EXISTS / DROP ... IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.katalog (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS katalog_created_at_idx ON public.katalog (created_at);
-- en sik suzulen alan: "bu kutuphane urununun katalog kaydi var mi"
CREATE INDEX IF NOT EXISTS katalog_matid_idx      ON public.katalog ((data->>'matId'));

-- Asama 3 durusu: RLS acik, anon/authenticated'a HICBIR yetki yok.
-- Veriye tek yol sunucudaki service_role'dur (api/veri.js).
ALTER TABLE public.katalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "katalog_anon_all" ON public.katalog;
DROP POLICY IF EXISTS "katalog_auth_all" ON public.katalog;
REVOKE ALL ON public.katalog FROM anon, authenticated;

-- set_updated_at() supabase_schema.sql'in en basinda tanimlidir; bu dosyayi tek
-- basina calistiriyorsaniz asagidaki blok fonksiyonu garanti eder.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS katalog_updated_at ON public.katalog;
CREATE TRIGGER katalog_updated_at BEFORE UPDATE ON public.katalog
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- DOGRULAMA: asagidaki sorgu hicbir satir dondurmemeli
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'katalog'
  AND grantee IN ('anon', 'authenticated');
