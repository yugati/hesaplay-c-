-- ═══════════════════════════════════════════════════════════════════════════
-- SAHA LINKI — saha_linkleri
--
-- NEDEN: Gunluk Saha Raporu'na hesapsiz giris kapisi. Yonetici tarih + bina +
-- bolum + ekip + vardiya (+ sartname, + kat) secip link uretir; linki acan
-- ekip sefi kalemlerin miktarini girip gonderir. Gonderim RAPORA YAZILMAZ -
-- burada 'bekliyor' durumunda durur, yonetici inceleyip kabul edince mevcut
-- Saha Kaydi formundan normal yoldan yazilir (bkz. lib/sahaLink.js).
--
-- Tek tablo, iki tur satir:
--   tur='link'     : uretilen link   data {tarih,bina,cat,ekip,vardiya,sart,
--                                          katId,katAd,stokDus,bitis,olusturan,iptal}
--   tur='gonderim' : link_id + data  {..., dolduran, adam, not, satirlar[],
--                                          durum:'bekliyor|kabul|red', karar}
--
-- LINK TOKENI TUTULMAZ: token sunucu anahtariyla imzalanir, veritabani
-- sizsa bile kullanilabilir link ele gecmez.
--
-- Supabase Dashboard > SQL Editor'da BIR KEZ calistirin. Tekrar calistirmak
-- zararsizdir (IF NOT EXISTS / DROP ... IF EXISTS). Kod bu tablo olmadan da
-- calisir: Rapor sayfasindaki "Saha Linki" penceresi kurulum uyarisi gosterir.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.saha_linkleri (
  id          TEXT        NOT NULL PRIMARY KEY,
  org_id      TEXT        NOT NULL,
  tasari_id   TEXT        NOT NULL,
  tur         TEXT        NOT NULL CHECK (tur IN ('link', 'gonderim')),
  link_id     TEXT,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- yonetim listesi: "bu tasarinin son 45 gunu"
CREATE INDEX IF NOT EXISTS saha_linkleri_kapsam_idx ON public.saha_linkleri (org_id, tasari_id, created_at DESC);
-- bir linkin gonderim sayisi
CREATE INDEX IF NOT EXISTS saha_linkleri_link_idx   ON public.saha_linkleri (link_id);

-- Asama 3 durusu: RLS acik, anon/authenticated'a HICBIR yetki yok.
-- Veriye tek yol sunucudaki service_role'dur (lib/sahaLink.js).
ALTER TABLE public.saha_linkleri ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saha_linkleri FROM anon, authenticated;

-- set_updated_at() supabase_schema.sql'in en basinda tanimlidir; bu dosyayi tek
-- basina calistiriyorsaniz asagidaki blok fonksiyonu garanti eder.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS saha_linkleri_updated_at ON public.saha_linkleri;
CREATE TRIGGER saha_linkleri_updated_at BEFORE UPDATE ON public.saha_linkleri
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- DOGRULAMA: asagidaki sorgu hicbir satir dondurmemeli
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'saha_linkleri'
  AND grantee IN ('anon', 'authenticated');
