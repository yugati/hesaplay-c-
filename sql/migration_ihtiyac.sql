-- ═══════════════════════════════════════════════════════════════════════════
-- IHTIYAC LISTESI (SEPET) — ihtiyac_listeleri
--
-- NEDEN: Sahada "sunlar lazim" diye toplanan malzeme listesi. Sepet gibi:
-- kutuphaneden urun secilir, miktari yazilir ve HER SATIR icin o urunun HANGI
-- BINANIN HANGI KATINA gidecegi isaretlenir. Siparisin on adimidir - siparis
-- kaydi DEGILDIR, stok/hareket uretmez.
--
-- Kayit bicimi diger varlik tablolariyla aynidir (id + JSONB data):
--   { id, ad, tarih:<ms>, bina, durum:'acik|tamam', aciklama,
--     lines:[{ id, matId, matSrc:'proje|gecici|alet', code, ad, marka, birim,
--              qty, bina, katId, kat, konum, not }],
--     olusturan, olusturmaTs, guncelleyen, guncellemeTs }
--
-- KAT NEDEN IKI ALAN: katId lokasyon agacindaki dugumu isaret eder (canli bag),
-- kat ise o anki AD kopyasidir. Kat dugumu sonradan silinse bile listenin nereye
-- ait oldugu okunabilir kalir - Gunluk Isler'in t.katlar alanindaki karar.
-- Kat kirilimi tanimli olmayan binalarda katId bos kalir, kat serbest metindir.
--
-- Supabase Dashboard > SQL Editor'da BIR KEZ calistirin. Tekrar calistirmak
-- zararsizdir (IF NOT EXISTS / DROP ... IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ihtiyac_listeleri (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ihtiyac_listeleri_created_at_idx ON public.ihtiyac_listeleri (created_at);
-- en sik suzulen alanlar: "bu binanin acik ihtiyaclari"
CREATE INDEX IF NOT EXISTS ihtiyac_listeleri_bina_idx       ON public.ihtiyac_listeleri ((data->>'bina'));
CREATE INDEX IF NOT EXISTS ihtiyac_listeleri_durum_idx      ON public.ihtiyac_listeleri ((data->>'durum'));

-- Asama 3 durusu: RLS acik, anon/authenticated'a HICBIR yetki yok.
-- Veriye tek yol sunucudaki service_role'dur (api/veri.js).
ALTER TABLE public.ihtiyac_listeleri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ihtiyac_listeleri_anon_all" ON public.ihtiyac_listeleri;
DROP POLICY IF EXISTS "ihtiyac_listeleri_auth_all" ON public.ihtiyac_listeleri;
REVOKE ALL ON public.ihtiyac_listeleri FROM anon, authenticated;

-- set_updated_at() supabase_schema.sql'in en basinda tanimlidir; bu dosyayi tek
-- basina calistiriyorsaniz asagidaki blok fonksiyonu garanti eder.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ihtiyac_listeleri_updated_at ON public.ihtiyac_listeleri;
CREATE TRIGGER ihtiyac_listeleri_updated_at BEFORE UPDATE ON public.ihtiyac_listeleri
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- DOGRULAMA: asagidaki sorgu hicbir satir dondurmemeli
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'ihtiyac_listeleri'
  AND grantee IN ('anon', 'authenticated');
