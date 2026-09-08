-- ═══════════════════════════════════════════════════════════════════════════
-- DAVETLE KAYIT — invites tablosu
--
-- NE YAPAR: admin bir e-postaya davet gonderir (rol/bolum/bina/izinler onceden
-- belirlenmis), davet edilen kisi kendi kullanici adi/sifresini kendisi secerek
-- hesabini acar. Token DUZ METIN OLARAK SAKLANMAZ - sifre hash'leme ile ayni
-- prensip: DB sizarsa kullanilabilir davet linki ele gecmesin diye yalnizca
-- sha256 hash'i tutulur (bkz. lib/invites.js tokenHash).
--
-- Tekrar calistirmak guvenlidir (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'izleyici',
  sections    JSONB       NOT NULL DEFAULT '[]',
  buildings   JSONB       NOT NULL DEFAULT '[]',
  permissions JSONB       NOT NULL DEFAULT '{}',
  token_hash  TEXT        NOT NULL UNIQUE,
  created_by  UUID        REFERENCES public.users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     UUID        REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.invites IS 'Kullanici davetleri - self-servis kayit icin tek kullanimlik linkler';
COMMENT ON COLUMN public.invites.token_hash IS 'sha256(token) - duz metin token DB de tutulmaz';

CREATE INDEX IF NOT EXISTS invites_org_idx        ON public.invites (org_id);
CREATE INDEX IF NOT EXISTS invites_token_hash_idx ON public.invites (token_hash);

-- GUVENLIK: users tablosuyla ayni prensip - anon/authenticated bu tabloyu hic
-- gormez, yalniz /api/invites ve /api/davet* service_role ile erisir.
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invites FROM anon, authenticated;
