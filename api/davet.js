import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { tokenHash } from '../lib/invites.js'
import { hashPassword, sifreKurallari } from '../lib/password.js'
import { signSession, SESSION_TTL_DEFAULT } from '../lib/auth.js'
import { girisKilitli, hataliDeneme, basariliGiris, istekIp } from '../lib/girisKoruma.js'
import { denetimYaz } from '../lib/denetim.js'
import { ilkTasari, VARSAYILAN_TASARI } from '../lib/tasari.js'
import sahaLink from '../lib/sahaLink.js'

const ROL_AD = { admin: 'Yonetici', izleyici: 'Izleyici', saha_personeli: 'Saha Personeli' }

function kalanMetin(sn) {
  if (sn >= 60) { const d = Math.ceil(sn / 60); return d + ' dakika' }
  return sn + ' saniye'
}

// GET  /api/davet/:token       - davet onizleme
// POST /api/davet/:token/kabul - daveti kabul edip hesap acar
// Ikisi de KIMLIK DOGRULAMASIZ, herkese acik. Eskiden ayri dosyalardi
// (davet/[token].js + davet/[token]/kabul.js) - api/users.js'teki notla ayni
// sebeple (Vercel Hobby 12 fonksiyon siniri) tek dosyada birlesti; URL semasi
// degismedi. token ve action vercel.json rewrite'lariyla sorgu olarak gelir:
//   /api/davet/:token        -> /api/davet?token=:token
//   /api/davet/:token/kabul  -> /api/davet?token=:token&action=kabul
// SAHA LINKI de burada: ayni tur (tokenli, hesapsiz acilan link) ve ayni sinir.
//   /api/saha-link[/:token]  -> /api/davet?tur=saha[&token=:token]  (bkz. lib/sahaLink.js)
export default async function handler(req, res) {
  const tur = Array.isArray(req.query.tur) ? req.query.tur[0] : req.query.tur
  if (tur === 'saha') return sahaLink(req, res)
  const { token } = req.query
  const actionParam = req.query.action
  const action = Array.isArray(actionParam) ? actionParam[0] : actionParam
  if (!token) { res.status(400).json({ error: 'token gerekli' }); return }

  if (!action) return davetOnizle(req, res, token)
  if (action === 'kabul') return davetKabul(req, res, token)
  res.status(404).json({ error: 'Bulunamadi' })
}

