import crypto from 'node:crypto'
import { supabaseAdmin } from './supabaseAdmin.js'
import { requireAuth } from './auth.js'
import { aktifOrg } from './org.js'
import { aktifTasari } from './tasari.js'
import { denetimYaz } from './denetim.js'
import { istekIp } from './girisKoruma.js'

// ─────────────────────────────────────────────────────────────────────────────
// SAHA LINKI - Gunluk Saha Raporu'na HESAPSIZ giris kapisi
//
// Yonetici tarih + bina + bolum + ekip + vardiya (+ sartname, + istege bagli
// kat) secip bir link uretir. Linki acan kisi (ekip sefi) oturum acmadan o
// secime ait kalemleri gorur, miktar girer, gonderir. Gonderim RAPORA YAZILMAZ:
// 'bekliyor' durumunda bu tabloda durur; yonetici Rapor sayfasinda inceler,
// mevcut Saha Kaydi formu dolu acilir ve KAYDET'e basinca normal yoldan
// (index.html saveRaporEntry) yazilir. Boylece birlestirme, stok hareketi,
// parcali bina kurali gibi kayit mantiginin ikinci bir kopyasi sunucuda yok -
// o fonksiyon degistikce ayrisacak bir es yazilmadi.
//
// LINK TOKENI VERITABANINDA TUTULMAZ: token = <id><imza>, imza sunucu
// anahtariyla (SESSION_JWT_SECRET) uretilen HMAC'in 96 biti, 19 haneli base36.
// Yalnizca kucuk harf + rakam: WhatsApp gibi uygulamalar linki '-' '_' '.'
// karakterlerinde bolup tiklanamaz birakmasin. Dogrulama veritabanina gitmeden
// yapilir, uydurma token ilk adimda duser. Yonetici linki listeden tekrar
// kopyalayabilsin diye token her listelemede yeniden uretilir. Anahtar
// degistirilirse acik linkler gecersiz olur - omurleri zaten kisa.
// Eski bicim (<id>.<base64url imza>, 24 Eyl ilk surum) da kabul edilir.
//
// GECERLILIK: yonetici link olustururken secer - 6 saat (varsayilan), 12 saat
// ya da secilen tarihin ertesi gunu sonuna kadar (Turkiye saati). Yonetici
// istedigi an iptal eder. Bir link suresi icinde birden fazla gonderim alabilir
// (unutulan kalem) - her biri ayri incelenir.
//
// Yonetim uclari (olustur / listele / iptal / karar) YALNIZCA YONETICIYE acik.
// Link, oturumsuz bir yazma kapisi actigi icin bu yetki daraltildi.
//
// Ayri bir api dosyasi DEGIL: Vercel Hobby 12 fonksiyon siniri (bkz.
// api/davet.js basligi). URL'ler vercel.json rewrite'lariyla gelir:
//   /api/saha-link          -> /api/davet?tur=saha            (yonetim)
//   /api/saha-link/:token   -> /api/davet?tur=saha&token=...  (herkese acik)
//
// Tablo: migration_saha_linkleri.sql - tek tablo, iki tur satir:
//   tur='link'     : data {tarih,bina,cat,ekip,vardiya,sartlar[],sart,katId,katAd,
//                          dolduran,adam,stokDus,sure,bitis,olusturan,iptal,iptalEden,iptalTs}
//                    (dolduran/adam yonetici girdiyse linki acana sorulmaz; sart = tek sartnameli
//                     linklerde o kod, ilk surumle uyum icin)
// Linki acan kisinin sayfasi: /s/<token> (vercel.json rewrite -> public/saha-link.html)
//   tur='gonderim' : link_id + data {tarih,bina,cat,ekip,vardiya,sart,stokDus,
//                          dolduran,adam,not,satirlar[],durum,karar}
//                    satir {specId,altId?,kod,ad,ozelNo,birim,sart,miktar,katId,katAd,kat} -
//                    altId varsa montajlanan urun o alternatiftir, specId yine ANA kalemdir
// ─────────────────────────────────────────────────────────────────────────────

const TABLO = 'saha_linkleri'
const GIZLI = process.env.SESSION_JWT_SECRET
const VARDIYALAR = ['GUNDUZ', 'GECE']
const MAX_GONDERIM = 30   // bir linkten en fazla gonderim (link sizarsa yigilma olmasin)
const MAX_SATIR = 300     // tek gonderimde en fazla satir (en buyuk sartname 173 kalem)
const LISTE_GUN = 45      // yonetim listesinde geriye donuk gun (bekleyenler her zaman gelir)
const KURULUM = 'Saha linki tablosu yok - migration_saha_linkleri.sql Supabase SQL Editor\'da calistirilmali'

