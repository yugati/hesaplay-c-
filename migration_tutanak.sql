-- ════════════════════════════════════════════════════════════════
-- TUTANAK MODULU — TEK SEFERLIK KURULUM
--
-- NEREDE CALISTIRILIR:
--   Supabase Dashboard -> SQL Editor -> yeni sorgu -> yapistir -> Run
--
-- Tekrar tekrar calistirmak zararsizdir (IF NOT EXISTS / DROP ... IF EXISTS).
-- Ayni icerik supabase_schema.sql dosyasinin sonunda da vardir; bu dosya
-- yalnizca "tum semayi calistirmadan sadece bunu ekleyeyim" diyenler icindir.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tutanaklar (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tutanaklar_created_at_idx ON public.tutanaklar (created_at);
CREATE INDEX IF NOT EXISTS tutanaklar_no_idx         ON public.tutanaklar ((data->>'no'));

ALTER TABLE public.tutanaklar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tutanaklar_anon_all"  ON public.tutanaklar;
CREATE POLICY "tutanaklar_anon_all"  ON public.tutanaklar FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tutanaklar_auth_all"  ON public.tutanaklar;
CREATE POLICY "tutanaklar_auth_all"  ON public.tutanaklar FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutanaklar TO anon, authenticated;

-- set_updated_at() fonksiyonu supabase_schema.sql'in en basinda tanimlidir.
-- Bu dosyayi tek basina calistiriyorsaniz once asagidaki blok fonksiyonu garanti eder.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tutanaklar_updated_at ON public.tutanaklar;
CREATE TRIGGER tutanaklar_updated_at BEFORE UPDATE ON public.tutanaklar
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
