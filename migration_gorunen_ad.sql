-- ═══════════════════════════════════════════════════════════════════════════
-- GÖRÜNEN AD — kullanıcının kendi değiştirebildiği ad
--
-- NE YAPAR: public.users tablosuna 'ad' sütunu ekler.
--
-- NEDEN AYRI BİR SÜTUN: username GİRİŞ ADIDIR ve aynı zamanda KİMLİK
-- ANAHTARIDIR — geçmiş kayıtların içine metin olarak yazılmıştır
-- (rapor/ihtiyaç/fatura/tutanak kayıtlarındaki createdBy ve olusturan alanları),
-- ekip ataması ona göre tutulur (app_settings > userEkip anahtarı) ve
-- "kendi kaydını düzenleyebilir" kuralı onu karşılaştırır (index.html rOwnEntry).
-- username değiştirilseydi bunların hepsi kopar, kişi geçmiş kayıtlarında
-- bir yabancıya dönerdi. Bu yüzden giriş adı SABİT kalır; kullanıcı serbestçe
-- değiştirdiği 'ad' alanı yalnızca GÖSTERİMDE kullanılır (index.html kisiAd) —
-- eski kayıtlar eski ada bağlı kalır ama ekranda yeni adla görünür.
--
-- Boş bırakılırsa her yerde username gösterilmeye devam eder.
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ad TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.users.ad IS 'Gorunen ad - ekranlarda ve ciktilarda kullanici adi yerine gosterilir; giris adi (username) degismez';
