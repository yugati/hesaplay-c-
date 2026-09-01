-- ═══════════════════════════════════════════════════════════════════════════
-- FATURA KONTROL — faturalar
--
-- NEDEN: Siparis kaydi "ne alindi"yi soyler; bu tablo "parasi odenen ne" sorusunu
-- yanitlar. Tedarikci ayni malzemeyi iki kez faturalayabilir (kotu niyetle ya da
-- hata ile) - o zaman sirket bir kez aldigi mala iki kez para oder. Buradaki kayit
-- her fatura satirini bir URUNE baglar, boylece "bu urunden ne kadari faturalandi,
-- ne kadari kaldi" her an olculebilir ve kalandan fazlasi yazilamaz.
--
-- FATURA URUN BAZINDADIR, SIPARIS BAZINDA DEGIL. Sahadaki gercek boyle: tedarikci
-- faturayi siparis/irsaliye numarasina gore kesmiyor, "su urunden su kadar" diye
-- genel kesiyor ve miktar o urunun TOPLAM alimindan dusuluyor. Bu yuzden satirda
-- orderId YOKTUR - olmayan bir bagi uydurmak, raporlarda dogru gorunen ama
-- gercekle ilgisi olmayan sayilar uretirdi.
--
-- Kayit bicimi diger varlik tablolariyla aynidir (id + JSONB data) ve alanlar
-- TC e-Faturasindaki basliklarla birebir eslesir:
--   { id, no, tarih:<ms>, companyId, company,
--     durum:'taslak|kesin|kilitli', kesinTs, kesinBy, kilitTs, kilitBy,
--     senaryo, faturaTipi, ozellestirmeNo, ettn, irsaliyeNo, irsaliyeTarihi:<ms|null>,
--     paraBirimi, kur, beyanTutar, not, pdf:{path,name,size}|null,
--     satirlar:[{ id, key, matId, code, ad, unit,
--                 qty, fiyat, iskontoOrani, kdvOrani, digerVergi }],
--     olusturan, olusturmaTs, guncelleyen, guncellemeTs, history:[] }
--
-- TOPLAMLAR KAYITTA TUTULMAZ, satirlardan hesaplanir (index.html fatToplamlar):
--   mal hizmet tutari = miktar x birim fiyat
--   iskonto = tutar x iskonto orani ; matrah = tutar - iskonto
--   KDV = matrah x KDV orani ; satir toplami = matrah + KDV + diger vergiler
-- Iki yerde tutulan bir toplam er gec ayrisir; tek dogru kaynak satirlardir.
-- 'beyanTutar' AYRI bir seydir: BELGEDE yazan odenecek tutardir ve hesaplananla
-- karsilastirilir - tutmuyorsa ya satir eksik girilmistir ya da belgenin kendi
-- aritmetigi hatalidir; ikisi de gorulmelidir.
--
-- ETTN e-faturanin evrensel tekil numarasidir: ayni ETTN iki kayitta geciyorsa
-- belge kesinlikle ikinci kez girilmistir (fatura no'sundan cok daha kesin kanit).
--
-- DURUM:
--   taslak  : yarim kalmis giris. MIKTAR TAVANINA SAYILMAZ - tavan hesabi
--             (index.html fatKesinler) taslaklari disarida birakir. Gerekce:
--             taslak bir belge degil, not defteridir; kalani rezerve etseydi hic
--             kesilmemis bir fatura yuzunden gercek fatura girilemez hale gelirdi.
--   kesin   : kesinlesmis fatura. Miktari tuketir, mutabakata girer.
--   kilitli : kesinlesmis VE kapatilmis. Duzenlenemez/silinemez; kilidi yalnizca
--             yonetici acar. Mutabakati biten donem sonradan oynamasin diye.
--   Alan YOKSA 'kesin' sayilir: sonradan eklendi, yoklugu taslak anlamina
--   gelmemeli - gelseydi mevcut faturalar bir anda tavandan dusulurdu.
--
-- 'key' URUN ANAHTARIDIR: once kutuphane malzemesi ('mat:<matId>'), kutuphanede
-- karsiligi yoksa 'ad:<kod>|<ad>'. Urunu cozen kural uygulamanin kendi kuralidir
-- (index.html lineAlimMaterial): ALTERNATIFLE alinan mal faturada yazan urune
-- sayilir - malzeme kunyesindeki "Siparis" kutusuyla ayni hesap, boylece iki ekran
-- daima ayni sayiyi verir.
--
-- TUTAR/FIYAT OPSIYONELDIR: kontrolun omurgasi MIKTARDIR ("birebir olmali").
-- Fiyat yalnizca bilgi amaclidir, hicbir tavan hesabina girmez.
--
-- Supabase Dashboard > SQL Editor'da BIR KEZ calistirin. Tekrar calistirmak
-- zararsizdir (IF NOT EXISTS / DROP ... IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.faturalar (
  id          TEXT        NOT NULL PRIMARY KEY,
  data        JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS faturalar_created_at_idx ON public.faturalar (created_at);
-- en sik suzulen alanlar: "bu firmanin faturalari", "bu numarali fatura zaten var mi"
CREATE INDEX IF NOT EXISTS faturalar_no_idx         ON public.faturalar ((data->>'no'));
CREATE INDEX IF NOT EXISTS faturalar_company_idx    ON public.faturalar ((data->>'companyId'));
CREATE INDEX IF NOT EXISTS faturalar_ettn_idx       ON public.faturalar ((data->>'ettn'));
CREATE INDEX IF NOT EXISTS faturalar_durum_idx      ON public.faturalar ((data->>'durum'));

-- Asama 3 durusu: RLS acik, anon/authenticated'a HICBIR yetki yok.
-- Veriye tek yol sunucudaki service_role'dur (api/veri.js).
ALTER TABLE public.faturalar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "faturalar_anon_all" ON public.faturalar;
DROP POLICY IF EXISTS "faturalar_auth_all" ON public.faturalar;
REVOKE ALL ON public.faturalar FROM anon, authenticated;

-- ORGANIZASYON (cok kiracili yapi): diger varlik tablolariyla ayni desen. Indeks
-- ADLARI migration_org_1.sql'deki uretimle BIREBIR aynidir (<tablo>_org_id_uidx /
-- <tablo>_org_created_idx) - o dosya sonradan bu tabloyu de listesine alirsa ayni
-- indeksi ikinci kez kurmaya calismaz.
-- (org_id, created_at, id): artimli yukleme tam bu sirayla sayfaliyor
-- (src/supabase.js sbGetAll) - indeks olmasa her acilis tam tablo taramasi olurdu.
ALTER TABLE public.faturalar ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'bykara';
CREATE INDEX IF NOT EXISTS faturalar_org_idx ON public.faturalar (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS faturalar_org_id_uidx   ON public.faturalar (org_id, id);
CREATE INDEX IF NOT EXISTS faturalar_org_created_idx ON public.faturalar (org_id, created_at, id);

-- set_updated_at() supabase_schema.sql'in en basinda tanimlidir; bu dosyayi tek
-- basina calistiriyorsaniz asagidaki blok fonksiyonu garanti eder.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS faturalar_updated_at ON public.faturalar;
CREATE TRIGGER faturalar_updated_at BEFORE UPDATE ON public.faturalar
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- DOGRULAMA: asagidaki sorgu hicbir satir dondurmemeli
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'faturalar'
  AND grantee IN ('anon', 'authenticated');
