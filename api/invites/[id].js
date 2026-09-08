import { supabaseAdmin } from '../../lib/supabaseAdmin.js'
import { requireAdmin } from '../../lib/auth.js'
import { aktifOrg } from '../../lib/org.js'
import { uretToken, tokenHash, davetLinki, DAVET_GECERLILIK_MS } from '../../lib/invites.js'
import { epostaGonder, davetEpostaHtml } from '../../lib/email.js'

const ROL_AD = { admin: 'Yonetici', izleyici: 'Izleyici', saha_personeli: 'Saha Personeli' }

// PUT    /api/invites/:id - daveti yeniden gonderir (token doner, sure uzar, eposta tekrar denenir)
// DELETE /api/invites/:id - daveti iptal eder
// Ikisi de yalnizca admin, ve yalnizca AKTIF ORGANIZASYONUN kendi daveti icin -
// api/users/[id].js ile ayni org-sahiplik kontrolu.
export default async function handler(req, res) {
  const claims = requireAdmin(req)
  if (!claims) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

  const { id } = req.query
  if (!id) { res.status(400).json({ error: 'id gerekli' }); return }

  const org = await aktifOrg(claims)
  const { data: davet } = await supabaseAdmin
    .from('invites').select('id, org_id, email, role').eq('id', id).maybeSingle()
  if (!davet || davet.org_id !== org) { res.status(404).json({ error: 'Davet bulunamadi' }); return }

  if (req.method === 'PUT') {
    try {
      const token = uretToken()
      const expiresAt = new Date(Date.now() + DAVET_GECERLILIK_MS).toISOString()
      const { data, error } = await supabaseAdmin
        .from('invites')
        .update({ token_hash: tokenHash(token), expires_at: expiresAt, used_at: null, used_by: null })
        .eq('id', id).eq('org_id', org)
        .select('id, email, role, expires_at, created_at').single()
      if (error) throw error

      const { data: orgRow } = await supabaseAdmin.from('organizations').select('data').eq('id', org).maybeSingle()
      const orgAd = (orgRow && orgRow.data && orgRow.data.ad) || org
      const link = davetLinki(token, req.headers.origin)
      const eposta = await epostaGonder({
        to: davet.email,
        subject: orgAd + ' - hesap daveti',
        html: davetEpostaHtml({ orgAd, rolAd: ROL_AD[davet.role] || davet.role, link }),
      })

      res.status(200).json({ ...data, link, emailSent: eposta.sent })
    } catch (e) {
      console.error('invites PUT basarisiz', e)
      res.status(500).json({ error: e.message || 'Sunucu hatasi' })
    }
    return
  }

  if (req.method === 'DELETE') {
    try {
      const { error } = await supabaseAdmin.from('invites').delete().eq('id', id).eq('org_id', org)
      if (error) throw error
      res.status(200).json({ ok: true })
    } catch (e) {
      console.error('invites DELETE basarisiz', e)
      res.status(500).json({ error: e.message || 'Sunucu hatasi' })
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