function hata(res, kod, mesaj) { res.status(kod).json({ error: mesaj }); return null }
function metin(v, n) { return String(v == null ? '' : v).trim().slice(0, n) }
function tabloYok(e) { return !!e && (e.code === 'PGRST205' || e.code === '42P01') }
function tek(v) { return Array.isArray(v) ? v[0] : v }
const HANE = '0123456789abcdefghijklmnopqrstuvwxyz'
function yeniId() { let s = ''; for (let i = 0; i < 10; i++) s += HANE[crypto.randomInt(36)]; return s }

const IMZA_BOY = 19   // 96 bit base36
function hmac(id) { return crypto.createHmac('sha256', GIZLI).update('saha-link:' + id).digest() }
function imza(id) { return BigInt('0x' + hmac(id).subarray(0, 12).toString('hex')).toString(36).padStart(IMZA_BOY, '0') }
function linkTokeni(id) { return id + imza(id) }
function esit(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }
// Gecerli imzali token -> link id; degilse null (veritabanina gitmeden)
function tokenCoz(token) {
  const t = String(token || '')
  if (t.includes('.')) {   // eski bicim: <id>.<base64url imza>
    const [id, sig] = t.split('.')
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id || '')) return null
    return esit(sig || '', hmac(id).subarray(0, 16).toString('base64url')) ? id : null
  }
  if (!/^[A-Za-z0-9_-]{6,40}[0-9a-z]{19}$/.test(t)) return null
  const id = t.slice(0, -IMZA_BOY)
  return esit(t.slice(-IMZA_BOY), imza(id)) ? id : null
}

// Gecerlilik secenekleri. 'ertesi': secilen tarihin ertesi gunu 23:59:59 (Turkiye UTC+3 -
// 2016'dan beri yaz saati yok); digerleri link olusturuldugu andan itibaren.
const SURELER = { '6s': 6 * 3600000, '12s': 12 * 3600000, ertesi: null }
function bitisHesapla(tarih, sure) {
  const ms = SURELER[sure]
  return ms ? Date.now() + ms : Date.parse(tarih + 'T23:59:59.999+03:00') + 86400000
}

// index.html specGroupKey ile ayni: kalemin sartname anahtari
function grupAnahtari(s) { return (s.grup && s.grup.trim()) ? s.grup.trim() : (s.cat || 'Diger') }

async function binaKatlari(org, tasari, bina) {
  const { data, error } = await supabaseAdmin.from('proje_lokasyonlar')
    .select('id, ad:data->>name, kot:data->>kot')
    .eq('org_id', org).eq('tasari_id', tasari)
    .eq('data->>bina', bina).eq('data->>level', 'kat')
  if (error) throw error
  // index.html binaKatlar ile ayni sira: ada gore, sayilar sayisal
  return (data || []).map(k => ({ id: k.id, ad: k.ad || '', kot: k.kot == null ? '' : k.kot }))
    .sort((a, b) => a.ad.localeCompare(b.ad, 'tr', { numeric: true }))
}

// Binanin sartnameleri: code -> {section, katIds}. Bina basina ~20 satir - tek sorgu, JS'te suzulur.
async function binaSartnameleri(org, tasari, bina) {
  const { data, error } = await supabaseAdmin.from('proje_sartnames')
    .select('code:data->>code, section:data->>section, katIds:data->katIds, silindi:data->>is_deleted')
    .eq('org_id', org).eq('tasari_id', tasari).eq('data->>bina', bina)
  if (error) throw error
  const m = new Map()
  for (const x of data || []) if (x.silindi !== 'true' && x.code && !m.has(x.code)) m.set(x.code, x)
  return m
}

// Linkin sartname listesi. 'sartlar' dizisi coklu secimle geldi; ilk surumde tek 'sart' vardi.
function sartListesi(d) { return Array.isArray(d.sartlar) ? d.sartlar : (d.sart ? [d.sart] : []) }
// Yoneticinin linkte sabitledigi adam sayisi; girilmediyse null (linki acan kisi girer)
function linkAdam(d) { return d && d.adam != null && d.adam !== '' ? Number(d.adam) : null }

