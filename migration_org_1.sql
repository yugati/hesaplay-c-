-- ═══════════════════════════════════════════════════════════════════════════
-- ORGANİZASYON (ÇOK KİRACILI YAPI) — AŞAMA 1 / EKLEME
--
-- NE YAPAR: Her tabloya org_id sütunu ekler, mevcut TÜM veriyi 'bykara'
-- organizasyonuna atar, organizations tablosunu kurar ve org bazlı benzersizlik
-- indekslerini AÇAR.
--
-- NE YAPMAZ: Hiçbir şeyi silmez, hiçbir mevcut kısıtı kaldırmaz, hiçbir satırın
-- verisini değiştirmez. Bu dosya ÇALIŞTIRILDIKTAN SONRA uygulama bugünkü kodla
-- HİÇBİR DEĞİŞİKLİK OLMADAN çalışmaya devam eder — sütun eklenmiştir ama kimse
-- ona bakmaz, varsayılanı 'bykara' olduğu için yeni kayıtlar da doğru yere düşer.
-- Bu bilinçli: sunucu kodu henüz org filtresi uygulamıyor ve bu dosyanın
-- çalıştırılmasıyla kodun yayına alınması arasındaki pencerede sistem sağlam kalmalı.
--
-- SIRA:
--   1) BU DOSYA  -> Supabase SQL Editor'da çalıştırılır (şimdi)
--   2) Sunucu + istemci kodu yayına alınır (org_id artık okunur/yazılır)
--   3) migration_org_2.sql -> eski GLOBAL benzersizlik kısıtları kaldırılır,
--      org_id varsayılanı düşürülür (kod artık her zaman açıkça yazdığı için)
--
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- ⚠ İLERİDE YENİ BİR TABLO KURARSANIZ: bu dosya ve migration_org_2.sql'i
-- TEKRAR çalıştırın. Aşağıdaki döngüler var olmayan tabloyu "atlandi (tablo yok)"
-- diyerek geçer — o tablo sonradan kurulursa org_id sütunu OLMAZ ve /api/veri
-- onu sorgularken hata verir. İkisi de tekrar çalıştırılabilir, zararı yoktur.
-- Bugün bu durumda olan tablo: tutanaklar (migration_tutanak.sql henüz
-- çalıştırılmamış, tablo veritabanında yok).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. ORGANIZATIONS — kiracı listesi
--    Uygulamanın diğer tabloları gibi id + data deseninde.
--    data: {ad}  — id ise insan okur bir kısaltmadır ('bykara'); dosya
--    yollarında ve kayıtlarda göründüğü için UUID değil, okunur bir anahtar.
--
--    DİKKAT: bu tablo BİLEREK /api/veri beyaz listesine girmeyecek. Organizasyon
--    oluşturma/düzenleme yalnızca süper yöneticiye açık ayrı bir uçtan yapılır;
--    aksi halde herhangi bir kullanıcı kendi kiracı kaydını değiştirebilirdi.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  aktif       BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Kapı kapalı doğsun: anon/authenticated bu tabloyu hiç görmez (bkz. asama3_anon_kapat.sql).
-- service_role RLS'i atladığı için /api/* erişimi etkilenmez.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations FROM anon, authenticated;

-- Bugünkü tek kiracı. Mevcut tüm verinin sahibi budur.
INSERT INTO public.organizations (id, data)
VALUES ('bykara', '{"ad":"BYKARA"}'::jsonb)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 2. org_id SÜTUNU — 27 veri tablosunun tamamına
--
--    NOT NULL DEFAULT 'bykara': mevcut satırların hepsi tek hamlede BYKARA'ya
--    yazılır. PostgreSQL 11+ bu işlemi tabloyu yeniden yazmadan yapar, büyük
--    tablolarda bile anlıktır.
--
--    Varsayılan GEÇİCİDİR. Aşama 3'te düşürülecek: kalıcı bir varsayılan,
--    org_id yazmayı unutan bir hatanın veriyi sessizce BYKARA'ya doldurması
--    demektir. Kod her zaman açıkça yazmaya başladığında varsayılan gider.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  -- id + data desenindeki varlık tabloları (api/veri.js VARLIK_TABLOLARI ile aynı liste)
  varlik TEXT[] := ARRAY[
    'companies','tutanaklar','alet_items','alet_lib',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_lib','gecici_moves','gecici_orders',
    'proje_sartnames','proje_materials','proje_specs','proje_items',
    'proje_orders','proje_alternatives','proje_bina_modelleri','proje_lokasyonlar',
    'gunluk_isler','ihtiyac_listeleri','audit_log'
  ];
  -- anahtar/değer ve basit liste tabloları (api/veri.js DIGER_TABLOLAR)
  diger TEXT[] := ARRAY['app_settings','saha_settings','rapor_ekipler','proje_buildings','proje_sections'];
BEGIN
  FOREACH t IN ARRAY (varlik || diger) LOOP
    -- migration'ı henüz çalıştırılmamış tablolar (tutanaklar, alet_lib, gunluk_isler,
    -- ihtiyac_listeleri, proje_lokasyonlar) atlanır — dosya yine de sonuna kadar çalışır.
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'atlandi (tablo yok): %', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT %L', t, 'bykara');
    RAISE NOTICE 'org_id eklendi: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. ORG BAZLI BENZERSİZLİK — varlık tabloları
