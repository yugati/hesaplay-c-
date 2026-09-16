import { supabaseAdmin } from './supabaseAdmin.js'

// ─────────────────────────────────────────────────────────────────────────────
// TASARI (PROJE KATMANI) - SUNUCU TARAFI ORTAK PARCALAR
//
// Tasari, ORGANIZASYONUN ALTINDAKI ikinci katmandir: bir organizasyon birden
// cok projeyi ('tasari') yurutur ve is verisi her zaman TEK bir tasariya aittir.
//
// TEK KURAL - lib/org.js ile birebir ayni: aktif tasari HER ZAMAN oturum
// tokeninden gelir, istek govdesinden ASLA. Istemci bir yerde tasari_id
// gonderirse yok sayilir/ezilir. Aksi halde herhangi bir kullanici govdeyi
// degistirip baska projenin verisini okuyabilir ya da oraya yazabilirdi.
//
// Tasari degistirme tokeni YENIDEN IMZALAR (bkz. api/org.js op:'tasariGecis');
// yani "hangi tasaridayim" sorusunun tek cevabi imzali tokendir.
//
// ORG'DAN AYRILDIGI TEK NOKTA - KIM GECEBILIR:
//   Organizasyon degistirmek SUPER YONETICIYE ozeldir (users.is_super).
//   Tasari degistirmek ORGANIZASYONDAKI HERKESE aciktir (alinan karar).
//   Gerekce: tasari secimi bir YETKI SINIRI degil, bir GEZINTI hareketidir.
//   Modul yetkileri (sections / permissions) her tasarida aynen uygulanir -
//   rapor yetkisi olmayan kisi hicbir tasarida rapor goremez.
//   Sinir yine de vardir: gecilen tasari KENDI ORGANIZASYONUNDA olmali
//   (bkz. tasariKullanilabilir) - baska sirketin projesine gecilemez.
// ─────────────────────────────────────────────────────────────────────────────

// Bugunku tek proje. migration_tasari_1.sql tum mevcut is verisini bu kimlige
// atadi; tasari iddiasi tasimayan ESKI tokenler de buraya duser.
export const VARSAYILAN_TASARI = 'akkuyu-ngs'

// Tasari kimligi org kimligiyle ayni daralikta: kucuk harf/rakam/tire.
// Tokende geciyor ve ileride dosya yoluna girerse hazir olsun diye dar tutuldu.
const TASARI_ID_KALIP = /^[a-z0-9][a-z0-9_-]{1,30}$/

export function tasariIdGecerli(id) {
  return typeof id === 'string' && TASARI_ID_KALIP.test(id)
}

/* ═══════════════════════════════════════════════════════════════════════════
   HANGI TABLO HANGI KATMANDA - TEK KAYNAK

   Bu iki liste, migration_tasari_1.sql'deki dizilerin birebir karsiligidir.
   BIRLIKTE DEGISIRLER: buraya bir tablo eklenip SQL'e eklenmezse, ilk yazma
   "column tasari_id does not exist" ile patlar; tersi olursa tablo sessizce
   TUM tasarilar tarafindan paylasilir - ikincisi daha tehlikelidir cunku
   gorunmez.
   ═══════════════════════════════════════════════════════════════════════════ */

/* TASARI OZEL: her tasari kendi satirlarini gorur. Okumada tasari_id'ye gore
   suzulur, yazmada satirlara ZORLA yazilir. */
export const TASARI_TABLOLARI = new Set([
  // id + data desenindeki varlik tablolari
  'tutanaklar', 'alet_items',
  'saha_panels', 'saha_lines', 'saha_sockets',
  'rapor_entries', 'gecici_moves', 'gecici_orders',
  'proje_sartnames', 'proje_specs', 'proje_items',
  'proje_orders', 'proje_alternatives', 'proje_bina_modelleri', 'proje_lokasyonlar',
  'gunluk_isler', 'ihtiyac_listeleri', 'faturalar',
  // anahtar/deger ve basit liste tablolari
  'app_settings', 'saha_settings', 'rapor_ekipler', 'proje_buildings', 'proje_sections',
])

/* ORGANIZASYON GENELI (KUTUPHANE): tasari_id sutunu YOKTUR, tum tasarilar ayni
   satirlari gorur. Bunlar KATALOGDUR, is kaydi degil - ayni malzeme her projede
   ayni stok kodunu tasir. Alinan karar: "kutuphane ortak, is verisi tasariya ozel".

   Bu kume yalnizca BELGE amaclidir; kod TASARI_TABLOLARI'na bakar. Yine de
   burada duruyor cunku bir tabloyu hangi listeye koyacagini dusunen kisinin
   ikisini de yan yana gormesi gerekir. */
export const ORTAK_TABLOLAR = new Set([
  'companies',        // Sirket/tedarikci listesi (siparis + tutanak anteti)
  'proje_materials',  // Malzeme kunyesi (stok kodu = kimlik)
  'alet_lib',         // Alet kunyesi
  'gecici_lib',       // Gecici elektrik kunyesi
  'katalog',          // Malzeme kunyesine eklenen ozellik kaydi - kaynagi ortak oldugu icin o da ortak
])

/* AYRIK DURUM - audit_log: tasari_id sutunu VARDIR ve yazilirken damgalanir,
   ama okunurken FILTRELENMEZ. Denetim kaydi organizasyon duzeyinde bir guvenlik
   defteridir: yoneticinin "kim ne yapti" sorusunun cevabi, olayin hangi projede
   gectigine gore bolunmemeli - bolunse, bir tasarida silme yapan kullanicinin
   izi baska tasarida bakan yoneticiden gizlenmis olurdu. */