/* Linkin sayfada gosterecegi kalemler ve kat secenekleri. Onizleme ve gonderim
   AYNI hesabi kullanir: gonderimde gelen her kalem/kat bu listeye karsi dogrulanir,
   istemcinin gonderdigi kimliklere guvenilmez.
   Kalem kumesi: bu binada, bu bolumde, (sartname seciliyse) grubu secilen sartnamelerden
   biri olan, silinmemis sartname kalemleri. Her kalem kendi sartnamesini ('sart') tasir -
   onayda Saha Kaydi formunda her sartname ayri bolum blogu olur. Birim ve foto once
   kutuphaneden (index.html rLineLibUnit / specImgOf ile ayni oncelik). Egress icin
   yalnizca gereken alanlar cekilir - kalemin tam govdesi (lokTargets vb.) inmez.

   ALTERNATIFLER: her kalemin ardindan ona bagli alternatif urunler ayri kalem olarak
   gelir (id 'a:<altId>'). Yalnizca SATIN ALINABILIR olanlar - durumu 'kullanımda' ya da
   'onaylandi' (index.html activeAltsFor ile ayni kural; oneri/reddedilen sahaya inmez).
   Gonderimde satir ANA kaleme (specId) + altId ile baglanir: ilerleme ana kaleme sayilir,
   kayitta gercekte montajlanan urunun adi/kodu durur (siparis ve rapor akisiyla ayni model).
   Ad/kod/birim/foto kutuphaneden canli okunur, alternatif kaydindaki kopya yedektir (altLive).
   ALIM KOSULU: alternatife miktar ancak o alternatifin ALIMI varsa girilir - alimi olmayan
   (ya da iadeyle sifirlanan) alternatif sayfada KILITLI gorunur ve gonderimde reddedilir.
   Alim = index.html specProgress ile ayni: type!=='out' proje hareketleri (iade eksi miktarli),
   specId ana kalem + altId o alternatif. Alim okunamazsa alternatif kilitli kalir (alim: null). */