--
--    Bugün id tek başına PRIMARY KEY. Bu, iki kiracının aynı id'yi üretmesi
--    durumunda upsert'in KARŞI KİRACININ satırını ezmesi demek (id üreteci
--    index.html:3188 uid() — zaman damgası + 5 rastgele karakter; çakışma
--    ihtimali çok düşük ama sonucu sessiz veri bozulması).
--
--    Doğru anahtar (org_id, id). Burada YALNIZCA ekleniyor; eski id PK'sı
--    Aşama 3'te kaldırılıp yerini bu alacak. İkisi bir arada durabilir.
--
--    Ayrıca (org_id, created_at, id) indeksi: artımlı yükleme tam olarak bu
--    sırayla sayfalıyor (src/supabase.js sbGetAll). Org filtresi eklendiğinde
--    bu indeks olmasa her açılış tam tablo taramasına dönerdi.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  varlik TEXT[] := ARRAY[
    'companies','tutanaklar','alet_items','alet_lib',
    'saha_panels','saha_lines','saha_sockets',
    'rapor_entries','gecici_lib','gecici_moves','gecici_orders',
    'proje_sartnames','proje_materials','proje_specs','proje_items',
    'proje_orders','proje_alternatives','proje_bina_modelleri','proje_lokasyonlar',
    'gunluk_isler','ihtiyac_listeleri','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY varlik LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (org_id, id)', t || '_org_id_uidx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id, created_at, id)', t || '_org_created_idx', t);
    RAISE NOTICE 'indeksler kuruldu: %', t;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 4. ORG BAZLI BENZERSİZLİK — anahtar/ad taşıyan tablolar
--
--    Bunlar çakışması KESİN olanlar: her organizasyonun 'binaGiris' ayarı,
--    kendi '00UYB' binası, kendi 'Ekip 1' kaydı olacak. Bugünkü global
--    UNIQUE kısıtları ikinci kiracının bu satırları yazmasını engeller.
--    Eski kısıtlar Aşama 3'te kaldırılır — bunlar o zaman devralır.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_org_key_uidx     ON public.app_settings     (org_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS saha_settings_org_key_uidx    ON public.saha_settings    (org_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS rapor_ekipler_org_name_uidx   ON public.rapor_ekipler    (org_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS proje_buildings_org_code_uidx ON public.proje_buildings  (org_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS proje_sections_org_name_uidx  ON public.proje_sections   (org_id, name);

-- Bina ve bölüm listeleri sort_order ile sıralı çekiliyor (src/supabase.js SIRA_BINA)
CREATE INDEX IF NOT EXISTS proje_buildings_org_sort_idx  ON public.proje_buildings (org_id, sort_order);
CREATE INDEX IF NOT EXISTS proje_sections_org_sort_idx   ON public.proje_sections  (org_id, sort_order);
CREATE INDEX IF NOT EXISTS rapor_ekipler_org_created_idx ON public.rapor_ekipler   (org_id, created_at);


-- ─────────────────────────────────────────────────────────────
-- 5. KULLANICILAR — org_id + süper yönetici
--
--    org_id: her kullanıcı TEK organizasyona aittir (alınan karar).
--
--    is_super: organizasyonlar arası geçiş yetkisi. Neden yeni bir rol DEĞİL?
--    Çünkü kodun her yerinde role==='admin' kontrolü var (index.html:3027
--    isAdmin, lib/auth.js:50 requireAdmin). Rolü 'super_admin' yapmak bunların
--    hepsini kırardı. Ayrı bayrak, mevcut rol sistemine hiç dokunmaz.
--
--    username GLOBAL BENZERSİZ KALIR — giriş akışı (api/login.js) değişmez.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS org_id   TEXT    NOT NULL DEFAULT 'bykara';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_super BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS users_org_idx ON public.users (org_id);

-- ! KENDİ HESABINIZ: aşağıdaki satır 'admin' kullanıcısını süper yönetici yapar.
-- Sizin hesabınızın adı farklıysa 'admin' yerine onu yazın. Bu bayrağı taşımayan
-- hiç kimse organizasyon değiştirici düğmeyi göremez.
UPDATE public.users SET is_super = true WHERE lower(username) = 'admin';


-- ═══════════════════════════════════════════════════════════════════════════
-- DOĞRULAMA — aşağıdakileri çalıştırıp sonuçları kontrol edin.
--
-- a) org_id sütunu kaç tabloya eklendi? (users dahil 28 beklenir; henüz
--    kurulmamış migration tablolarınız varsa o kadar eksik olur)
--
--    SELECT count(*) FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='org_id';
--
-- b) Org dışında kalan satır var mı? (hepsi 0 dönmeli)
--
--    SELECT 'proje_items' t, count(*) FROM public.proje_items WHERE org_id <> 'bykara'
--    UNION ALL SELECT 'app_settings', count(*) FROM public.app_settings WHERE org_id <> 'bykara'
--    UNION ALL SELECT 'users',        count(*) FROM public.users        WHERE org_id <> 'bykara';
--
-- c) Süper yönetici kim oldu? (yalnızca sizin hesabınız true görünmeli)
--
--    SELECT username, role, org_id, is_super FROM public.users ORDER BY username;
--
-- d) Organizasyon kaydı yerinde mi?
--
--    SELECT * FROM public.organizations;
-- ═══════════════════════════════════════════════════════════════════════════
