import { supabaseAdmin } from '../../lib/supabaseAdmin.js'
import { requireAdmin } from '../../lib/auth.js'
import { hashPassword } from '../../lib/password.js'

// PUT    /api/users/:id - kullanici guncelle (sifre bos birakilirsa degismez)
// DELETE /api/users/:id - kullanici sil
// Ikisi de yalnizca admin rolundeki gecerli bir oturum tokeniyle calisir.
export default async function handler(req, res) {
  const claims = requireAdmin(req)
  if (!claims) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

  const { id } = req.query
  if (!id) { res.status(400).json({ error: 'id gerekli' }); return }

  if (req.method === 'PUT') {
    const { password, role, sections, buildings, permissions } = req.body || {}
    const update = { role, sections, buildings }
    if (permissions !== undefined) update.permissions = permissions
    if (password) update.password = await hashPassword(password)
    try {
      const { data, error } = await supabaseAdmin
        .from('users').update(update).eq('id', id).select().single()
      if (error) throw error
      const safe = { ...data }; delete safe.password
      res.status(200).json(safe)
    } catch (e) {
      console.error('users PUT basarisiz', e)
      res.status(500).json({ error: e.message || 'Sunucu hatasi' })
    }
    return
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabaseAdmin.from('users').delete().eq('id', id)
      if (error) throw error
      res.status(200).json({ ok: true })
    } catch (e) {
      console.error('users DELETE basarisiz', e)
      res.status(500).json({ error: e.message || 'Sunucu hatasi' })
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
