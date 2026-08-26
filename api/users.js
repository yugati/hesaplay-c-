import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAdmin } from '../lib/auth.js'
import { hashPassword, sifreKurallari } from '../lib/password.js'
import { aktifOrg } from '../lib/org.js'

// GET  /api/users  - AKTIF ORGANIZASYONUN kullanicilarini listeler (sifresiz)
// POST /api/users  - aktif organizasyonda yeni kullanici olusturur
// Ikisi de yalnizca admin rolundeki gecerli bir oturum tokeniyle calisir.
//
// ORGANIZASYON: bir sirketin yoneticisi yalnizca KENDI sirketinin kullanicilarini
// gorur ve olusturur. Super yonetici hangi organizasyona gectiyse orada calisir -
// kapsam her zaman tokendeki aktif organizasyondur, istekten gelen bir alan degil.
export default async function handler(req, res) {
  const claims = requireAdmin(req)
  if (!claims) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

  const org = await aktifOrg(claims)

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('users').select('*').eq('org_id', org).order('created_at', { ascending: true })
      if (error) throw error
      res.status(200).json((data || []).map(u => { const c = { ...u }; delete c.password; return c }))
    } catch (e) {
      console.error('users GET basarisiz', e)
      res.status(500).json({ error: 'Sunucu hatasi' })
    }
    return
  }

  if (req.method === 'POST') {
    const { username, password, role, sections, buildings, permissions } = req.body || {}
    if (!username || !password) { res.status(400).json({ error: 'Kullanici adi ve sifre gerekli' }); return }
    // Asama 4: yeni sifreler asgari kuraldan gecer (bkz. lib/password.js sifreKurallari)
    const kuralHatasi = sifreKurallari(password, username)
    if (kuralHatasi) { res.status(400).json({ error: kuralHatasi }); return }
    try {
      const hashed = await hashPassword(password)
      /* org_id ZORLA aktif organizasyon; is_super ZORLA false. Super yoneticilik
         bu uctan verilemez - verilebilseydi herhangi bir sirket yoneticisi kendine
         butun organizasyonlari acan bir hesap yaratabilirdi. O bayrak yalnizca
         veritabanindan elle konur (bkz. migration_org_1.sql). */
      const { data, error } = await supabaseAdmin
        .from('users')
        .insert([{ username, password: hashed, role, sections, buildings, permissions: permissions || {}, org_id: org, is_super: false }])
        .select().single()
      if (error) throw error
      const safe = { ...data }; delete safe.password
      res.status(201).json(safe)
    } catch (e) {
      if (e && (e.code === '23505' || String(e.message).includes('unique'))) {
        res.status(409).json({ error: 'Bu kullanici adi zaten var', code: '23505' })
      } else {
        console.error('users POST basarisiz', e)
        res.status(500).json({ error: e.message || 'Sunucu hatasi' })
      }
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
