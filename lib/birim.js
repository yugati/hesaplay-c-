import { supabaseAdmin } from './supabaseAdmin.js'
import { TASIYAN_AYARLAR } from './tasari.js'

// ─────────────────────────────────────────────────────────────────────────────
// BIRIM (DISIPLIN KATMANI) - SUNUCU TARAFI ORTAK PARCALAR
//
// Birim, TASARININ ALTINDAKI ucuncu katmandir: bir tasari (AKKUYU NGS) birden
// cok disiplin tarafindan yurutulur (Elektrik, Insaat, Mekanik) ve bolum,
// sartname, siparis, rapor gibi is kayitlari her zaman TEK bir birime aittir.
//
// TEK KURAL - lib/org.js ve lib/tasari.js ile birebir ayni: aktif birim HER
// ZAMAN oturum tokeninden gelir ('bir' iddiasi), istek govdesinden ASLA.
// Birim degistirme tokeni YENIDEN IMZALAR (api/org.js op:'birimGecis').
//
// TASARIDAN AYRILDIGI NOKTA - KIM GECEBILIR:
//   Tasari degistirmek herkese acikti (gezinti). Birim ise bir YETKI SINIRIDIR
//   (alinan karar): kullanicinin hangi birimlere girebilecegi Kullanicilar
//   ekranindan acilir/kapanir (users.birimler). Yonetici her birime girer;
//   listesi BOS olan kullanici da her birime girer (bina erisimiyle ayni
//   "bos = tumu" kurali, bkz. setup.sql users.buildings). Liste doluysa
//   yalnizca listedeki birimlere gecilebilir; token de yalnizca onlarla
//   imzalanir (birimCoz).
// ─────────────────────────────────────────────────────────────────────────────

// Bugune kadarki TUM is verisi bu birime aittir: migration_birim_1.sql her
// satiri buraya atadi; birim iddiasi tasimayan ESKI tokenler de buraya duser.
export const VARSAYILAN_BIRIM = 'elektrik'

/* TASARI ORTAK AYAR SATIRLARININ birim_id degeri. Bina listesi (binaGiris /
   binaPasif / binaOlusum) ve migration bayraklari tasarinin TUM birimlerinde
   aynidir; ayri bir tabloya tasimak yerine app_settings icinde bu sabit kimlikle
   durur. Hicbir gercek birim bu kimligi alamaz: BIRIM_ID_KALIP alt cizgiyle
   baslayan kimligi reddeder. */
export const ORTAK_BIRIM = '_tasari'

// Birim kimligi tasari kimligiyle ayni daralikta: kucuk harf/rakam/tire.
const BIRIM_ID_KALIP = /^[a-z0-9][a-z0-9_-]{1,30}$/

export function birimIdGecerli(id) {
  return typeof id === 'string' && BIRIM_ID_KALIP.test(id)
}

/* ═══════════════════════════════════════════════════════════════════════════
   HANGI TABLO HANGI KATMANDA - TEK KAYNAK

   migration_birim_1.sql'deki dizilerin birebir karsiligi. BIRLIKTE DEGISIRLER:
   buraya eklenip SQL'e eklenmeyen tablo "column birim_id does not exist" ile
   patlar; tersi olursa tablo sessizce TUM birimler tarafindan paylasilir.
   ═══════════════════════════════════════════════════════════════════════════ */

/* BIRIME OZEL: her birim kendi satirlarini gorur. Okumada birim_id'ye gore
   suzulur, yazmada satirlara ZORLA yazilir. */
export const BIRIM_TABLOLARI = new Set([
  // id + data desenindeki varlik tablolari
  'tutanaklar',
  'saha_panels', 'saha_lines', 'saha_sockets',
  'rapor_entries',
  'proje_sartnames', 'proje_specs', 'proje_items', 'proje_orders', 'proje_alternatives',
  'gunluk_isler', 'ihtiyac_listeleri', 'faturalar',
  // anahtar/deger ve basit liste tablolari
  'app_settings',   // KARMA: ORTAK_AYARLAR anahtarlari tasari genelinde (ORTAK_BIRIM), kalani birime ozel
  'saha_settings', 'rapor_ekipler', 'proje_sections',
])

/* TASARI GENELI (birimler arasi ORTAK): tasari_id tasir ama birim_id ALMAZ.
   Bina ve oda agaci fiziksel tesistir - Insaat ile Elektrik ayni binada
   calisir. Araç ve gereç zimmeti ve Mobilizasyon ambari da alinan kararla ortak
   kaldi. Bu kume yalnizca BELGE amaclidir; kod BIRIM_TABLOLARI'na bakar. */
export const TASARI_GENELI_TABLOLAR = new Set([
  'proje_buildings', 'proje_lokasyonlar', 'proje_bina_modelleri',
  'alet_items',                       // Araç ve gereç zimmeti
  'gecici_moves', 'gecici_orders',    // Mobilizasyon ambari
])

