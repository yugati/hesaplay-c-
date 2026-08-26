import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { signSession, SESSION_TTL_DEFAULT, SESSION_TTL_REMEMBER } from '../lib/auth.js'
import { verifyPassword, hashPassword, isHashed } from '../lib/password.js'
import { girisKilitli, hataliDeneme, basariliGiris, istekIp } from '../lib/girisKoruma.js'
import { VARSAYILAN_ORG } from '../lib/org.js'

// Kilit mesaji: kalan sureyi insan diliyle yazar
function kalanMetin(sn) {
  if (sn >= 60) { const d = Math.ceil(sn / 60); return d + ' dakika' }
  return sn + ' saniye'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { username, password, rememberMe } = req.body || {}
  if (!username || !password) { res.status(400).json({ error: 'Kullanici adi ve sifre gerekli' }); return }

  // KABA KUVVET ENGELI: sifre kontrolunden ONCE bakilir ki kilitliyken bcrypt
  // hesabi bile yapilmasin (saldirgan sunucuyu mesgul edemesin).
  const ip = istekIp(req)
  const kilit = await girisKilitli(username, ip)
  if (kilit.kilitli) {
    res.status(429).json({ error: 'Cok fazla hatali deneme. ' + kalanMetin(kilit.kalanSn) + ' sonra tekrar deneyin.' })
    return
  }

  let user
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .ilike('username', username)
      .maybeSingle()
    if (error) throw error
    user = data
  } catch (e) {
    console.error('login: kullanici sorgusu basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
    return
  }

  /* Kullanici YOKSA da deneme sayilir ve mesaj AYNI kalir: aksi halde "kilitlendi"
     cevabi hangi kullanici adlarinin gercek oldugunu ele verirdi. */
  const basarisiz = async () => {
    const d = await hataliDeneme(username, ip)
    if (d.kilitSn) {
      res.status(429).json({ error: 'Cok fazla hatali deneme. ' + kalanMetin(d.kilitSn) + ' sonra tekrar deneyin.' })
    } else {
      res.status(401).json({ error: 'Kullanici adi veya sifre hatali' })
    }
  }

  if (!user) { await basarisiz(); return }

  const ok = await verifyPassword(password, user.password)
  if (!ok) { await basarisiz(); return }

  await basariliGiris(username, ip)

  // Eski duz metin sifreyi basarili girişten sonra sessizce hash'e yukselt.
  if (!isHashed(user.password)) {
    try {
      const newHash = await hashPassword(password)
      await supabaseAdmin.from('users').update({ password: newHash }).eq('id', user.id)
    } catch (e) {
      console.warn('login: sifre hash yukseltme basarisiz (giris yine de devam eder)', e)
    }
  }

  const ttlMs = rememberMe ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT
  const safeUser = { ...user }
  delete safeUser.password
  // Giriste aktif organizasyon HER ZAMAN kullanicinin kendi organizasyonudur;
  // super yonetici gecis yaparsa token api/org.js'te yeniden imzalanir.
  const token = signSession(safeUser, ttlMs)
  res.status(200).json({ user: safeUser, org: safeUser.org_id || VARSAYILAN_ORG, token })
}
