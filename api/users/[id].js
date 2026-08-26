import { supabaseAdmin } from '../../lib/supabaseAdmin.js'
import { requireAdmin } from '../../lib/auth.js'
import { hashPassword, sifreKurallari } from '../../lib/password.js'
import { aktifOrg, VARSAYILAN_ORG } from '../../lib/org.js'

// PUT    /api/users/:id - kullanici guncelle (sifre bos birakilirsa degismez)
// DELETE /api/users/:id - kullanici sil
// Ikisi de yalnizca admin rolundeki gecerli bir oturum tokeniyle calisir.
//
// ORGANIZASYON: hedef kullanici AKTIF ORGANIZASYONDA olmak zorunda. Bu kontrol
// olmadan bir sirketin yoneticisi, id'sini bildigi baska bir sirketin hesabinin
// sifresini degistirebilir ya da onu silebilirdi - kullanici listesini org'a
// daraltmak (api/users.js) tek basina yetmez, id dogrudan da verilebiliyor.
export default async function handler(req, res) {
  const claims = requireAdmin(req)
  if (!claims) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

  const { id } = req.query
  if (!id) { res.status(400).json({ error: 'id gerekli' }); return }

  const org = await aktifOrg(claims)
  const { data: hedef } = await supabaseAdmin
    .from('users').select('id, username, org_id, is_super').eq('id', id).maybeSingle()
  /* Baska organizasyonun kullanicisi icin de "bulunamadi" denir, "yetkiniz yok"
     denmez: ikinci mesaj o id'nin baska bir sirkette var oldugunu ele verirdi. */
  if (!hedef || (hedef.org_id || VARSAYILAN_ORG) !== org) {
    res.status(404).json({ error: 'Kullanici bulunamadi' }); return
  }
  // Super yonetici hesabina yalnizca super yonetici dokunabilir: aksi halde kendi
  // organizasyonundaki bir yonetici tek super hesabin sifresini degistirip
  // butun organizasyonlara erisebilirdi.
  if (hedef.is_super && !claims.sup) {
    res.status(403).json({ error: 'Bu hesap uzerinde islem yapamazsiniz' }); return
  }

  if (req.method === 'PUT') {
    const { password, role, sections, buildings, permissions } = req.body || {}
    const update = { role, sections, buildings }
    if (permissions !== undefined) update.permissions = permissions
    if (password) {
      // Asama 4: sifre kurali. Kullanici adi hedef kayittan geliyor ki "sifre =
      // kullanici adi" durumu da yakalansin.
      const kuralHatasi = sifreKurallari(password, hedef.username)
      if (kuralHatasi) { res.status(400).json({ error: kuralHatasi }); return }
      update.password = await hashPassword(password)
    }
    try {
      const { data, error } = await supabaseAdmin
        .from('users').update(update).eq('id', id).eq('org_id', org).select().single()
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
      const { error } = await supabaseAdmin.from('users').delete().eq('id', id).eq('org_id', org)
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
