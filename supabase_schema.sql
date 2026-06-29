-- ============================================================
-- Saha Malzeme Takip Sistemi — Supabase Tam Şema
-- Supabase Dashboard > SQL Editor'da çalıştırın.
-- IF NOT EXISTS koruması sayesinde tekrar çalıştırmak güvenlidir.
-- ============================================================

-- pgcrypto (UUID üretimi için — Supabase'de genellikle yüklü gelir)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Ortak yardımcı: updated_at otomatik güncelleme
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Makro: tablo için updated_at trigger ekle
-- (Trigger adı benzersiz olması için tablo adını içeriyor)
-- Aşağıda her tablo için ayrı ayrı çağrılır.

-- ─────────────────────────────────────────────────────────────
-- SCHEMA erişim izni (anon ve authenticated)
-- ─────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- ============================================================
-- 1. USERS
-- (Zaten varsa değiştirilmez — sadece eksik sütun eklenir)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username    TEXT        NOT NULL UNIQUE,
  password    TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'saha',
  sections    JSONB                DEFAULT '[]',
  buildings   JSONB                DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Eksik sütunları sessizce ekle (tekrar çalıştırma güvenliği)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sections    JSONB        DEFAULT '[]';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS buildings   JSONB        DEFAULT '[]';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ  DEFAULT NOW();
-- Saha Personeli rol izin sistemi: {modul: {read,create,update,delete}}
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS permissions JSONB        DEFAULT '{}';

CREATE INDEX IF NOT EXISTS users_username_idx ON public.users (username);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON public.users (created_at);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_anon_all"  ON public.users;
CREATE POLICY "users_anon_all"  ON public.users FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "users_auth_all"  ON public.users;
CREATE POLICY "users_auth_all"  ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO anon, authenticated;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- 2. APP_SETTINGS  (migration flag'leri, meta bilgiler)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         TEXT        NOT NULL PRIMARY KEY,
  value       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_settings_created_at_idx ON public.app_settings (created_at);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_anon_all"  ON public.app_settings;
CREATE POLICY "app_settings_anon_all"  ON public.app_settings FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "app_settings_auth_all"  ON public.app_settings;
CREATE POLICY "app_settings_auth_all"  ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated;

DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- 3. AUDIT_LOG  (denetim kaydı — id uygulama tarafından verilmez)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_anon_all"  ON public.audit_log;
CREATE POLICY "audit_log_anon_all"  ON public.audit_log FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "audit_log_auth_all"  ON public.audit_log;
CREATE POLICY "audit_log_auth_all"  ON public.audit_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO anon, authenticated;

-- ============================================================
-- 4. SAHA_SETTINGS  (saha planı arka plan resmi vs.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.saha_settings (
  key         TEXT        NOT NULL PRIMARY KEY,
  value       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saha_settings_created_at_idx ON public.saha_settings (created_at);

ALTER TABLE public.saha_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_settings_anon_all"  ON public.saha_settings;
CREATE POLICY "saha_settings_anon_all"  ON public.saha_settings FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "saha_settings_auth_all"  ON public.saha_settings;
CREATE POLICY "saha_settings_auth_all"  ON public.saha_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saha_settings TO anon, authenticated;

DROP TRIGGER IF EXISTS saha_settings_updated_at ON public.saha_settings;
CREATE TRIGGER saha_settings_updated_at BEFORE UPDATE ON public.saha_settings
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- 5. RAPOR_EKIPLER
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rapor_ekipler (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rapor_ekipler_created_at_idx ON public.rapor_ekipler (created_at);

ALTER TABLE public.rapor_ekipler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rapor_ekipler_anon_all"  ON public.rapor_ekipler;
CREATE POLICY "rapor_ekipler_anon_all"  ON public.rapor_ekipler FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rapor_ekipler_auth_all"  ON public.rapor_ekipler;
CREATE POLICY "rapor_ekipler_auth_all"  ON public.rapor_ekipler FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rapor_ekipler TO anon, authenticated;

DROP TRIGGER IF EXISTS rapor_ekipler_updated_at ON public.rapor_ekipler;
CREATE TRIGGER rapor_ekipler_updated_at BEFORE UPDATE ON public.rapor_ekipler
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- 6. PROJE_BUILDINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.proje_buildings (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE,
  sort_order  INT                  DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_buildings_code_idx       ON public.proje_buildings (code);
CREATE INDEX IF NOT EXISTS proje_buildings_sort_order_idx ON public.proje_buildings (sort_order, created_at);
CREATE INDEX IF NOT EXISTS proje_buildings_created_at_idx ON public.proje_buildings (created_at);

ALTER TABLE public.proje_buildings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_buildings_anon_all"  ON public.proje_buildings;
CREATE POLICY "proje_buildings_anon_all"  ON public.proje_buildings FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_buildings_auth_all"  ON public.proje_buildings;
CREATE POLICY "proje_buildings_auth_all"  ON public.proje_buildings FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_buildings TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_buildings_updated_at ON public.proje_buildings;
CREATE TRIGGER proje_buildings_updated_at BEFORE UPDATE ON public.proje_buildings
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- 7. PROJE_SECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.proje_sections (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL UNIQUE,
  sort_order  INT                  DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_sections_name_idx       ON public.proje_sections (name);
CREATE INDEX IF NOT EXISTS proje_sections_sort_order_idx ON public.proje_sections (sort_order, created_at);
CREATE INDEX IF NOT EXISTS proje_sections_created_at_idx ON public.proje_sections (created_at);

ALTER TABLE public.proje_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_sections_anon_all"  ON public.proje_sections;
CREATE POLICY "proje_sections_anon_all"  ON public.proje_sections FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_sections_auth_all"  ON public.proje_sections;
CREATE POLICY "proje_sections_auth_all"  ON public.proje_sections FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_sections TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_sections_updated_at ON public.proje_sections;
CREATE TRIGGER proje_sections_updated_at BEFORE UPDATE ON public.proje_sections
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- JSONB DATA TABLOLARI (id TEXT — uygulama uuid üretir)
-- Ortak yapı: id TEXT PK, data JSONB, created_at, updated_at
-- İlişkiler uygulama katmanında yönetilir (JSONB içinde).
-- ============================================================

-- ─── 8. ALET_ITEMS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alet_items (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alet_items_created_at_idx ON public.alet_items (created_at);

ALTER TABLE public.alet_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alet_items_anon_all"  ON public.alet_items;
CREATE POLICY "alet_items_anon_all"  ON public.alet_items FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "alet_items_auth_all"  ON public.alet_items;
CREATE POLICY "alet_items_auth_all"  ON public.alet_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alet_items TO anon, authenticated;

DROP TRIGGER IF EXISTS alet_items_updated_at ON public.alet_items;
CREATE TRIGGER alet_items_updated_at BEFORE UPDATE ON public.alet_items
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 9. SAHA_PANELS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saha_panels (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saha_panels_created_at_idx ON public.saha_panels (created_at);

ALTER TABLE public.saha_panels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_panels_anon_all"  ON public.saha_panels;
CREATE POLICY "saha_panels_anon_all"  ON public.saha_panels FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "saha_panels_auth_all"  ON public.saha_panels;
CREATE POLICY "saha_panels_auth_all"  ON public.saha_panels FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saha_panels TO anon, authenticated;

DROP TRIGGER IF EXISTS saha_panels_updated_at ON public.saha_panels;
CREATE TRIGGER saha_panels_updated_at BEFORE UPDATE ON public.saha_panels
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 10. SAHA_LINES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saha_lines (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saha_lines_created_at_idx ON public.saha_lines (created_at);

ALTER TABLE public.saha_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_lines_anon_all"  ON public.saha_lines;
CREATE POLICY "saha_lines_anon_all"  ON public.saha_lines FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "saha_lines_auth_all"  ON public.saha_lines;
CREATE POLICY "saha_lines_auth_all"  ON public.saha_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saha_lines TO anon, authenticated;

DROP TRIGGER IF EXISTS saha_lines_updated_at ON public.saha_lines;
CREATE TRIGGER saha_lines_updated_at BEFORE UPDATE ON public.saha_lines
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 11. SAHA_SOCKETS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saha_sockets (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saha_sockets_created_at_idx ON public.saha_sockets (created_at);

ALTER TABLE public.saha_sockets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_sockets_anon_all"  ON public.saha_sockets;
CREATE POLICY "saha_sockets_anon_all"  ON public.saha_sockets FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "saha_sockets_auth_all"  ON public.saha_sockets;
CREATE POLICY "saha_sockets_auth_all"  ON public.saha_sockets FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saha_sockets TO anon, authenticated;

DROP TRIGGER IF EXISTS saha_sockets_updated_at ON public.saha_sockets;
CREATE TRIGGER saha_sockets_updated_at BEFORE UPDATE ON public.saha_sockets
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 12. RAPOR_ENTRIES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rapor_entries (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rapor_entries_created_at_idx ON public.rapor_entries (created_at);

ALTER TABLE public.rapor_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rapor_entries_anon_all"  ON public.rapor_entries;
CREATE POLICY "rapor_entries_anon_all"  ON public.rapor_entries FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rapor_entries_auth_all"  ON public.rapor_entries;
CREATE POLICY "rapor_entries_auth_all"  ON public.rapor_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rapor_entries TO anon, authenticated;

DROP TRIGGER IF EXISTS rapor_entries_updated_at ON public.rapor_entries;
CREATE TRIGGER rapor_entries_updated_at BEFORE UPDATE ON public.rapor_entries
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 13. GECICI_LIB ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gecici_lib (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gecici_lib_created_at_idx ON public.gecici_lib (created_at);

ALTER TABLE public.gecici_lib ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gecici_lib_anon_all"  ON public.gecici_lib;
CREATE POLICY "gecici_lib_anon_all"  ON public.gecici_lib FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "gecici_lib_auth_all"  ON public.gecici_lib;
CREATE POLICY "gecici_lib_auth_all"  ON public.gecici_lib FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gecici_lib TO anon, authenticated;

DROP TRIGGER IF EXISTS gecici_lib_updated_at ON public.gecici_lib;
CREATE TRIGGER gecici_lib_updated_at BEFORE UPDATE ON public.gecici_lib
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 14. GECICI_MOVES ──────────────────────────────────────
-- Not: libId (gecici_lib.id referansı) JSONB data içindedir.
CREATE TABLE IF NOT EXISTS public.gecici_moves (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gecici_moves_created_at_idx ON public.gecici_moves (created_at);
-- libId'ye göre hızlı arama için JSONB index
CREATE INDEX IF NOT EXISTS gecici_moves_lib_id_idx ON public.gecici_moves ((data->>'libId'));

ALTER TABLE public.gecici_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gecici_moves_anon_all"  ON public.gecici_moves;
CREATE POLICY "gecici_moves_anon_all"  ON public.gecici_moves FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "gecici_moves_auth_all"  ON public.gecici_moves;
CREATE POLICY "gecici_moves_auth_all"  ON public.gecici_moves FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gecici_moves TO anon, authenticated;

DROP TRIGGER IF EXISTS gecici_moves_updated_at ON public.gecici_moves;
CREATE TRIGGER gecici_moves_updated_at BEFORE UPDATE ON public.gecici_moves
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 15. GECICI_ORDERS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gecici_orders (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gecici_orders_created_at_idx ON public.gecici_orders (created_at);

ALTER TABLE public.gecici_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gecici_orders_anon_all"  ON public.gecici_orders;
CREATE POLICY "gecici_orders_anon_all"  ON public.gecici_orders FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "gecici_orders_auth_all"  ON public.gecici_orders;
CREATE POLICY "gecici_orders_auth_all"  ON public.gecici_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gecici_orders TO anon, authenticated;

DROP TRIGGER IF EXISTS gecici_orders_updated_at ON public.gecici_orders;
CREATE TRIGGER gecici_orders_updated_at BEFORE UPDATE ON public.gecici_orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 16. PROJE_SARTNAMES ───────────────────────────────────
-- Not: bina + section + code kombinasyonu unique olmak zorunda
--      (bina="00UYB", section="Tava", code="AKU.0179...").
--      Kontrol uygulama katmanında yapılır.
CREATE TABLE IF NOT EXISTS public.proje_sartnames (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_sartnames_created_at_idx ON public.proje_sartnames (created_at);
CREATE INDEX IF NOT EXISTS proje_sartnames_bina_idx       ON public.proje_sartnames ((data->>'bina'));
CREATE INDEX IF NOT EXISTS proje_sartnames_section_idx    ON public.proje_sartnames ((data->>'section'));

ALTER TABLE public.proje_sartnames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_sartnames_anon_all"  ON public.proje_sartnames;
CREATE POLICY "proje_sartnames_anon_all"  ON public.proje_sartnames FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_sartnames_auth_all"  ON public.proje_sartnames;
CREATE POLICY "proje_sartnames_auth_all"  ON public.proje_sartnames FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_sartnames TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_sartnames_updated_at ON public.proje_sartnames;
CREATE TRIGGER proje_sartnames_updated_at BEFORE UPDATE ON public.proje_sartnames
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 17. PROJE_MATERIALS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proje_materials (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_materials_created_at_idx ON public.proje_materials (created_at);
CREATE INDEX IF NOT EXISTS proje_materials_code_idx       ON public.proje_materials ((data->>'code'));
CREATE INDEX IF NOT EXISTS proje_materials_cat_idx        ON public.proje_materials ((data->>'cat'));

ALTER TABLE public.proje_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_materials_anon_all"  ON public.proje_materials;
CREATE POLICY "proje_materials_anon_all"  ON public.proje_materials FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_materials_auth_all"  ON public.proje_materials;
CREATE POLICY "proje_materials_auth_all"  ON public.proje_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_materials TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_materials_updated_at ON public.proje_materials;
CREATE TRIGGER proje_materials_updated_at BEFORE UPDATE ON public.proje_materials
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 18. PROJE_SPECS ───────────────────────────────────────
-- Not: matId (proje_materials.id referansı) JSONB data içindedir.
CREATE TABLE IF NOT EXISTS public.proje_specs (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_specs_created_at_idx ON public.proje_specs (created_at);
CREATE INDEX IF NOT EXISTS proje_specs_bina_idx       ON public.proje_specs ((data->>'bina'));
CREATE INDEX IF NOT EXISTS proje_specs_cat_idx        ON public.proje_specs ((data->>'cat'));
CREATE INDEX IF NOT EXISTS proje_specs_grup_idx       ON public.proje_specs ((data->>'grup'));

ALTER TABLE public.proje_specs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_specs_anon_all"  ON public.proje_specs;
CREATE POLICY "proje_specs_anon_all"  ON public.proje_specs FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_specs_auth_all"  ON public.proje_specs;
CREATE POLICY "proje_specs_auth_all"  ON public.proje_specs FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_specs TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_specs_updated_at ON public.proje_specs;
CREATE TRIGGER proje_specs_updated_at BEFORE UPDATE ON public.proje_specs
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 19. PROJE_ITEMS ───────────────────────────────────────
-- Not: specId (proje_specs.id) ve orderId (proje_orders.id) JSONB içindedir.
CREATE TABLE IF NOT EXISTS public.proje_items (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_items_created_at_idx ON public.proje_items (created_at);
CREATE INDEX IF NOT EXISTS proje_items_bina_idx       ON public.proje_items ((data->>'bina'));
CREATE INDEX IF NOT EXISTS proje_items_spec_id_idx    ON public.proje_items ((data->>'specId'));
CREATE INDEX IF NOT EXISTS proje_items_order_id_idx   ON public.proje_items ((data->>'orderId'));

ALTER TABLE public.proje_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_items_anon_all"  ON public.proje_items;
CREATE POLICY "proje_items_anon_all"  ON public.proje_items FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_items_auth_all"  ON public.proje_items;
CREATE POLICY "proje_items_auth_all"  ON public.proje_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_items TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_items_updated_at ON public.proje_items;
CREATE TRIGGER proje_items_updated_at BEFORE UPDATE ON public.proje_items
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 20. PROJE_ORDERS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proje_orders (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_orders_created_at_idx ON public.proje_orders (created_at);
CREATE INDEX IF NOT EXISTS proje_orders_bina_idx       ON public.proje_orders ((data->>'bina'));

ALTER TABLE public.proje_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_orders_anon_all"  ON public.proje_orders;
CREATE POLICY "proje_orders_anon_all"  ON public.proje_orders FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_orders_auth_all"  ON public.proje_orders;
CREATE POLICY "proje_orders_auth_all"  ON public.proje_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_orders TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_orders_updated_at ON public.proje_orders;
CREATE TRIGGER proje_orders_updated_at BEFORE UPDATE ON public.proje_orders
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─── 21. PROJE_ALTERNATIVES ────────────────────────────────
-- Her şartname ürünü için alternatif ürün önerileri ve onay süreci
CREATE TABLE IF NOT EXISTS public.proje_alternatives (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proje_alternatives_created_at_idx ON public.proje_alternatives (created_at);
CREATE INDEX IF NOT EXISTS proje_alternatives_spec_id_idx    ON public.proje_alternatives ((data->>'specId'));
CREATE INDEX IF NOT EXISTS proje_alternatives_status_idx     ON public.proje_alternatives ((data->>'status'));

ALTER TABLE public.proje_alternatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proje_alternatives_anon_all"  ON public.proje_alternatives;
CREATE POLICY "proje_alternatives_anon_all"  ON public.proje_alternatives FOR ALL TO anon        USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "proje_alternatives_auth_all"  ON public.proje_alternatives;
CREATE POLICY "proje_alternatives_auth_all"  ON public.proje_alternatives FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proje_alternatives TO anon, authenticated;

DROP TRIGGER IF EXISTS proje_alternatives_updated_at ON public.proje_alternatives;
CREATE TRIGGER proje_alternatives_updated_at BEFORE UPDATE ON public.proje_alternatives
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ============================================================
-- DOĞRULAMA: Tüm tablolar oluştu mu?
-- Bu sorguyu çalıştırarak kontrol edebilirsiniz:
--
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
--
-- Beklenen sonuç (21 tablo):
--   alet_items, app_settings, audit_log, gecici_lib,
--   gecici_moves, gecici_orders, proje_alternatives,
--   proje_buildings, proje_items, proje_materials,
--   proje_orders, proje_sartnames, proje_sections,
--   proje_specs, rapor_ekipler, rapor_entries, saha_lines,
--   saha_panels, saha_settings, saha_sockets, users
-- ============================================================