const ALT_DURUMLAR = new Set(['kullanımda', 'onaylandi'])
// alternatif id -> net alim miktari; okunamazsa null (sayfa "alim bilgisi okunamadi" der)
async function altAlimlari(org, tas, altListe) {
  const alim = new Map(altListe.map(a => [a.id, 0]))
  const anaOf = new Map(altListe.map(a => [a.id, a.specId]))
  const ids = altListe.map(a => a.id)
  try {
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabaseAdmin.from('proje_items')
        .select('altId:data->>altId, specId:data->>specId, qty:data->>qty, type:data->>type')
        .eq('org_id', org).eq('tasari_id', tas).in('data->>altId', ids.slice(i, i + 150))
      if (error) throw error
      for (const it of data || []) {
        if (it.type === 'out' || anaOf.get(it.altId) !== it.specId) continue
        alim.set(it.altId, alim.get(it.altId) + (Number(it.qty) || 0))
      }
    }
    return alim
  } catch (e) {
    console.error('saha-link alternatif alimlari okunamadi', e)
    return null
  }
}
async function linkKapsami(row) {
  const org = row.org_id, tas = row.tasari_id, d = row.data || {}
  const sartlar = sartListesi(d)
  const [specRes, katlar, srMap, altRes] = await Promise.all([
    supabaseAdmin.from('proje_specs')
      .select('id, grup:data->>grup, cat:data->>cat, code:data->>code, name:data->>name, unit:data->>unit, ozelNo:data->>ozelNo, poz:data->>poz, matId:data->>matId, silindi:data->>is_deleted, img:data->>img, target:data->>target')
      .eq('org_id', org).eq('tasari_id', tas).eq('data->>bina', d.bina).eq('data->>cat', d.cat),
    binaKatlari(org, tas, d.bina),
    sartlar.length ? binaSartnameleri(org, tas, d.bina) : Promise.resolve(new Map()),
    // tasarinin tum alternatifleri (proje basina birkac yuz satir, dar kolonlar) - kalemlere JS'te baglanir
    supabaseAdmin.from('proje_alternatives')
      .select('id, specId:data->>specId, matId:data->>matId, code:data->>code, name:data->>name, unit:data->>unit, img:data->>img, status:data->>status, silindi:data->>is_deleted')
      .eq('org_id', org).eq('tasari_id', tas),
  ])
  if (specRes.error) throw specRes.error
  let specs = (specRes.data || []).filter(s => s.silindi !== 'true')
  if (sartlar.length) { const set = new Set(sartlar); specs = specs.filter(s => set.has(grupAnahtari(s))) }
  // alternatif tablosu okunamazsa link yine acilir - yalnizca alternatifsiz
  if (altRes.error) console.error('saha-link alternatifler okunamadi', altRes.error)
  const specIdSet = new Set(specs.map(s => s.id))
  const altlar = new Map()   // specId -> [alternatif]
  for (const a of (altRes.error ? [] : altRes.data || [])) {
    if (a.silindi === 'true' || !ALT_DURUMLAR.has(a.status) || !specIdSet.has(a.specId)) continue
    if (!altlar.has(a.specId)) altlar.set(a.specId, [])
    altlar.get(a.specId).push(a)
  }
  const altListe = [...altlar.values()].flat()

  const matIds = [...new Set([...specs.map(s => s.matId), ...altListe.map(a => a.matId)].filter(Boolean))]
  const mats = {}
  const matOku = async () => {
    for (let i = 0; i < matIds.length; i += 150) {
      const { data, error } = await supabaseAdmin.from('proje_materials')
        .select('id, unit:data->>unit, img:data->>img, code:data->>code, name:data->>name').eq('org_id', org).in('id', matIds.slice(i, i + 150))
      if (error) throw error
      for (const m of data || []) mats[m.id] = m
    }
  }
  const [, alimlar] = await Promise.all([matOku(), altListe.length ? altAlimlari(org, tas, altListe) : Promise.resolve(new Map())])
  // yalnizca http(s) foto adresi gonderilir - gomulu (data:) ya da kova yolu olan foto atlanir
  const foto = (...adaylar) => adaylar.find(u => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 1000) || ''
  const anaKalemler = specs.map(s => {
    const m = s.matId ? mats[s.matId] : null
    return {
      id: s.id, kod: s.code || '', ad: s.name || '', ozelNo: s.ozelNo || '', poz: s.poz || '',
      birim: (m && m.unit) || s.unit || '', hedef: Number(s.target) || 0,
      img: foto(m && m.img, s.img), sart: grupAnahtari(s),
    }
  }).sort((a, b) => a.kod.localeCompare(b.kod, 'tr', { numeric: true }) || a.ad.localeCompare(b.ad, 'tr'))
  // alternatif, ana kaleminin HEMEN ardindan: poz/ozel no ana kalemindir (onun yerine montajlanir)
  // alim: net alim miktari (null = okunamadi); kilitli: alimi yok -> miktar girilemez
  const kalemler = anaKalemler.flatMap(k => [k, ...(altlar.get(k.id) || []).map(a => {
    const m = a.matId ? mats[a.matId] : null
    const alim = alimlar ? Math.round((alimlar.get(a.id) || 0) * 1e6) / 1e6 : null
    return {
      id: 'a:' + a.id, altId: a.id, anaId: k.id, ana: { kod: k.kod, ad: k.ad },
      kod: (m && m.code) || a.code || '', ad: (m && m.name) || a.name || '', ozelNo: k.ozelNo, poz: k.poz,
      birim: (m && m.unit) || a.unit || k.birim, hedef: 0, img: foto(m && m.img, a.img), sart: k.sart,
      alim, kilitli: !(alim > 0),
    }
  // alimi olan alternatif once: sahada girilebilecek olan ana kaleme en yakin dursun
  }).sort((a, b) => (a.kilitli - b.kilitli) || a.ad.localeCompare(b.ad, 'tr'))])

  // Kat secenekleri: secilen sartnamelerin HEPSI katlara atanmissa yalnizca onlarin
  // katlari (birlesim; index.html sartKatIds), biri bile bina geneliyse (katIds bos) ya da
  // sartname secilmediyse binanin tum katlari. Link tek kata sabitlendiyse secim yoktur.
  let katSecim = katlar
  const srler = sartlar.map(c => srMap.get(c)).filter(Boolean)
  if (srler.length && srler.every(sr => Array.isArray(sr.katIds) && sr.katIds.length)) {
    const set = new Set(srler.flatMap(sr => sr.katIds))
    const f = katlar.filter(k => set.has(k.id))
    if (f.length) katSecim = f
  }
  const katSabit = d.katId ? (katlar.find(k => k.id === d.katId) || { id: d.katId, ad: d.katAd || '', kot: '' }) : null
  return { kalemler, katlar: katSabit ? [] : katSecim, katSabit }
}

// Token -> gecerli link satiri; degilse {kod, mesaj}
async function linkGetir(token) {
  const id = tokenCoz(token)
  if (!id) return { kod: 404, mesaj: 'Link gecersiz' }
  const { data: row, error } = await supabaseAdmin.from(TABLO)
    .select('id, org_id, tasari_id, data').eq('id', id).eq('tur', 'link').maybeSingle()
  if (error) throw error
  if (!row) return { kod: 404, mesaj: 'Link gecersiz' }
  if (row.data && row.data.iptal) return { kod: 410, mesaj: 'Bu link iptal edildi' }
  if (Date.now() > Number(row.data && row.data.bitis)) return { kod: 410, mesaj: 'Bu linkin suresi doldu' }
  return { row }
}

// index.html norm() ile ayni: Turkce harfleri sadelestirip kucultur (ad eslestirme icin)
function norm(s) {
  return String(s == null ? '' : s).toLocaleLowerCase('tr')
    .replace(/i̇/g, 'i').replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/ş/g, 's').replace(/Ş/g, 's').replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u').replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
}

