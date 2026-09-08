-- ═══════════════════════════════════════════════════════════════════════════
-- KULLANICI PROFİLİ — telefon / e-posta / meslek
--
-- NE YAPAR: public.users tablosuna üç opsiyonel metin sütunu ekler. Amaç:
-- belgelerde ("oluşturan") görünen kişinin iletişim/unvan bilgisinin artık
-- Kullanıcı Yönetimi ekranından tek yerden girilip her yerde okunabilmesi.
--
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tel     TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email   TEXT NOT NULL DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS meslek  TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.users.tel    IS 'Telefon numarasi - opsiyonel';
COMMENT ON COLUMN public.users.email  IS 'E-posta adresi - opsiyonel';
COMMENT ON COLUMN public.users.meslek IS 'Meslek / unvan (orn. Saha Muhendisi) - opsiyonel';
