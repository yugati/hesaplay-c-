import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'

// Aktif oturumun kullanicisini tazeler (ör. baska bir admin yetkisini
// degistirdiyse sayfa yenilemede yansisin diye arka planda cagrilir).
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const claims = requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users').select('*').eq('id', claims.sub).maybeSingle()
    if (error) throw error
    if (!user) { res.status(404).json({ error: 'Kullanici bulunamadi' }); return }
    const safeUser = { ...user }
    delete safeUser.password
    res.status(200).json({ user: safeUser })
  } catch (e) {
    console.error('me: kullanici sorgusu basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}
