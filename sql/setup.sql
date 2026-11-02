-- ═══════════════════════════════════════════════════════════════════════
-- Saha Malzeme Takip — Supabase Kurulum Scripti
-- Supabase > SQL Editor bölümüne yapıştırıp çalıştırın.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. TABLO ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT        UNIQUE NOT NULL,
  password    TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'izleyici'
                          CHECK (role IN ('admin', 'izleyici', 'saha_personeli', 'viewer', 'sef', 'saha', 'editor')),
  sections    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  buildings   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.users              IS 'Uygulama kullanıcıları';
COMMENT ON COLUMN public.users.role        IS 'admin | izleyici | saha_personeli (eski: viewer | sef | saha | editor)';
COMMENT ON COLUMN public.users.sections    IS 'Erişim izni olan bölüm kodları — JSON dizi';
COMMENT ON COLUMN public.users.buildings   IS 'Erişim izni olan bina kodları — JSON dizi, boş = tüm binalar';

-- ─── 2. İNDEKSLER ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS users_username_lower_idx ON public.users (lower(username));
CREATE INDEX IF NOT EXISTS users_role_idx           ON public.users (role);
CREATE INDEX IF NOT EXISTS users_created_at_idx     ON public.users (created_at DESC);

-- ─── 3. updated_at OTOMATİK GÜNCELLEME TRİGGER ───────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. ROW LEVEL SECURITY ────────────────────────────────────────────────
-- Yetkilendirme uygulama katmanında yapılıyor (Supabase Auth kullanılmıyor).
-- Publishable (anon) anahtar tüm işlemleri yapabilsin.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Önceki politikaları temizle (idempotent çalışması için)
DROP POLICY IF EXISTS "anon_select" ON public.users;
DROP POLICY IF EXISTS "anon_insert" ON public.users;
DROP POLICY IF EXISTS "anon_update" ON public.users;
DROP POLICY IF EXISTS "anon_delete" ON public.users;

CREATE POLICY "anon_select" ON public.users
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert" ON public.users
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update" ON public.users
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete" ON public.users
  FOR DELETE TO anon USING (true);

-- ─── 5. İZİNLER ──────────────────────────────────────────────────────────
GRANT USAGE  ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO anon;

-- ─── 6. VARSAYILAN ADMİN (şifre: 1234) ───────────────────────────────────
-- Çakışma durumunda sessizce atlar; güvenli şekilde tekrar çalıştırılabilir.
INSERT INTO public.users (username, password, role, sections, buildings)
VALUES (
  'admin',
  '1234',
  'admin',
  '["proje","gecici","alet","saha","rapor","tanimlar","kutuphane"]'::jsonb,
  '[]'::jsonb
)
ON CONFLICT (username) DO NOTHING;
