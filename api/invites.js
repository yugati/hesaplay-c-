import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAdmin } from '../lib/auth.js'
import { aktifOrg } from '../lib/org.js'
import { uretToken, tokenHash, davetLinki, DAVET_GECERLILIK_MS } from '../lib/invites.js'
import { epostaGonder, davetEpostaHtml } from '../lib/email.js'

const ROL_AD = { admin: 'Yonetici', izleyici: 'Izleyici', saha_personeli: 'Saha Personeli' }

// GET  /api/invites  - AKTIF ORGANIZASYONUN bekleyen/gecmis davetlerini listeler
// POST /api/invites  - yeni davet olusturur, Resend ile eposta gondermeyi dener
// Ikisi de yalnizca admin rolundeki gecerli bir oturum tokeniyle calisir - ayni
// api/users.js deseni.
export default async function handler(req, res) {
  const claims = requireAdmin(req)
  if (!claims) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

  const org = await aktifOrg(claims)

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('invites').select('id, email, role, sections, buildings, expires_at, used_at, created_at')
        .eq('org_id', org).order('created_at', { ascending: false })
      if (error) throw error
      res.status(200).json(data || [])
    } catch (e) {
      console.error('invites GET basarisiz', e)
      res.status(500).json({ error: 'Sunucu hatasi' })
    }
    return
  }

  if (req.method === 'POST') {
    const { email, role, sections, buildings, permissions } = req.body || {}
    if (!email || !String(email).includes('@')) { res.status(400).json({ error: 'Gecerli bir e-posta girin' }); return }
    if (!role) { res.status(400).json({ error: 'Rol gerekli' }); return }
    try {
      const token = uretToken()
      const expiresAt = new Date(Date.now() + DAVET_GECERLILIK_MS).toISOString()
      const { data, error } = await supabaseAdmin
        .from('invites')
        .insert([{
          org_id: org, email, role, sections: sections || [], buildings: buildings || [],
          permissions: permissions || {}, token_hash: tokenHash(token),
          created_by: claims.sub, expires_at: expiresAt,
        }])
        .select('id, email, role, expires_at, created_at').single()
      if (error) throw error

      const { data: orgRow } = await supabaseAdmin.from('organizations').select('data').eq('id', org).maybeSingle()
      const orgAd = (orgRow && orgRow.data && orgRow.data.ad) || org
      const link = davetLinki(token, req.headers.origin)
      const eposta = await epostaGonder({
        to: email,
        subject: orgAd + ' - hesap daveti',
        html: davetEpostaHtml({ orgAd, rolAd: ROL_AD[role] || role, link }),
      })

      res.status(201).json({ ...data, link, emailSent: eposta.sent })
    } catch (e) {
      console.error('invites POST basarisiz', e)
      res.status(500).json({ error: e.message || 'Sunucu hatasi' })
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