// Davet kabul ekrani, form gostermeden once daveti onizler: hangi organizasyon,
// hangi rol, kime gonderilmis. Token gecersiz/kullanilmis/suresi gecmisse 404 -
// bulunamadi ile "gecersiz token" arasinda fark gostermek saldirgan icin
// bilgi sizdirir, o yuzden ayrilmiyor (login.js'teki "kullanici yok" mantigiyla ayni).
async function davetOnizle(req, res, token) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  try {
    const { data: davet, error } = await supabaseAdmin
      .from('invites').select('org_id, email, role, expires_at, used_at')
      .eq('token_hash', tokenHash(token)).maybeSingle()
    if (error) throw error
    if (!davet || davet.used_at || new Date(davet.expires_at).getTime() < Date.now()) {
      res.status(404).json({ error: 'Davet linki gecersiz veya suresi dolmus' })
      return
    }
    const { data: orgRow } = await supabaseAdmin.from('organizations').select('data').eq('id', davet.org_id).maybeSingle()
    const orgAd = (orgRow && orgRow.data && orgRow.data.ad) || davet.org_id
    res.status(200).json({ orgAd, email: davet.email, role: davet.role, roleAd: ROL_AD[davet.role] || davet.role })
  } catch (e) {
    console.error('davet GET basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}

// Gecerli bir davetle kendi kullanici adi/sifresini secip hesabini acar ve
// oturum tokeniyle otomatik giris yapmis olarak doner - api/login.js'teki
// basariyla-giris akisinin ayni sonucu.
//
// KABA KUVVET: kullanici adi henuz yokken tek hedef tokenin kendisi (birisi
// rastgele tokenler deneyerek gecerli bir davet bulmaya calisabilir). Ayni
// lib/girisKoruma.js kilit mekanizmasi IP anahtariyla burada da kullanilir.
async function davetKabul(req, res, token) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const { username, password } = req.body || {}
  if (!username || !password) { res.status(400).json({ error: 'Kullanici adi ve sifre gerekli' }); return }

  const ip = istekIp(req)
  const kilitAnahtari = 'davet:' + ip
  const kilit = await girisKilitli(kilitAnahtari, ip)
  if (kilit.kilitli) {
    res.status(429).json({ error: 'Cok fazla hatali deneme. ' + kalanMetin(kilit.kalanSn) + ' sonra tekrar deneyin.' })
    return
  }

  try {
    const { data: davet, error: davetErr } = await supabaseAdmin
      .from('invites').select('*').eq('token_hash', tokenHash(token)).maybeSingle()
    if (davetErr) throw davetErr
    if (!davet || davet.used_at || new Date(davet.expires_at).getTime() < Date.now()) {
      await hataliDeneme(kilitAnahtari, ip)
      res.status(404).json({ error: 'Davet linki gecersiz veya suresi dolmus' })
      return
    }

    const kuralHatasi = sifreKurallari(password, username)
    if (kuralHatasi) { res.status(400).json({ error: kuralHatasi }); return }

    /* Davetle acilan YONETICI hesabinda da denetim yetkisi kapali baslar.
       Davet kaydindaki permissions bos bir nesne oldugu icin (index.html
       sendInvite admin rolunde izin gondermez), lib/yetki.js'teki "alan yoksa
       acik" geriye uyum kurali burada devreye girer ve davet edilen her
       yonetici kendiliginden denetim okuyucusu olurdu. Deger acikca yazilir. */
    const izinler = { ...(davet.permissions || {}) }
    if (davet.role === 'admin') izinler.denetim = { read: !!(izinler.denetim && izinler.denetim.read) }
    else delete izinler.denetim

    const hashed = await hashPassword(password)
    /* tasari_id ACIKCA YAZILIR - migration_tasari_2.sql varsayilani dusurdugu
       icin zorunlu. Daveti KABUL EDEN kisinin aktif tasarisi yoktur (henuz
       oturumu yok), o yuzden davet edildigi organizasyonun ILK tasarisina
       acilir. Bir kilit degil, bir baslangic noktasi: giris yaptiktan sonra
       diger projelere gecebilir. */
    const ilkTas = (await ilkTasari(davet.org_id)) || VARSAYILAN_TASARI
    const { data: user, error: insErr } = await supabaseAdmin
      .from('users')
      .insert([{
        username, password: hashed, role: davet.role, sections: davet.sections || [],
        buildings: davet.buildings || [], permissions: izinler,
        email: davet.email, org_id: davet.org_id, tasari_id: ilkTas, is_super: false,
      }])
      .select().single()
    if (insErr) {
      if (insErr.code === '23505' || String(insErr.message).includes('unique')) {
        res.status(409).json({ error: 'Bu kullanici adi zaten var', code: '23505' })
      } else {
        throw insErr
      }
      return
    }

    await supabaseAdmin.from('invites').update({ used_at: new Date().toISOString(), used_by: user.id }).eq('id', davet.id)
    await basariliGiris(kilitAnahtari, ip)

    const safeUser = { ...user }; delete safeUser.password
    const sessionToken = signSession(safeUser, SESSION_TTL_DEFAULT)
    // Davetle hesap acmak ayni zamanda ILK GIRISTIR - /api/login'den gecmedigi
    // icin kaydi burada yazilir, yoksa bu yoldan gelen kullanici loga hic dusmez.
    await denetimYaz(user.org_id, {
      user: user.username, role: user.role, action: 'login', ip,
      detail: 'Davetle hesap acildi (' + davet.email + ')',
    })
    res.status(201).json({ user: safeUser, token: sessionToken })
  } catch (e) {
    console.error('davet kabul basarisiz', e)
    res.status(500).json({ error: e.message || 'Sunucu hatasi' })
  }
}