export function tasariDamgalanir(table) {
  return TASARI_TABLOLARI.has(table) || table === 'audit_log'
}
export function tasariFiltrelenir(table) {
  return TASARI_TABLOLARI.has(table)
}

/* Tokendeki aktif tasari. Tasari katmanindan ONCE imzalanmis tokenlerde bu alan
   YOKTUR - o durumda null doner ve cagiran kullanici satirindan okur (asagidaki
   aktifTasari). Boylece yenilenmemis oturumlar cikis yemez; token 20 dakikada bir
   tazelenirken alan kendiliginden yerine oturur (bkz. api/me.js). */
export function tokenTasari(claims) {
  const t = claims && claims.tas
  return typeof t === 'string' && t ? t : null
}

/* Istegin calisacagi tasari. Once token, olmazsa kullanici satiri.
   NOT: api/veri.js bunu KULLANMAZ - orada yetki icin zaten kullanici satiri
   okunuyor, tasari da ayni sorgudan gelir (fazladan gidis donus olmasin diye). */
export async function aktifTasari(claims) {
  const t = tokenTasari(claims)
  if (t) return t
  const { data } = await supabaseAdmin.from('users').select('tasari_id').eq('id', claims.sub).maybeSingle()
  return (data && data.tasari_id) || VARSAYILAN_TASARI
}

/* Bir tasari var mi, askiya alinmis mi ve BU ORGANIZASYONA mi ait?
   org kontrolu burada kritiktir: tasari kimlikleri organizasyon icinde
   benzersizdir, yani iki sirketin de 'saha-2' tasarisi olabilir. org
   suzulmeseydi bir kullanici digerinin tasarisina gecebilirdi. */
export async function tasariKullanilabilir(org, id) {
  if (!tasariIdGecerli(id)) return false
  const { data } = await supabaseAdmin
    .from('tasarilar').select('id, aktif').eq('org_id', org).eq('id', id).maybeSingle()
  return !!(data && data.aktif !== false)
}

/* Bir organizasyonun ILK kullanilabilir tasarisi. Iki yerde gerekiyor:

   1) ORG DEGISTIRMEDE (api/org.js): super yonetici baska bir organizasyona
      gectiginde elindeki tasari kimligi ESKI organizasyonun projesidir ve yeni
      organizasyonda karsiligi yoktur. O tasariyla imzalanmis bir token, hicbir
      satirin eslesmedigi BOS bir uygulama demek olurdu - kullanici "veri
      kayboldu" diye bakardi. Gecis, hedef organizasyonun ilk tasarisiyla imzalar.

   2) TAZELEMEDE (api/me.js): ayni durumun 20 dakikada bir tekrarlanan hali.

   Siralama created_at: organizasyonun ILK kurdugu proje, "varsayilan proje"
   olarak en makul cevaptir. Hic tasarisi olmayan organizasyon icin null doner;
   cagiran taraf VARSAYILAN_TASARI'ya duser. */
export async function ilkTasari(org) {
  const { data } = await supabaseAdmin
    .from('tasarilar').select('id').eq('org_id', org).eq('aktif', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return (data && data.id) || null
}

/* Bir istek/oturum icin GECERLI tasariyi cozer - aktif organizasyonu dikkate alarak.

   Sira: (1) adayin (tokendeki tasari) bu organizasyonda gecerli olup olmadigi,
   (2) kullanicinin kendi varsayilan tasarisi - ama YALNIZCA kendi
   organizasyonundayken, (3) organizasyonun ilk tasarisi, (4) VARSAYILAN_TASARI.

   2. adimdaki "yalnizca kendi organizasyonundayken" kosulu onemli: super
   yonetici baska bir organizasyona gectiginde kendi varsayilan tasarisi orada
   yoktur, ona dusmek bos ekran demek olurdu. */
export async function tasariCoz(org, aday, user) {
  if (aday && await tasariKullanilabilir(org, aday)) return aday
  const ev = user && user.tasari_id
  const kendiOrgunda = user && (user.org_id || '') === org
  if (ev && kendiOrgunda && await tasariKullanilabilir(org, ev)) return ev
  return (await ilkTasari(org)) || VARSAYILAN_TASARI
}

/* YENI TASARIYA KOPYALANACAK AYAR ANAHTARLARI.

   app_settings tasari ozeldir, yani yeni tasari BOS bir ayar tablosuyla dogar.
   Bu iki grup anahtar icin bu YANLIS olur:

   1) MIGRATION BAYRAKLARI (tavaSeedV, specWipeV, matLibV...): istemci bu
      bayraklara bakip "eski veriyi tasima" rutinlerini bir kez calistiriyor.
      Bos tasarida bayraklar gorunmez, rutinler YENIDEN tetiklenir ve bos veri
      uzerinde calisip bayragi yeniden yazar. Bugun zararsiz gorunuyor (islenecek
      veri yok) ama rutinlerden biri ortak kutuphaneye (proje_materials) dokunuyorsa
      diger tasarinin kutuphanesini bozabilir. Kopyalamak bu riski bastan keser.

   2) markalar: marka listesi malzeme kunyesinin parcasidir ve kunye ORG GENELI
      ortak kaldi. Yeni tasarinin markasiz dogmasi, ortak kutuphanedeki malzemelerin
      markasini cozememesi demekti.

   Kopyalama YALNIZCA tasari kurulurken bir kez yapilir; sonrasinda iki tasarinin
   listesi bagimsizdir (bkz. api/org.js tasariKur). */
export const TASIYAN_AYARLAR = new Set([
  'tavaSeed', 'tavaSeedV', 'specWipeV', 'matLibV', 'sectionsBackfillV',
  'specLinkV', 'specCatFixV', 'matFieldsV', 'siparisSectionV',
  'markalar',
])
