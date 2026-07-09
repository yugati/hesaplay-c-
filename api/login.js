import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { signSession, SESSION_TTL_DEFAULT, SESSION_TTL_REMEMBER } from '../lib/auth.js'
import { verifyPassword, hashPassword, isHashed } from '../lib/password.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { username, password, rememberMe } = req.body || {}
  if (!username || !password) { res.status(400).json({ error: 'Kullanici adi ve sifre gerekli' }); return }

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

  if (!user) { res.status(401).json({ error: 'Kullanici adi veya sifre hatali' }); return }

  const ok = await verifyPassword(password, user.password)
  if (!ok) { res.status(401).json({ error: 'Kullanici adi veya sifre hatali' }); return }

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
  const token = signSession(safeUser, ttlMs)
  res.status(200).json({ user: safeUser, token })
}
