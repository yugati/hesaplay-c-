-- ═══════════════════════════════════════════════════════════════════════════
-- OTURUM SÜRÜMÜ — "diğer tüm oturumları kapat" özelliği
--
-- NE YAPAR: public.users tablosuna 'oturum_surumu' sayacı ekler.
--
-- NEDEN: Oturum tokeni imzalı bir JWT'dir; sunucuda "iptal edilecek" bir oturum
-- kaydı yoktur, yani bir token süresi dolana kadar (1 saat / "beni hatırla" ile
-- 30 gün) geçerli kalır. Kayıp telefon ya da açık unutulan bir bilgisayar için
-- kullanıcının "her yerden çıkış" yapabilmesi gerekir.
--
-- NASIL ÇALIŞIR: her token, imzalandığı andaki sayacı ('sv') taşır. Kullanıcı
-- Hesabım ekranından "Diğer tüm oturumları kapat"a basınca sayaç 1 artar ve
-- BU cihaza yeni sayaçlı taze bir token verilir; eski sayaçlı bütün tokenler
-- (diğer cihazlar/tarayıcılar) bir sonraki isteklerinde reddedilir. Sunucu
-- fonksiyonları sayacı ~30 sn önbellekleyerek okur, yani kapatma en geç o
-- kadar sonra etkili olur.
--
-- GERİYE UYUM: sayaç 0'dan başlar; bu sütun eklenmeden önce imzalanmış
-- tokenlerin 'sv' alanı yoktur ve 0 sayılır — yani bu SQL çalıştırıldığında
-- hiç kimse çıkış yemez. Sütun HENÜZ EKLENMEMİŞSE sunucu kontrolü sessizce
-- atlar (giriş kırılmaz); yalnızca Hesabım'daki düğme "veritabanı güncellemesi
-- gerekli" uyarısı verir.
--
-- Tekrar çalıştırmak güvenlidir (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS oturum_surumu INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.users.oturum_surumu IS 'Oturum sayaci - "diger tum oturumlari kapat" ile artar; tokendeki sv bundan kucukse token reddedilir';
