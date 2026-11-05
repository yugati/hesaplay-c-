import crypto from 'crypto'
import { supabaseAdmin } from './supabaseAdmin.js'
import { kayitImzala, kayitCoz, gizliOzet } from './auth.js'
import { hashPassword, sifreKurallari } from './password.js'
import { girisKilitli, hataliDeneme, basariliGiris, istekIp } from './girisKoruma.js'
import { denetimYaz } from './denetim.js'
import { kullaniciBul } from './kimlik.js'
import { oturumlariKapat } from './oturum.js'
import { epostaGonder, sifreEpostaHtml } from './email.js'

// ─────────────────────────────────────────────────────────────────────────────
// SIFREMI UNUTTUM - e-posta koduyla sifre sifirlama (api/login.js uzerinden).
//
//   POST /api/sifre/iste   {kimlik}                - hesaba kayitli e-postaya 6 haneli kod yollar
//   POST /api/sifre/yenile {kayit, kod, password}  - kod dogruysa sifreyi degistirir
//
// Ikisi de KIMLIK DOGRULAMASIZ, herkese acik. Davetle kayittaki iki adimin
// aynisi (bkz. api/davet.js): aradaki durum veritabanina yazilmaz, imzali token
// olarak istemciye doner (lib/auth.js kayitImzala).
//
// HESAP VARLIGI SIZDIRMAZ: /iste, hesap olsun olmasin (ve e-postasi olsun
// olmasin) AYNI cevabi verir; hesap yoksa kimseye e-posta gitmez ve donen token
// hicbir kodla acilmaz. Aksi halde bu uc, kullanici adi/e-posta yoklamak icin
// kullanilabilirdi (api/login.js'teki "kullanici yok" mantigiyla ayni).
//
// KABA KUVVET: sayac sifre:<hesap> + IP (lib/girisKoruma.js). Hem gonderilen
// kodlari hem hatali kodlari sayar: kod 6 hanedir, tahmin edilemesin; ve bu uc
// birinin gelen kutusuna art arda e-posta yagdirmak icin kullanilamasin.
// ─────────────────────────────────────────────────────────────────────────────

const GECERLILIK_DK = 15

function kalanMetin(sn) {
  if (sn >= 60) { const d = Math.ceil(sn / 60); return d + ' dakika' }
  return sn + ' saniye'
}

function kilitYaniti(res, sn) {
  res.status(429).json({ error: 'Cok fazla deneme. ' + kalanMetin(sn) + ' sonra tekrar deneyin.' })
}

// Kodun ozeti tokene (hesap + tek seferlik 'n') baglidir: ayni kod baska tokende gecmez
function kodOzeti(kayit, kod) {
  return gizliOzet(['sifre', kayit.uid || '', kayit.n, kod].join(':'))
}

/* Token, verildigi andaki sifreye baglanir: sifre degisince (bu tokenle ya da
   baska yolla) ozet tutmaz - yani token TEK KULLANIMLIKTIR. */
function sifreOzeti(user) {
  return gizliOzet('sifre-pp:' + user.id + ':' + (user.password || ''))
}

export default async function sifreSifirla(req, res, islem) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (islem === 'iste') return sifreIste(req, res)
  if (islem === 'yenile') return sifreYenile(req, res)
  res.status(404).json({ error: 'Bulunamadi' })
}