/* Linkin ORGANIZASYONU: sayfanin sag ustundeki logo. Organizasyonun ayri bir logo
   alani yok - kaynak, uygulamanin orgSirketi()'si ile AYNI: Sirketler'de kisa adi ya
   da adi organizasyon adiyla/kimligiyle ayni olan kayit; tam eslesme yoksa adi
   "<org adi> " ile baslayan TEK kayit. Antetlerde basilan logo da budur.
   Logo suslemedir: bir hata sayfayi dusurmez, logosuz acilir. Yalnizca http(s)
   adresi gonderilir (kalem fotolariyla ayni kural). */
async function orgMarka(org) {
  try {
    const [o, c] = await Promise.all([
      supabaseAdmin.from('organizations').select('ad:data->>ad').eq('id', org).maybeSingle(),
      supabaseAdmin.from('companies').select('ad:data->>ad, kisaAd:data->>kisaAd, logo:data->>logo').eq('org_id', org),
    ])
    const ad = (o.data && o.data.ad) || ''
    const anahtar = [ad, org].map(norm).filter(Boolean)
    const liste = c.error ? [] : (c.data || [])
    const sirket = liste.find(x => anahtar.includes(norm(x.kisaAd)) || anahtar.includes(norm(x.ad)))
      || (b => b.length === 1 ? b[0] : null)(liste.filter(x => anahtar.some(a => norm(x.ad).startsWith(a + ' '))))
    const logo = sirket && typeof sirket.logo === 'string' ? sirket.logo.trim() : ''
    return { ad, logo: /^https?:\/\//i.test(logo) && logo.length <= 1000 ? logo : '' }
  } catch (e) {
    return { ad: '', logo: '' }
  }
}

async function gonderimSayisi(linkId) {
  const { count, error } = await supabaseAdmin.from(TABLO)
    .select('id', { count: 'exact', head: true }).eq('tur', 'gonderim').eq('link_id', linkId)
  if (error) throw error
  return count || 0
}

// ─── HERKESE ACIK ────────────────────────────────────────────────────────────

async function acikOnizle(req, res, token) {
  const s = await linkGetir(token)
  if (!s.row) return hata(res, s.kod, s.mesaj)
  const [k, sayi, org] = await Promise.all([linkKapsami(s.row), gonderimSayisi(s.row.id), orgMarka(s.row.org_id)])
  const d = s.row.data
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    // dolduran / adam: yonetici linki olustururken girdiyse sayfada SABIT gorunur, sorulmaz
    link: { tarih: d.tarih, bina: d.bina, cat: d.cat, ekip: d.ekip, vardiya: d.vardiya, sartlar: sartListesi(d),
      dolduran: d.dolduran || '', adam: linkAdam(d), bitis: d.bitis },
    katSabit: k.katSabit, katlar: k.katlar, kalemler: k.kalemler,
    gonderimSayisi: sayi, maxGonderim: MAX_GONDERIM, org,
  })
}

