import crypto from 'node:crypto'
import { supabaseAdmin } from './supabaseAdmin.js'
import { requireAuth } from './auth.js'
import { aktifOrg } from './org.js'
import { denetimYaz } from './denetim.js'
import { yolunOrgu } from './dosyaYolu.js'

// ─────────────────────────────────────────────────────────────────────────────
// BELGE PAYLASIM LINKI - siparis PDF'ini HESAPSIZ acan link
//
// Normal PDF acma yolu (api/dosya.js) oturum ister ve 5 dakikalik imzali adres
// verir; adres cubugundan kopyalanan link kisiye gidene kadar oler. Burada
// kullanici "Paylas" der, sunucu imzali bir TOKEN uretir; linki alan kisi
// hesap.yugati.com.tr/b/<token> adresini acinca sunucu tokeni dogrular, Storage'dan
// o an 5 dakikalik imzali adres alir ve tarayiciyi oraya yonlendirir (302).
//
// TOKEN VERITABANINDA TUTULMAZ (Saha Linki ile ayni kalip, bkz. lib/sahaLink.js):
//   token = hex(<bitis>|<dosya yolu>) + HMAC'in ilk 96 biti (24 hex hane)
// Yalnizca kucuk harf + rakam: WhatsApp gibi uygulamalar linki '-' '_' '.'
// karakterlerinde bolmesin. Dogrulama veritabanina gitmeden yapilir; uydurma
// token ilk adimda duser. Anahtar (SESSION_JWT_SECRET) degistirilirse acik
// linkler gecersiz olur.
//
// SURE: 1 gun (varsayilan), 7 gun, 30 gun ya da SINIRSIZ. Bitis tokenin icinde;
// sinirsiz = 0. Tablo olmadigi icin uretilmis bir link IPTAL EDILEMEZ - sinirsiz
// link, anahtar degisene kadar acik kalir. Ekran bunu secim aninda soyler.
//
// Linki alan HERKES acar: kisiye ozel degil. Bu yuzden varsayilan kisa tutuldu.
//
// Uretim yetkisi: oturum + dosyanin istegi yapanin organizasyonuna ait olmasi
// (lib/dosyaYolu.js yolunOrgu). Bu kontrol olmasa bir kiraci baska kiracinin
// faturasina link verebilirdi. Yalniz 'belgeler' kovasindaki PDF'ler paylasilir.
//
// Ayri bir api dosyasi DEGIL: Vercel Hobby 12 fonksiyon siniri (bkz. api/davet.js).
//   /api/belge-link        -> /api/davet?tur=belge            (oturumlu: uret)
//   /b/:token              -> /api/davet?tur=belge&token=...  (herkese acik: ac)
// ─────────────────────────────────────────────────────────────────────────────

const GIZLI = process.env.SESSION_JWT_SECRET
const ACILIS_OMRU = 300   // sn - yonlendirilen imzali adresin omru
const IMZA_BOY = 24       // 96 bit hex
const SURELER = { '1g': 1, '7g': 7, '30g': 30, sinirsiz: 0 }
const GUN = 86400000

function hata(res, kod, mesaj) { res.status(kod).json({ error: mesaj }); return null }
function tek(v) { return Array.isArray(v) ? v[0] : v }
function hmac(yuk) { return crypto.createHmac('sha256', GIZLI).update('belge-link:' + yuk).digest('hex').slice(0, IMZA_BOY) }
function esit(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }

function tokenUret(path, bitisMs) {
  const yuk = Buffer.from(String(bitisMs) + '|' + path, 'utf8').toString('hex')
  return yuk + hmac(yuk)
}
// Gecerli imzali token -> {path, bitis}; degilse null (veritabanina gitmeden)
function tokenCoz(token) {
  const t = String(token || '')
  if (!/^[0-9a-f]{40,800}$/.test(t)) return null
  const yuk = t.slice(0, -IMZA_BOY)
  if (!esit(t.slice(-IMZA_BOY), hmac(yuk))) return null
  const s = Buffer.from(yuk, 'hex').toString('utf8')
  const i = s.indexOf('|')
  if (i <= 0) return null
  const bitis = Number(s.slice(0, i)), path = s.slice(i + 1)
  if (!Number.isFinite(bitis) || bitis < 0) return null
  return { path, bitis }
}

/* Linki acan kisi insan ve tarayicidadir: hata JSON degil okunur bir sayfa olmali. */
function sayfa(res, kod, baslik, metin) {
  res.status(kod)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${baslik}</title></head>` +
    `<body style="font:15px system-ui;padding:32px;color:#333;max-width:520px;margin:auto"><h2 style="margin:0 0 8px">${baslik}</h2><p style="color:#666">${metin}</p></body></html>`)
}

async function acikAc(res, token) {
  const c = tokenCoz(token)
  if (!c) return sayfa(res, 404, 'Belge bulunamadi', 'Bu link gecersiz. Linki gonderen kisiden yeniden isteyin.')
  if (c.bitis && Date.now() > c.bitis) return sayfa(res, 410, 'Linkin suresi doldu', 'Bu belge linkinin suresi gecmis. Linki gonderen kisiden yeni bir link isteyin.')
  if (!yolunOrgu('belgeler', c.path)) return sayfa(res, 404, 'Belge bulunamadi', 'Bu link gecersiz.')
  const { data, error } = await supabaseAdmin.storage.from('belgeler').createSignedUrl(c.path, ACILIS_OMRU)
  if (error || !data) return sayfa(res, 404, 'Belge bulunamadi', 'Belge silinmis ya da tasinmis olabilir. Linki gonderen kisiye haber verin.')
  res.status(302)
  res.setHeader('Location', data.signedUrl)
  res.setHeader('Cache-Control', 'no-store')
  res.end()
}

async function linkOlustur(res, claims, org, g) {
  const path = String(g.path || '')
  // Baska organizasyonun dosyasi icin de "bulunamadi": farkli bir mesaj yolun
  // gercekten var oldugunu ele verirdi (api/dosya.js ile ayni kural).
  if (yolunOrgu('belgeler', path) !== org) return hata(res, 404, 'Dosya bulunamadi')
  if (!/\.pdf$/i.test(path)) return hata(res, 400, 'Yalnizca PDF belgeleri paylasilabilir')
  const sure = g.sure in SURELER ? g.sure : '1g'
  const bitis = SURELER[sure] ? Date.now() + SURELER[sure] * GUN : 0
  const token = tokenUret(path, bitis)
  await denetimYaz(org, {
    user: claims.username, role: claims.role, action: 'belge-link',
    detail: 'Belge paylasim linki uretildi: ' + path + ' (' + (bitis ? sure : 'SINIRSIZ') + ')',
    tasari: claims.tas, birim: claims.bir,
  })
  res.status(200).json({ token, bitis, sure })
}

export default async function belgeLink(req, res) {
  const token = tek(req.query.token)
  try {
    if (token) {
      if (req.method === 'GET') return await acikAc(res, token)
      return hata(res, 405, 'Method not allowed')
    }
    // 401 yalnizca oturum yoksa: tarayici 401'i "oturum dustu" sayar (src/supabase.js authFetch)
    const claims = await requireAuth(req)
    if (!claims) return hata(res, 401, 'Oturum gecersiz')
    if (req.method !== 'POST') return hata(res, 405, 'Method not allowed')
    const org = await aktifOrg(claims)
    return await linkOlustur(res, claims, org, req.body || {})
  } catch (e) {
    console.error('[belge-link]', e)
    return hata(res, 500, e.message || 'Sunucu hatasi')
  }
}
