import { supabaseAdmin } from '../../../lib/supabaseAdmin.js'
import { tokenHash } from '../../../lib/invites.js'
import { hashPassword, sifreKurallari } from '../../../lib/password.js'
import { signSession, SESSION_TTL_DEFAULT } from '../../../lib/auth.js'
import { girisKilitli, hataliDeneme, basariliGiris, istekIp } from '../../../lib/girisKoruma.js'

function kalanMetin(sn) {
  if (sn >= 60) { const d = Math.ceil(sn / 60); return d + ' dakika' }
  return sn + ' saniye'
}

// POST /api/davet/:token/kabul - KIMLIK DOGRULAMASIZ, herkese acik.
// Gecerli bir davetle kendi kullanici adi/sifresini secip hesabini acar ve
// oturum tokeniyle otomatik giris yapmis olarak doner - api/login.js'teki
// basariyla-giris akisinin ayni sonucu.
//
// KABA KUVVET: kullanici adi henuz yokken tek hedef tokenin kendisi (birisi
// rastgele tokenler deneyerek gecerli bir davet bulmaya calisabilir). Ayni
// lib/girisKoruma.js kilit mekanizmasi IP anahtariyla burada da kullanilir.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const { token } = req.query
  const { username, password } = req.body || {}
  if (!token) { res.status(400).json({ error: 'token gerekli' }); return }
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

    const hashed = await hashPassword(password)
    const { data: user, error: insErr } = await supabaseAdmin
      .from('users')
      .insert([{
        username, password: hashed, role: davet.role, sections: davet.sections || [],
        buildings: davet.buildings || [], permissions: davet.permissions || {},
        email: davet.email, org_id: davet.org_id, is_super: false,
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
    res.status(201).json({ user: safeUser, token: sessionToken })
  } catch (e) {
    console.error('davet kabul basarisiz', e)
    res.status(500).json({ error: e.message || 'Sunucu hatasi' })
  }
}