async function acikGonder(req, res, token) {
  const s = await linkGetir(token)
  if (!s.row) return hata(res, s.kod, s.mesaj)
  const g = req.body || {}
  const gelen = Array.isArray(g.satirlar) ? g.satirlar : []
  if (!gelen.length) return hata(res, 400, 'En az bir kaleme miktar girin')
  if (gelen.length > MAX_SATIR) return hata(res, 400, 'Tek gonderimde en fazla ' + MAX_SATIR + ' satir')

  // yoneticinin linkte sabitledigi deger, linki acanin gonderdiginin ONUNE gecer
  let adam = linkAdam(s.row.data)
  if (adam == null && g.adam !== '' && g.adam != null) {
    const a = Number(g.adam)
    if (!Number.isInteger(a) || a < 0 || a > 999) return hata(res, 400, 'Adam sayisi gecersiz')
    adam = a
  }

  const [k, sayi] = await Promise.all([linkKapsami(s.row), gonderimSayisi(s.row.id)])
  if (sayi >= MAX_GONDERIM) return hata(res, 429, 'Bu linkten en fazla ' + MAX_GONDERIM + ' gonderim yapilabilir')

  const kalemMap = new Map(k.kalemler.map(x => [x.id, x]))
  const katMap = new Map(k.katlar.map(x => [x.id, x]))
  // ayni kalem + ayni kat iki satirda gelirse tek satirda toplanir
  const birlesik = new Map(), satirlar = []
  for (let i = 0; i < gelen.length; i++) {
    const r = gelen[i] || {}
    const kalem = kalemMap.get(String(r.id || ''))
    if (!kalem) return hata(res, 400, (i + 1) + '. satirdaki kalem bu linkin listesinde yok - sayfayi yenileyin')
    const etiket = kalem.kod || kalem.ad
    // alimi olmayan alternatife miktar yazilamaz (sayfa kilitli gosterir; eski sekme/taslak da gecemesin)
    if (kalem.kilitli) return hata(res, 400, etiket + ': bu alternatifin alimi yok - miktar girilemez')
    const miktar = Number(String(r.miktar == null ? '' : r.miktar).replace(',', '.'))
    if (!isFinite(miktar) || miktar <= 0 || miktar > 1e6) return hata(res, 400, etiket + ': gecersiz miktar')
    let katId = '', katAd = '', katMetin = ''
    if (k.katSabit) { katId = k.katSabit.id; katAd = k.katSabit.ad }
    else if (k.katlar.length) {
      const kt = katMap.get(String(r.katId || ''))
      if (!kt) return hata(res, 400, etiket + ': kat secin')
      katId = kt.id; katAd = kt.ad
    } else katMetin = metin(r.kat, 20)   // binada kat tanimi yok: serbest metin, istege bagli
    const anahtar = kalem.id + '|' + katId + '|' + katMetin
    const ex = birlesik.get(anahtar)
    if (ex) { ex.miktar = Math.round((ex.miktar + miktar) * 1e6) / 1e6; continue }
    // alternatif: satir ANA kaleme baglanir, altId gercekte montajlanan urunu tasir
    const sat = { specId: kalem.anaId || kalem.id, ...(kalem.altId ? { altId: kalem.altId } : {}), kod: kalem.kod, ad: kalem.ad, ozelNo: kalem.ozelNo, birim: kalem.birim, sart: kalem.sart, miktar, katId, katAd, kat: katMetin }
    birlesik.set(anahtar, sat); satirlar.push(sat)
  }

  const d = s.row.data
  const dolduran = d.dolduran || metin(g.dolduran, 60)
  const sartlar = sartListesi(d)
  const data = {
    tarih: d.tarih, bina: d.bina, cat: d.cat, ekip: d.ekip, vardiya: d.vardiya, sartlar, sart: sartlar.length === 1 ? sartlar[0] : '',
    stokDus: d.stokDus !== false, dolduran, adam, not: metin(g.not, 500), satirlar, durum: 'bekliyor',
  }
  const { error } = await supabaseAdmin.from(TABLO).insert([{
    id: yeniId(), org_id: s.row.org_id, tasari_id: s.row.tasari_id, tur: 'gonderim', link_id: s.row.id, data,
  }])
  if (error) throw error
  await denetimYaz(s.row.org_id, {
    user: 'saha-linki', role: '-', action: 'define', ip: istekIp(req), tasari: s.row.tasari_id,
    detail: `Saha linkinden gonderim (onay bekliyor): ${d.tarih} ${d.bina} ${d.vardiya} - ${d.cat} / ${d.ekip} - ${satirlar.length} kalem${dolduran ? ' - ' + dolduran : ''}`,
  })
  res.status(201).json({ ok: true, no: sayi + 1 })
}

// ─── YONETIM (yalnizca yonetici) ─────────────────────────────────────────────

async function yonetimListe(res, org, tasari) {
  const sinir = new Date(Date.now() - LISTE_GUN * 86400000).toISOString()
  const kapsa = q => q.eq('org_id', org).eq('tasari_id', tasari)
  const [son, bekleyen] = await Promise.all([
    kapsa(supabaseAdmin.from(TABLO).select('id, tur, link_id, data, created_at'))
      .gte('created_at', sinir).order('created_at', { ascending: false }).limit(1000),
    // bekleyen gonderim ne kadar eski olursa olsun listede kalir - sessizce kaybolmasin
    kapsa(supabaseAdmin.from(TABLO).select('id, tur, link_id, data, created_at'))
      .eq('tur', 'gonderim').eq('data->>durum', 'bekliyor').limit(500),
  ])
  for (const r of [son, bekleyen]) {
    if (r.error) {
      if (tabloYok(r.error)) { res.status(200).json({ kurulu: false, linkler: [], gonderimler: [] }); return }
      throw r.error
    }
  }
  const satirlar = new Map()
  for (const r of [...son.data, ...bekleyen.data]) satirlar.set(r.id, r)
  const hepsi = [...satirlar.values()]
  const sayac = {}
  hepsi.filter(r => r.tur === 'gonderim').forEach(r => { sayac[r.link_id] = (sayac[r.link_id] || 0) + 1 })
  const linkler = hepsi.filter(r => r.tur === 'link')
    .map(r => ({ ...r.data, id: r.id, token: linkTokeni(r.id), olusturma: r.created_at, gonderimSayisi: sayac[r.id] || 0 }))
  const gonderimler = hepsi.filter(r => r.tur === 'gonderim')
    .map(r => ({ ...r.data, id: r.id, linkId: r.link_id, gonderme: r.created_at }))
    .sort((a, b) => String(b.gonderme).localeCompare(String(a.gonderme)))
  res.status(200).json({ kurulu: true, simdi: Date.now(), linkler, gonderimler })
}

