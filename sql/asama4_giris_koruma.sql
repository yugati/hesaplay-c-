-- ═══════════════════════════════════════════════════════════════════════════
-- AŞAMA 4 — GİRİŞ KORUMASI (kaba kuvvet engeli)
--
-- NEDEN: Aşama 3'te veriye tek yol /api/* oldu, yani artık TEK KAPI giriş ekranı.
-- Ama /api/login'de hiçbir deneme sınırı yoktu: kullanıcı adını bilen biri
-- (admin, ELYOR gibi tahmin edilebilir) istediği kadar şifre deneyebiliyordu.
--
-- Bu tablo başarısız giriş denemelerini sayar ve geçici kilit uygular.
-- Yalnızca sunucu (service_role) yazar; tarayıcıya HİÇ açılmaz - api/veri.js'in
-- beyaz listesinde de yoktur.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.giris_denemeleri (
  anahtar     TEXT        NOT NULL PRIMARY KEY,   -- 'u:<kullanici>' veya 'ip:<adres>'
  sayac       INTEGER     NOT NULL DEFAULT 0,
  son_hata    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kilit_bitis TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS giris_denemeleri_son_hata_idx ON public.giris_denemeleri (son_hata);

-- Aşama 3 ile aynı duruş: RLS açık, anon/authenticated'a HİÇBİR yetki yok.
ALTER TABLE public.giris_denemeleri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "giris_denemeleri_anon_all" ON public.giris_denemeleri;
DROP POLICY IF EXISTS "giris_denemeleri_auth_all" ON public.giris_denemeleri;
REVOKE ALL ON public.giris_denemeleri FROM anon, authenticated;

-- DOĞRULAMA: aşağıdaki sorgu hiçbir satır döndürmemeli
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'giris_denemeleri'
  AND grantee IN ('anon', 'authenticated');
