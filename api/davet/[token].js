import { supabaseAdmin } from '../../lib/supabaseAdmin.js'
import { tokenHash } from '../../lib/invites.js'

const ROL_AD = { admin: 'Yonetici', izleyici: 'Izleyici', saha_personeli: 'Saha Personeli' }

// GET /api/davet/:token - KIMLIK DOGRULAMASIZ, herkese acik.
// Davet kabul ekrani, form gostermeden once daveti onizler: hangi organizasyon,
// hangi rol, kime gonderilmis. Token gecersiz/kullanilmis/suresi gecmisse 404 -
// bulunamadi ile "gecersiz token" arasinda fark gostermek saldirgan icin
// bilgi sizdirir, o yuzden ayrilmiyor (login.js'teki "kullanici yok" mantigiyla ayni).
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }
  const { token } = req.query
  if (!token) { res.status(400).json({ error: 'token gerekli' }); return }

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