async function linkOlustur(res, claims, org, tasari, g) {
  const tarih = metin(g.tarih, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih) || isNaN(Date.parse(tarih))) return hata(res, 400, 'Gecerli bir tarih secin')
  const bina = metin(g.bina, 80), cat = metin(g.cat, 120), ekip = metin(g.ekip, 160)
  const katId = metin(g.katId, 80)
  // coklu sartname (bos = bolumun tum kalemleri); eski istemci tek 'sart' gonderebilir
  const sartlar = [...new Set((Array.isArray(g.sartlar) ? g.sartlar : (g.sart ? [g.sart] : [])).map(x => metin(x, 160)).filter(Boolean))]
  const vardiya = VARDIYALAR.includes(g.vardiya) ? g.vardiya : ''
  if (!bina) return hata(res, 400, 'Bina secin')
  if (!cat) return hata(res, 400, 'Bolum secin')
  if (!ekip) return hata(res, 400, 'Ekip secin')
  if (!vardiya) return hata(res, 400, 'Vardiya secin')
  if (sartlar.length > 40) return hata(res, 400, 'En fazla 40 sartname secilebilir')
  // linki acan kisiye SORULMAYACAK degerler (yonetici girdiyse sayfada sabit gorunur)
  const dolduran = metin(g.dolduran, 60)
  let adam = null
  if (g.adam !== '' && g.adam != null) {
    const a = Number(g.adam)
    if (!Number.isInteger(a) || a < 0 || a > 999) return hata(res, 400, 'Adam sayisi gecersiz')
    adam = a
  }
  const sure = g.sure in SURELER ? g.sure : '6s'
  const bitis = bitisHesapla(tarih, sure)
  if (bitis <= Date.now()) return hata(res, 400, 'Bu tarihin linki zaten suresi dolmus olurdu - "ertesi gun sonu" secenegi secilen gunun ertesi gunu biter')
  // yanlis secim bos bir sayfa uretmesin: sartnameler bu binada VE bu bolumde olmali
  if (sartlar.length) {
    const srMap = await binaSartnameleri(org, tasari, bina)
    const yok = sartlar.find(c => !srMap.has(c))
    if (yok) return hata(res, 400, 'Sartname bu binada bulunamadi: ' + yok)
    const baska = sartlar.find(c => srMap.get(c).section && srMap.get(c).section !== cat)
    if (baska) return hata(res, 400, 'Sartname "' + cat + '" bolumune ait degil: ' + baska)
  }
  let katAd = ''
  if (katId) {
    const kat = (await binaKatlari(org, tasari, bina)).find(k => k.id === katId)
    if (!kat) return hata(res, 400, 'Secilen kat bu binada bulunamadi')
    katAd = kat.ad
  }
  const id = yeniId()
  const data = {
    tarih, bina, cat, ekip, vardiya, sartlar, sart: sartlar.length === 1 ? sartlar[0] : '',
    katId, katAd, dolduran, adam, stokDus: g.stokDus !== false,
    sure, bitis, olusturan: claims.username, iptal: false,
  }
  const { error } = await supabaseAdmin.from(TABLO).insert([{ id, org_id: org, tasari_id: tasari, tur: 'link', link_id: null, data }])
  if (error) throw error
  await denetimYaz(org, {
    user: claims.username, role: claims.role, action: 'define', tasari,
    detail: `Saha linki olusturuldu: ${tarih} ${bina} ${vardiya} - ${cat} / ${ekip}${sartlar.length ? ' / ' + sartlar.join(', ') : ''}${katAd ? ' / kat ' + katAd : ''}${dolduran ? ' / ' + dolduran : ''}`,
  })
  res.status(201).json({ link: { ...data, id, token: linkTokeni(id), olusturma: new Date().toISOString(), gonderimSayisi: 0 } })
}

