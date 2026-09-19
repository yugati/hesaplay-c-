import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAdmin } from '../lib/auth.js'
import { aktifOrg } from '../lib/org.js'
import { uretToken, tokenHash, davetLinki, DAVET_GECERLILIK_MS } from '../lib/invites.js'
import { epostaGonder, davetEpostaHtml } from '../lib/email.js'

const ROL_AD = { admin: 'Yonetici', izleyici: 'Izleyici', saha_personeli: 'Saha Personeli' }

// GET    /api/invites     - AKTIF ORGANIZASYONUN bekleyen/gecmis davetlerini listeler
// POST   /api/invites     - yeni davet olusturur, Resend ile eposta gondermeyi dener
// PUT    /api/invites/:id - daveti yeniden gonderir (token doner, sure uzar, eposta tekrar denenir)
// DELETE /api/invites/:id - daveti iptal eder
// Hepsi yalnizca admin rolundeki gecerli bir oturum tokeniyle calisir - ayni
// api/users.js deseni: tek dosya (Vercel Hobby'nin 12 fonksiyon siniri), id
// vercel.json rewrite'i ile ?id= olarak gelir (bkz. o dosyadaki not).
export default async function handler(req, res) {
  const claims = await requireAdmin(req)
  if (!claims) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

  const idParam = req.query.id
  const id = Array.isArray(idParam) ? idParam[0] : idParam
  const org = await aktifOrg(claims)

  if (!id) {
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
    return
  }

  // ---- id VERILMIS: PUT / DELETE ----
  // api/users.js ile ayni org-sahiplik kontrolu.
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
