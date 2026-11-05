import crypto from 'crypto'
import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { tokenHash, davetAnahtar } from '../lib/invites.js'
import { hashPassword, sifreKurallari } from '../lib/password.js'
import { signSession, SESSION_TTL_DEFAULT, kayitImzala, kayitCoz, gizliOzet } from '../lib/auth.js'
import { girisKilitli, hataliDeneme, basariliGiris, istekIp } from '../lib/girisKoruma.js'
import { denetimYaz } from '../lib/denetim.js'
import { ilkTasari, VARSAYILAN_TASARI } from '../lib/tasari.js'
import { ilkBirim, VARSAYILAN_BIRIM } from '../lib/birim.js'
import { EPOSTA_KURAL, KULLANICI_ADI_KURAL, likeKacis, epostaKullanimda } from '../lib/kimlik.js'
import { epostaGonder, dogrulamaEpostaHtml } from '../lib/email.js'
import { adUyumlu } from '../lib/adSutunu.js'
import sahaLink from '../lib/sahaLink.js'
import belgeLink from '../lib/belgeLink.js'

const ROL_AD = { admin: 'Yonetici', izleyici: 'Izleyici', saha_personeli: 'Saha Personeli' }
// E-postaya giden dogrulama kodunun (ve onu tasiyan kayit tokeninin) omru
const DOGRULAMA_GECERLILIK_DK = 15

function kalanMetin(sn) {
  if (sn >= 60) { const d = Math.ceil(sn / 60); return d + ' dakika' }
  return sn + ' saniye'
}

// GET  /api/davet/:token         - davet onizleme
// POST /api/davet/:token/kabul   - kayit formunu alir, e-postaya dogrulama kodu yollar
// POST /api/davet/:token/dogrula - kodu dogrulayip hesabi acar
// :token = davet kodu (K7M4-9XQ2) ya da eski uzun link tokeni (bkz. lib/invites.js davetAnahtar).
// Ucu de KIMLIK DOGRULAMASIZ, herkese acik. Eskiden ayri dosyalardi
// (davet/[token].js + davet/[token]/kabul.js) - api/users.js'teki notla ayni
// sebeple (Vercel Hobby 12 fonksiyon siniri) tek dosyada birlesti; URL semasi
// degismedi. token ve action vercel.json rewrite'lariyla sorgu olarak gelir:
//   /api/davet/:token          -> /api/davet?token=:token
//   /api/davet/:token/:action  -> /api/davet?token=:token&action=:action
// SAHA LINKI de burada: ayni tur (tokenli, hesapsiz acilan link) ve ayni sinir.
//   /api/saha-link[/:token]  -> /api/davet?tur=saha[&token=:token]  (bkz. lib/sahaLink.js)
export default async function handler(req, res) {
  const tur = Array.isArray(req.query.tur) ? req.query.tur[0] : req.query.tur
  if (tur === 'saha') return sahaLink(req, res)
  // BELGE PAYLASIM LINKI de burada (lib/belgeLink.js): /api/belge-link ve /b/:token
  if (tur === 'belge') return belgeLink(req, res)
  const tokenParam = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token
  const actionParam = req.query.action
  const action = Array.isArray(actionParam) ? actionParam[0] : actionParam
  if (!tokenParam) { res.status(400).json({ error: 'token gerekli' }); return }
  const token = davetAnahtar(tokenParam)

  if (!action) return davetOnizle(req, res, token)
  if (action === 'kabul') return davetKabul(req, res, token)
  if (action === 'dogrula') return davetDogrula(req, res, token)
  res.status(404).json({ error: 'Bulunamadi' })
}

// Gecerli (kullanilmamis, suresi dolmamis) daveti dondurur, yoksa null.
async function gecerliDavet(token) {
  const { data: davet, error } = await supabaseAdmin
    .from('invites').select('*').eq('token_hash', tokenHash(token)).maybeSingle()
  if (error) throw error
  if (!davet || davet.used_at || new Date(davet.expires_at).getTime() < Date.now()) return null
  return davet
}

async function orgAdi(orgId) {
  const { data: orgRow } = await supabaseAdmin.from('organizations').select('data').eq('id', orgId).maybeSingle()
  return (orgRow && orgRow.data && orgRow.data.ad) || orgId
}