async function sifreIste(req, res) {
  const kimlik = String((req.body || {}).kimlik || '').trim()
  if (!kimlik) { res.status(400).json({ error: 'Kullanici adi veya e-posta gerekli' }); return }

  const ip = istekIp(req)
  try {
    const user = await kullaniciBul(kimlik)
    // Sayac yazilan degere degil HESABA bagli (bkz. api/login.js ayni gerekce)
    const hesap = 'sifre:' + (user ? user.username : kimlik)
    const kilit = await girisKilitli(hesap, ip)
    if (kilit.kilitli) { kilitYaniti(res, kilit.kalanSn); return }
    await hataliDeneme(hesap, ip)   // gonderim sayaci - bkz. bastaki not

    const kod = String(crypto.randomInt(1000000)).padStart(6, '0')
    const kayit = { t: 'sifre', h: hesap, n: crypto.randomBytes(8).toString('hex') }
    const adres = user ? String(user.email || '').trim() : ''
    if (adres) {
      kayit.uid = user.id
      kayit.pp = sifreOzeti(user)
      kayit.kh = kodOzeti(kayit, kod)
      const gonderim = await epostaGonder({
        to: adres,
        subject: 'Sifre sifirlama kodunuz: ' + kod,
        html: sifreEpostaHtml({ kullanici: user.username, kod, dakika: GECERLILIK_DK }),
      })
      if (!gonderim.sent) {
        // Yerel gelistirmede (Vercel disi) kod konsola yazilir - bkz. api/davet.js ayni dal
        if (process.env.VERCEL) { res.status(502).json({ error: 'E-posta gonderilemedi. Yoneticinize haber verin.' }); return }
        console.warn('sifre: e-posta gonderilemedi - YEREL GELISTIRME sifirlama kodu (' + adres + '): ' + kod)
      }
    } else {
      // Hesap yok ya da e-postasi yok: hicbir kodun acamayacagi token
      kayit.kh = crypto.randomBytes(32).toString('hex')
    }
    res.status(200).json({ kayit: kayitImzala(kayit, GECERLILIK_DK * 60), dakika: GECERLILIK_DK })
  } catch (e) {
    console.error('sifre iste basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}

async function sifreYenile(req, res) {
  const govde = req.body || {}
  const kod = String(govde.kod || '').replace(/\s/g, '')
  const password = govde.password
  const kayit = kayitCoz(govde.kayit)
  if (!kayit || kayit.t !== 'sifre' || !kayit.h || !kayit.kh) {
    res.status(400).json({ error: 'Kodun suresi doldu. Yeniden kod isteyin.', code: 'sure' })
    return
  }
  if (!kod || !password) { res.status(400).json({ error: 'Kod ve yeni sifre gerekli' }); return }

  const ip = istekIp(req)
  const kilit = await girisKilitli(kayit.h, ip)
  if (kilit.kilitli) { kilitYaniti(res, kilit.kalanSn); return }

  try {
    const hataliKod = async () => {
      const d = await hataliDeneme(kayit.h, ip)
      if (d.kilitSn) kilitYaniti(res, d.kilitSn)
      else res.status(400).json({ error: 'Kod hatali', code: 'kod' })
    }
    const beklenen = Buffer.from(kayit.kh, 'hex'), gelen = Buffer.from(kodOzeti(kayit, kod), 'hex')
    if (!kayit.uid || beklenen.length !== gelen.length || !crypto.timingSafeEqual(beklenen, gelen)) { await hataliKod(); return }

    const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('id', kayit.uid).maybeSingle()
    if (error) throw error
    // Hesap silinmis ya da sifre bu arada degismis (token zaten kullanilmis)
    if (!user || sifreOzeti(user) !== kayit.pp) {
      res.status(400).json({ error: 'Kodun suresi doldu. Yeniden kod isteyin.', code: 'sure' })
      return
    }

    const kuralHatasi = sifreKurallari(password, user.username)
    if (kuralHatasi) { res.status(400).json({ error: kuralHatasi, code: 'kural' }); return }

    const { error: uErr } = await supabaseAdmin
      .from('users').update({ password: await hashPassword(password) }).eq('id', user.id)
    if (uErr) throw uErr
    // Eski sifreyle acilmis oturumlar kapanir (bkz. api/users.js ayni gerekce)
    await oturumlariKapat(user.id)
    await basariliGiris(kayit.h, ip)
    // E-postasina erisimi kanitladi: unutulan sifreyle denerken olusan giris kilidi de kalkar
    await basariliGiris(user.username, ip)
    await denetimYaz(user.org_id, {
      user: user.username, role: user.role, action: 'profil', ip,
      detail: 'Sifre e-posta koduyla sifirlandi',
    })
    res.status(200).json({ ok: true, username: user.username })
  } catch (e) {
    console.error('sifre yenile basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}