/* app_settings icinde TASARI GENELINDE ortak kalan anahtarlar. Kalan her anahtar
   (ekipBolum, userEkip, orderDrafts, akisSablon, ozelKod*, tutanakAntet...) birime
   ozeldir. Migration bayraklari ve marka listesi (TASIYAN_AYARLAR) de burada:
   yeni birim hicbir sey kopyalamadan onlari hazir bulur. */
export const ORTAK_AYARLAR = new Set([
  'binaGiris', 'binaPasif', 'binaOlusum',
  ...TASIYAN_AYARLAR,
])

/* AYRIK DURUM - audit_log: birim_id sutunu VARDIR ve damgalanir, okunurken
   FILTRELENMEZ (tasari ile ayni gerekce - denetim defteri bolunmez). */
export function birimDamgalanir(table) {
  return BIRIM_TABLOLARI.has(table) || table === 'audit_log'
}
export function birimFiltrelenir(table) {
  return BIRIM_TABLOLARI.has(table)
}
// app_settings satirinin birim damgasi: anahtara gore ortak ya da aktif birim
export function ayarBirimi(key, birim) {
  return ORTAK_AYARLAR.has(key) ? ORTAK_BIRIM : birim
}

/* Tokendeki aktif birim. Birim katmanindan ONCE imzalanmis tokenlerde alan
   YOKTUR - null doner, cagiran kullanici satirindan okur (aktifBirim). */
export function tokenBirim(claims) {
  const b = claims && claims.bir
  return typeof b === 'string' && b ? b : null
}

export async function aktifBirim(claims) {
  const b = tokenBirim(claims)
  if (b) return b
  const { data } = await supabaseAdmin.from('users').select('birim_id').eq('id', claims.sub).maybeSingle()
  return (data && data.birim_id) || VARSAYILAN_BIRIM
}

/* Kullanici bu birime girebilir mi? Yonetici her zaman; listesi bos olan her
   zaman; aksi halde liste bakilir. user null ise (yalnizca token var) kisit
   uygulanmaz - cagiran taraf bunu yalnizca gosterim icin kullanir. */
export function birimErisebilir(user, id) {
  if (!user) return true
  if (user.role === 'admin') return true
  const liste = Array.isArray(user.birimler) ? user.birimler : []
  return !liste.length || liste.includes(id)
}

/* Tasarinin aktif birimleri, kurulus sirasiyla: [{id, ad, aktif}] */
export async function birimListesi(org, tasari) {
  const { data } = await supabaseAdmin
    .from('birimler').select('id, data, aktif').eq('org_id', org).eq('tasari_id', tasari)
    .order('created_at', { ascending: true })
  return (data || []).filter(r => r.aktif !== false).map(birimSatiri)
}
export function birimSatiri(r) {
  return { id: r.id, ad: (r.data && r.data.ad) || r.id, aktif: r.aktif !== false }
}

/* Birim var mi, aktif mi ve BU TASARIYA mi ait? Birim kimlikleri tasari
   icinde benzersizdir (iki tasarida da 'elektrik' olabilir), o yuzden org ve
   tasari birlikte suzulur. */
export async function birimKullanilabilir(org, tasari, id) {
  if (!birimIdGecerli(id)) return false
  const { data } = await supabaseAdmin
    .from('birimler').select('id, aktif').eq('org_id', org).eq('tasari_id', tasari).eq('id', id).maybeSingle()
  return !!(data && data.aktif !== false)
}

/* Tasarinin kullanicinin GIREBILDIGI ilk birimi; yoksa null. */
export async function ilkBirim(org, tasari, user) {
  const liste = await birimListesi(org, tasari)
  const uygun = liste.find(b => birimErisebilir(user, b.id))
  return uygun ? uygun.id : null
}

/* Bir istek/oturum icin GECERLI birimi cozer - aktif org VE tasariyi dikkate alarak.
   Sira: (1) aday (tokendeki ya da istenen birim) bu tasarida gecerli ve
   kullaniciya acik mi, (2) kullanicinin kendi varsayilan birimi - YALNIZCA kendi
   organizasyonu ve kendi tasarisindayken, (3) tasarinin erisilebilen ilk birimi,
   (4) VARSAYILAN_BIRIM.
   Gerekce tasariCoz ile ayni: baska tasariya gecen kullanicinin elindeki birim
   orada olmayabilir; eski kimlikle imzalanmis token BOS bir uygulama gosterirdi. */
export async function birimCoz(org, tasari, aday, user) {
  if (aday && birimErisebilir(user, aday) && await birimKullanilabilir(org, tasari, aday)) return aday
  const ev = user && user.birim_id
  const kendiYeri = user && (user.org_id || '') === org && (user.tasari_id || '') === tasari
  if (ev && kendiYeri && birimErisebilir(user, ev) && await birimKullanilabilir(org, tasari, ev)) return ev
  return (await ilkBirim(org, tasari, user)) || VARSAYILAN_BIRIM
}