function kilitYaniti(res, sn) {
  res.status(429).json({ error: 'Cok fazla deneme. ' + kalanMetin(sn) + ' sonra tekrar deneyin.' })
}

/* Kayit ekrani, form gostermeden once daveti onizler: hangi organizasyon, hangi
   rol, (varsa) kime gonderilmis. Kod gecersiz/kullanilmis/suresi gecmisse 404 -
   bulunamadi ile "gecersiz kod" arasinda fark gostermek saldirgan icin bilgi
   sizdirir, o yuzden ayrilmiyor (login.js'teki "kullanici yok" mantigiyla ayni).

   KABA KUVVET: davet kodu elle yazilabilecek kadar kisadir (bkz. lib/invites.js
   uretKod); tahmin denemeleri burada da sayilir ve IP kilitlenir. */
async function davetOnizle(req, res, token) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const ip = istekIp(req)
  const kilitAnahtari = 'davet:' + ip
  const kilit = await girisKilitli(kilitAnahtari, ip)
  if (kilit.kilitli) { kilitYaniti(res, kilit.kalanSn); return }

  try {
    const davet = await gecerliDavet(token)
    if (!davet) {
      await hataliDeneme(kilitAnahtari, ip)
      res.status(404).json({ error: 'Davet kodu gecersiz veya suresi dolmus' })
      return
    }
    res.status(200).json({ orgAd: await orgAdi(davet.org_id), email: davet.email || '', role: davet.role, roleAd: ROL_AD[davet.role] || davet.role })
  } catch (e) {
    console.error('davet GET basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}

// Dogrulama kodunun ozeti kayda (davet + e-posta + tek seferlik 'n') baglidir:
// ayni kod baska bir kayit tokeninde ayni ozeti vermez.
function kodOzeti(kayit, kod) {
  return gizliOzet([kayit.inv, kayit.email.toLowerCase(), kayit.n, kod].join(':'))
}

/* KAYIT 1. ADIM - form. Gecerli bir davetle gelen kisi adini, kullanici adini,
   e-postasini ve sifresini kendisi secer. HESAP BURADA ACILMAZ: e-postaya 6
   haneli bir kod gider, hesap ancak o kod /dogrula'ya girilince acilir. Boylece
   kayitli her e-posta gercekten sahibine aittir - giris ekrani e-postayi da
   kimlik olarak kabul ettigi icin (api/login.js) bu sart.

   Aradaki bilgi veritabanina yazilmaz, imzali KAYIT TOKENI olarak istemciye
   doner (bkz. lib/auth.js kayitImzala). "Kodu tekrar gonder" bu ucu ayni formla
   yeniden cagirir: yeni kod, yeni token.

   KABA KUVVET: iki ayri sayac, ikisi de lib/girisKoruma.js.
     davet:<ip>      - gecersiz davet kodu denemeleri (kod tahmini)
     kayit:<e-posta> - o adrese gonderilen kodlar + /dogrula'daki hatali kodlar.
                       Gonderimi de sayar ki gecerli bir davet kodu, bir adrese
                       art arda e-posta yagdirmak icin kullanilamasin. */
async function davetKabul(req, res, token) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const govde = req.body || {}
  const ad = String(govde.ad || '').trim()
  const username = String(govde.username || '').trim()
  const email = String(govde.email || '').trim()
  const password = govde.password
  if (!ad || !username || !email || !password) { res.status(400).json({ error: 'Ad, kullanici adi, e-posta ve sifre gerekli' }); return }

  const ip = istekIp(req)
  const kilitAnahtari = 'davet:' + ip
  const kayitAnahtari = 'kayit:' + email.toLowerCase()
  let kilit = await girisKilitli(kilitAnahtari, ip)
  if (!kilit.kilitli) kilit = await girisKilitli(kayitAnahtari, ip)
  if (kilit.kilitli) { kilitYaniti(res, kilit.kalanSn); return }

  try {
    const davet = await gecerliDavet(token)
    if (!davet) {
      await hataliDeneme(kilitAnahtari, ip)
      res.status(404).json({ error: 'Davet kodu gecersiz veya suresi dolmus' })
      return
    }

    if (ad.length > 60) { res.status(400).json({ error: 'Ad en fazla 60 karakter olabilir' }); return }
    if (!KULLANICI_ADI_KURAL.test(username)) {
      res.status(400).json({ error: 'Kullanici adi 3-30 karakter olmali; harf, rakam, nokta, tire ve alt cizgi kullanilabilir' })
      return
    }
    if (email.length > 120 || !EPOSTA_KURAL.test(email)) { res.status(400).json({ error: 'E-posta adresi gecersiz' }); return }
    const kuralHatasi = sifreKurallari(password, username)
    if (kuralHatasi) { res.status(400).json({ error: kuralHatasi }); return }

    // Kod gonderilmeden ONCE bakilir: dolu bir kullanici adi icin bosuna e-posta gitmesin
    const { data: ayniAd, error: adErr } = await supabaseAdmin
      .from('users').select('id').ilike('username', likeKacis(username)).limit(1)
    if (adErr) throw adErr
    if (ayniAd && ayniAd.length) { res.status(409).json({ error: 'Bu kullanici adi zaten var', code: '23505' }); return }
    if (await epostaKullanimda(email)) { res.status(409).json({ error: 'Bu e-posta ile kayitli bir hesap zaten var', code: 'eposta' }); return }

    const kod = String(crypto.randomInt(1000000)).padStart(6, '0')
    const kayit = { inv: davet.id, ad, username, email, ph: await hashPassword(password), n: crypto.randomBytes(8).toString('hex') }
    kayit.kh = kodOzeti(kayit, kod)

    const gonderim = await epostaGonder({
      to: email,
      subject: 'Dogrulama kodunuz: ' + kod,
      html: dogrulamaEpostaHtml({ orgAd: await orgAdi(davet.org_id), kod, dakika: DOGRULAMA_GECERLILIK_DK }),
    })
    if (!gonderim.sent) {
      /* E-POSTA GIDEMEDIYSE KAYIT ILERLEMEZ - dogrulamayi atlayan bir yol yoktur.
         Tek istisna yerel gelistirme (Vercel disi): kod sunucu konsoluna yazilir
         ki Resend kurulmadan akis denenebilsin. Canlida bu dal hic calismaz. */
      if (process.env.VERCEL) { res.status(502).json({ error: 'Dogrulama e-postasi gonderilemedi. Yoneticinize haber verin.' }); return }
      console.warn('davet: e-posta gonderilemedi - YEREL GELISTIRME dogrulama kodu (' + email + '): ' + kod)
    }
    await hataliDeneme(kayitAnahtari, ip)   // gonderim sayaci - bkz. bastaki not

    res.status(200).json({ kayit: kayitImzala(kayit, DOGRULAMA_GECERLILIK_DK * 60), email, dakika: DOGRULAMA_GECERLILIK_DK })
  } catch (e) {
    console.error('davet kabul basarisiz', e)
    res.status(500).json({ error: e.message || 'Sunucu hatasi' })
  }
}

/* KAYIT 2. ADIM - dogrulama. E-postaya giden kod dogruysa hesap acilir ve
   oturum tokeniyle otomatik giris yapmis olarak doner - api/login.js'teki
   basariyla-giris akisinin ayni sonucu. Davet TEK KULLANIMLIKTIR: hesap
   acilinca used_at yazilir, ayni kayit tokeni ikinci kez gecmez. */
async function davetDogrula(req, res, token) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const govde = req.body || {}
  const kod = String(govde.kod || '').replace(/\s/g, '')
  const kayit = kayitCoz(govde.kayit)
  // kayit.inv: ayni anahtarla imzalanan sifre sifirlama tokeni (lib/sifreSifirla.js) burada gecmez
  if (!kayit || !kayit.inv || !kod) {
    res.status(400).json({ error: 'Dogrulama suresi doldu. Kodu yeniden isteyin.', code: 'sure' })
    return
  }

  const ip = istekIp(req)
  const kayitAnahtari = 'kayit:' + kayit.email.toLowerCase()
  const kilit = await girisKilitli(kayitAnahtari, ip)
  if (kilit.kilitli) { kilitYaniti(res, kilit.kalanSn); return }

  try {
    const davet = await gecerliDavet(token)
    if (!davet || davet.id !== kayit.inv) {
      res.status(404).json({ error: 'Davet kodu gecersiz veya suresi dolmus' })
      return
    }

    const beklenen = Buffer.from(kayit.kh, 'hex'), gelen = Buffer.from(kodOzeti(kayit, kod), 'hex')
    if (beklenen.length !== gelen.length || !crypto.timingSafeEqual(beklenen, gelen)) {
      const d = await hataliDeneme(kayitAnahtari, ip)
      if (d.kilitSn) kilitYaniti(res, d.kilitSn)
      else res.status(400).json({ error: 'Dogrulama kodu hatali', code: 'kod' })
      return
    }

    /* Davetle acilan YONETICI hesabinda da denetim yetkisi kapali baslar.
       Davet kaydindaki permissions bos bir nesne oldugu icin (index.html
       sendInvite admin rolunde izin gondermez), lib/yetki.js'teki "alan yoksa
       acik" geriye uyum kurali burada devreye girer ve davet edilen her
       yonetici kendiliginden denetim okuyucusu olurdu. Deger acikca yazilir. */
    const izinler = { ...(davet.permissions || {}) }
    if (davet.role === 'admin') izinler.denetim = { read: !!(izinler.denetim && izinler.denetim.read) }
    else delete izinler.denetim

    /* tasari_id ACIKCA YAZILIR - migration_tasari_2.sql varsayilani dusurdugu
       icin zorunlu. Daveti KABUL EDEN kisinin aktif tasarisi yoktur (henuz
       oturumu yok), o yuzden davet edildigi organizasyonun ILK tasarisina
       acilir. Bir kilit degil, bir baslangic noktasi: giris yaptiktan sonra
       diger projelere gecebilir. */
    const ilkTas = (await ilkTasari(davet.org_id)) || VARSAYILAN_TASARI
    /* birim_id de ACIKCA yazilir (migration_birim_2.sql varsayilani dusurur).
       Davetteki birim erisim listesi (birimler, bos = tumu) kullaniciya gecer;
       varsayilan birim o listeye gore erisebildigi ILK birimdir. */
    const birimler = Array.isArray(davet.birimler) ? davet.birimler : []
    const ilkBir = (await ilkBirim(davet.org_id, ilkTas, { role: davet.role, birimler })) || VARSAYILAN_BIRIM
    // adUyumlu: users.ad sutunu henuz eklenmemisse hesap adsiz acilir (bkz. lib/adSutunu.js)
    const { data: user, error: insErr } = await adUyumlu(adDahil => {
      const satir = {
        username: kayit.username, password: kayit.ph, role: davet.role, sections: davet.sections || [],
        buildings: davet.buildings || [], permissions: izinler, birimler,
        email: kayit.email, org_id: davet.org_id, tasari_id: ilkTas, birim_id: ilkBir, is_super: false,
      }
      if (adDahil) satir.ad = kayit.ad
      return supabaseAdmin.from('users').insert([satir]).select().single()
    })
    if (insErr) {
      // Form ile dogrulama arasinda ayni ad/e-posta baskasinca alinmis olabilir
      if (insErr.code === '23505' || String(insErr.message).includes('unique')) {
        res.status(409).json({ error: 'Bu kullanici adi veya e-posta az once baska bir hesapta kullanildi', code: '23505' })
      } else {
        throw insErr
      }
      return
    }

    // email de yazilir: kodla (e-postasiz) olusturulan davet, listede kimin kullandigini gostersin
    await supabaseAdmin.from('invites')
      .update({ used_at: new Date().toISOString(), used_by: user.id, email: kayit.email }).eq('id', davet.id)
    await basariliGiris(kayitAnahtari, ip)

    const safeUser = { ...user }; delete safeUser.password
    const sessionToken = signSession(safeUser, SESSION_TTL_DEFAULT)
    // Davetle hesap acmak ayni zamanda ILK GIRISTIR - /api/login'den gecmedigi
    // icin kaydi burada yazilir, yoksa bu yoldan gelen kullanici loga hic dusmez.
    await denetimYaz(user.org_id, {
      user: user.username, role: user.role, action: 'login', ip,
      detail: 'Davetle hesap acildi, e-posta dogrulandi (' + kayit.email + ')',
    })
    res.status(201).json({ user: safeUser, token: sessionToken })
  } catch (e) {
    console.error('davet dogrula basarisiz', e)
    res.status(500).json({ error: e.message || 'Sunucu hatasi' })
  }
}
