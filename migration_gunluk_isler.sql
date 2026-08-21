-- ═══════════════════════════════════════════════════════════════════════════
-- GUNLUK ISLER (TAKVIMLI GOREV TAKIBI) — gunluk_isler
--
-- NEDEN: Bina secim panosunda takvimli bir gorev listesi var: bir gune gorev
-- eklenir, sorumlusu ve binasi secilir, durumu (bekliyor / devam / bitti)
-- izlenir, sonunda bir denetci onaylar ya da revizyon ister.
--
-- Kayit bicimi diger varlik tablolariyla aynidir (id + JSONB data):
--   { id, baslik, aciklama, bina, konum, tarih:'YYYY-MM-DD', sorumlu,
--     oncelik:'dusuk|normal|yuksek', durum:'bekliyor|devam|bitti',
--     denetim:{durum:'yok|onay|revizyon', kisi, ts, not},
--     olusturan, olusturmaTs, guncelleyen, guncellemeTs }
--
-- Supabase Dashboard > SQL Editor'da BIR KEZ calistirin. Tekrar calistirmak
-- zararsizdir (IF NOT EXISTS / DROP ... IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gunluk_isler (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gunluk_isler_created_at_idx ON public.gunluk_isler (created_at);
-- takvim hep "su ayin gunleri" diye sorulur: tarih ve bina en sik suzulen alanlar
CREATE INDEX IF NOT EXISTS gunluk_isler_tarih_idx      ON public.gunluk_isler ((data->>'tarih'));
CREATE INDEX IF NOT EXISTS gunluk_isler_bina_idx       ON public.gunluk_isler ((data->>'bina'));

-- Asama 3 durusu: RLS acik, anon/authenticated'a HICBIR yetki yok.
-- Veriye tek yol sunucudaki service_role'dur (api/veri.js).
ALTER TABLE public.gunluk_isler ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gunluk_isler_anon_all" ON public.gunluk_isler;
DROP POLICY IF EXISTS "gunluk_isler_auth_all" ON public.gunluk_isler;
REVOKE ALL ON public.gunluk_isler FROM anon, authenticated;

-- set_updated_at() supabase_schema.sql'in en basinda tanimlidir; bu dosyayi tek
-- basina calistiriyorsaniz asagidaki blok fonksiyonu garanti eder.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gunluk_isler_updated_at ON public.gunluk_isler;
CREATE TRIGGER gunluk_isler_updated_at BEFORE UPDATE ON public.gunluk_isler
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- DOGRULAMA: asagidaki sorgu hicbir satir dondurmemeli
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'gunluk_isler'
  AND grantee IN ('anon', 'authenticated');
