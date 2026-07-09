import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAdmin } from '../lib/auth.js'
import { hashPassword } from '../lib/password.js'

// GET  /api/users  - tum kullanicilari listeler (sifresiz)
// POST /api/users  - yeni kullanici olusturur
// Ikisi de yalnizca admin rolundeki gecerli bir oturum tokeniyle calisir.
export default async function handler(req, res) {
  const claims = requireAdmin(req)
  if (!claims) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('users').select('*').order('created_at', { ascending: true })
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
    try {
      const hashed = await hashPassword(password)
      const { data, error } = await supabaseAdmin
        .from('users')
        .insert([{ username, password: hashed, role, sections, buildings, permissions: permissions || {} }])
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
