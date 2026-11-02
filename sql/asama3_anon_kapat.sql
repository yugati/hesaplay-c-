-- ═══════════════════════════════════════════════════════════════════════════
-- AŞAMA 3 — ARKA KAPIYI KAPAT
--
-- SORUN: supabase_schema.sql her veri tablosuna şu politikayı koyuyordu:
--     CREATE POLICY "<tablo>_anon_all" ON <tablo> FOR ALL TO anon USING (true)
--     GRANT SELECT, INSERT, UPDATE, DELETE ON <tablo> TO anon
--   Ve anon anahtarı derlemede tarayıcı paketine gömülüyordu. Sonuç: siteyi açan
--   herkes GİRİŞ YAPMADAN tüm proje verisini okuyabiliyor, yazabiliyor, SİLEBİLİYORDU.
--
-- ÖN KOŞUL (tamamlandı): uygulama artık anon anahtarını hiç kullanmıyor.
--   - Veri  → /api/veri   (oturum + modül yetkisi, sunucuda service_role ile)
--   - Dosya → /api/dosya  (imzalı adres; dosya doğrudan Storage'a gider)
--   - Tarayıcı paketinde Supabase istemcisi ve anahtarı YOK (src/supabase.js).
--   Bu dosyayı çalıştırmadan ÖNCE o sürümün canlıda olduğundan emin olun.
--
-- ETKİSİ: service_role RLS'i zaten atlar, uygulama etkilenmez. Etkilenen tek şey
--   anon/authenticated rolleriyle DOĞRUDAN erişimdir — kapanan da tam olarak odur.
--
-- GERİ ALMA: en altta yorumlu blok var (kullanmayın; kapıyı geri açar).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  tablolar TEXT[] := ARRAY[
    'app_settings','audit_log','saha_settings','rapor_ekipler',
    'proje_buildings','proje_sections','alet_items',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries','tutanaklar',
    'gecici_lib','gecici_moves','gecici_orders',
    'proje_sartnames','proje_materials','proje_specs','proje_items',
    'proje_orders','proje_alternatives','proje_bina_modelleri',
    'proje_lokasyonlar','companies'
  ];
BEGIN
  FOREACH t IN ARRAY tablolar LOOP
    -- tablo yoksa (ör. tutanaklar migration'ı çalıştırılmamışsa) atla
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;

    -- 1) "herkese açık" politikaları kaldır
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_anon_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_auth_all', t);

    -- 2) tablo yetkilerini geri al
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);

    -- 3) RLS açık kalsın: politika kalmadığı için anon/authenticated hiçbir satırı
    --    göremez; service_role RLS'i atladığı için uygulama etkilenmez.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    RAISE NOTICE 'kapatildi: %', t;
  END LOOP;
END $$;

-- Şema düzeyindeki toplu yetkiler de geri alınır (ileride eklenen tablolar
-- kazara açık gelmesin diye). Şemayı görme (USAGE) izni kalır - PostgREST'in
-- anlamlı hata dönebilmesi için gerekli.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- ── DOĞRULAMA ──────────────────────────────────────────────────────────────
-- Aşağıdaki iki sorgu hiçbir satır döndürmemeli.
-- 1) anon/authenticated'a kalan tablo yetkisi:
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
ORDER BY table_name;

-- 2) anon/authenticated'a açık kalan politika:
SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public' AND (roles::text LIKE '%anon%' OR roles::text LIKE '%authenticated%')
ORDER BY tablename;

-- ═══════════════════════════════════════════════════════════════════════════
-- GERİ ALMA (kapıyı yeniden açar - normalde ÇALIŞTIRMAYIN):
--
-- DO $$
-- DECLARE t TEXT;
-- BEGIN
--   FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'users' LOOP
--     EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
--     EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)', t||'_anon_all', t);
--   END LOOP;
-- END $$;
-- ═══════════════════════════════════════════════════════════════════════════
