-- ═══════════════════════════════════════════════════════════════════════════
-- MEKANİK (ALET) KÜTÜPHANESİ — alet_lib
--
-- NEDEN: El Aletleri modülünde her kayıt künyeyi (ürün kodu, ad, marka, birim,
-- barkod, renk, ölçü, ağırlık, madde, fotoğraf) kendi içinde taşıyordu. Aynı
-- alet 10 kez zimmetlenince künye 10 kez yazılıyor, birinde marka düzeltilince
-- diğerleri eski kalıyordu.
--
-- Proje tarafındaki düzenin aynısı kuruldu:
--   proje_materials (künye)  ->  proje_items (miktar + bina)
--   alet_lib        (künye)  ->  alet_items  (adet + zimmet + konum)
--
-- Bu dosya YALNIZCA yeni tabloyu ekler; alet_items'a dokunmaz. Eski kayıtlar
-- künyelerini kendi içlerinde taşımaya devam eder (uygulama libId yoksa kaydın
-- kendi alanlarını okur), o yüzden veri taşıma adımı YOKTUR.
--
-- Supabase Dashboard > SQL Editor'da bir kez çalıştırın.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.alet_lib (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alet_lib_created_at_idx ON public.alet_lib (created_at);
CREATE INDEX IF NOT EXISTS alet_lib_kod_idx        ON public.alet_lib ((data->>'kod'));

-- Aşama 3 duruşu: RLS açık, anon/authenticated'a HİÇBİR yetki yok.
-- Veriye tek yol sunucudaki service_role'dur (api/veri.js).
ALTER TABLE public.alet_lib ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alet_lib_anon_all" ON public.alet_lib;
DROP POLICY IF EXISTS "alet_lib_auth_all" ON public.alet_lib;
REVOKE ALL ON public.alet_lib FROM anon, authenticated;

DROP TRIGGER IF EXISTS alet_lib_updated_at ON public.alet_lib;
CREATE TRIGGER alet_lib_updated_at BEFORE UPDATE ON public.alet_lib
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- DOĞRULAMA: aşağıdaki sorgu hiçbir satır döndürmemeli
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'alet_lib'
  AND grantee IN ('anon', 'authenticated');