async function linkIptal(res, claims, org, tasari, g) {
  const id = metin(g.id, 40)
  const { data: row, error } = await supabaseAdmin.from(TABLO).select('id, data')
    .eq('org_id', org).eq('tasari_id', tasari).eq('tur', 'link').eq('id', id).maybeSingle()
  if (error) throw error
  if (!row) return hata(res, 404, 'Link bulunamadi')
  const d = row.data || {}
  if (!d.iptal) {
    const { error: e2 } = await supabaseAdmin.from(TABLO)
      .update({ data: { ...d, iptal: true, iptalEden: claims.username, iptalTs: Date.now() } })
      .eq('id', id).eq('org_id', org).eq('tasari_id', tasari)
    if (e2) throw e2
    await denetimYaz(org, {
      user: claims.username, role: claims.role, action: 'define', tasari,
      detail: `Saha linki iptal edildi: ${d.tarih} ${d.bina} ${d.vardiya} - ${d.cat} / ${d.ekip}`,
    })
  }
  res.status(200).json({ ok: true })
}

/* Gonderim karari. KABUL, kayitlar tarayicida (saveRaporEntry) yazildiktan SONRA
   isaretlenir; kayit kimlikleri iz olarak saklanir. Kosullu guncelleme (durum hala
   'bekliyor' ise) iki yoneticinin ayni gonderimi ayni anda islemesini yakalar:
   ikincisi 409 alir ve tarayici ona cift kayit uyarisini gosterir. */
async function gonderimKarar(res, claims, org, tasari, g) {
  const id = metin(g.id, 40)
  const durum = g.durum === 'kabul' || g.durum === 'red' ? g.durum : ''
  if (!durum) return hata(res, 400, 'Gecersiz karar')
  const { data: row, error } = await supabaseAdmin.from(TABLO).select('id, data')
    .eq('org_id', org).eq('tasari_id', tasari).eq('tur', 'gonderim').eq('id', id).maybeSingle()
  if (error) throw error
  if (!row) return hata(res, 404, 'Gonderim bulunamadi')
  const d = row.data || {}
  if (d.durum !== 'bekliyor') return hata(res, 409, d.durum === 'kabul' ? 'Bu gonderim zaten kabul edilmis' : 'Bu gonderim zaten reddedilmis')
  const karar = { kisi: claims.username, ts: Date.now() }
  if (durum === 'kabul') karar.kayitlar = (Array.isArray(g.kayitlar) ? g.kayitlar : []).map(x => metin(x, 60)).filter(Boolean).slice(0, 1000)
  else karar.neden = metin(g.neden, 300)
  const { data: yazilan, error: e2 } = await supabaseAdmin.from(TABLO)
    .update({ data: { ...d, durum, karar } })
    .eq('id', id).eq('org_id', org).eq('tasari_id', tasari).eq('data->>durum', 'bekliyor')
    .select('id')
  if (e2) throw e2
  if (!yazilan || !yazilan.length) return hata(res, 409, 'Bu gonderim az once baska biri tarafindan islendi')
  await denetimYaz(org, {
    user: claims.username, role: claims.role, action: 'define', tasari,
    detail: `Saha linki gonderimi ${durum === 'kabul' ? 'kabul edildi' : 'reddedildi'}: ${d.tarih} ${d.bina} - ${d.cat} / ${d.ekip} - ${(d.satirlar || []).length} kalem${d.dolduran ? ' (' + d.dolduran + ')' : ''}${karar.neden ? ' - ' + karar.neden : ''}`,
  })
  res.status(200).json({ ok: true })
}

export default async function sahaLink(req, res) {
  const token = tek(req.query.token)
  try {
    if (token) {
      if (req.method === 'GET') return await acikOnizle(req, res, token)
      if (req.method === 'POST') return await acikGonder(req, res, token)
      return hata(res, 405, 'Method not allowed')
    }
    // 401 yalnizca oturum yoksa: tarayici 401'i "oturum dustu" sayar (src/supabase.js authFetch)
    const claims = await requireAuth(req)
    if (!claims) return hata(res, 401, 'Oturum gecersiz')
    if (claims.role !== 'admin') return hata(res, 403, 'Saha linkleri yalnizca yoneticiye acik')
    const [org, tasari] = await Promise.all([aktifOrg(claims), aktifTasari(claims)])
    if (req.method === 'GET') return await yonetimListe(res, org, tasari)
    if (req.method === 'POST') {
      const g = req.body || {}
      if (g.op === 'olustur') return await linkOlustur(res, claims, org, tasari, g)
      if (g.op === 'iptal') return await linkIptal(res, claims, org, tasari, g)
      if (g.op === 'karar') return await gonderimKarar(res, claims, org, tasari, g)
      return hata(res, 400, 'Bilinmeyen islem')
    }
    return hata(res, 405, 'Method not allowed')
  } catch (e) {
    if (tabloYok(e)) return hata(res, 503, KURULUM)
    console.error('saha-link basarisiz', e)
    return hata(res, 500, e.message || 'Sunucu hatasi')
  }
}
