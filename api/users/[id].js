import { supabaseAdmin } from '../../lib/supabaseAdmin.js'
import { requireAdmin } from '../../lib/auth.js'
import { hashPassword, sifreKurallari } from '../../lib/password.js'
import { aktifOrg, VARSAYILAN_ORG } from '../../lib/org.js'
import { denetimGorebilir, tokenKullanici } from '../../lib/yetki.js'
import { adUyumlu } from '../../lib/adSutunu.js'

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
    .from('users').select('id, username, org_id, is_super, role, permissions').eq('id', id).maybeSingle()
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
    const { password, role, sections, buildings, permissions, tel, email, meslek, ad } = req.body || {}
    const update = { role, sections, buildings }
    if (permissions !== undefined) update.permissions = permissions

    /* ─── DENETIM KAYDI YETKISI ────────────────────────────────────────────
       Yetki users.permissions.denetim icinde durur ve UC kurala baglidir:

       1. YALNIZCA YONETICI tasiyabilir. Rol admin degilse alan silinir - aksi
          halde bir kullanici once yonetici yapilip yetki verilip sonra saha
          personeline dusurulerek gizli bir denetim okuyucusu birakilabilirdi.
       2. Yetkiyi ancak YETKISI OLAN degistirir. Bu kontrol olmadan atama kagit
          uzerinde kalirdi: her yonetici Kullanici Yonetimi'ni acabildigi icin,
          yetkisi alinan yonetici saniyeler icinde kendine geri verebilirdi.
       3. SON YETKILI DUSURULEMEZ. Organizasyonda denetim kaydini gorebilen
          kimse kalmazsa yetkiyi geri acabilecek kimse de kalmaz - kayit
          kimsenin ulasamadigi bir tabloya donerdi.
       Deger her kaydetmede ACIKCA yazilir (bkz. lib/yetki.js geriye uyum notu). */
    const rolSon = role || hedef.role
    const eskiVar = denetimGorebilir({ role: hedef.role, permissions: hedef.permissions || {} })
    let yeniVar = eskiVar
    if (rolSon !== 'admin') {
      yeniVar = false
      if (update.permissions) { const k = { ...update.permissions }; delete k.denetim; update.permissions = k }
    } else if (permissions !== undefined) {
      const d = permissions.denetim
      yeniVar = d ? !!d.read : true          // alan yoksa eski istemci: bugunku durumu korur
      if (yeniVar !== eskiVar && !denetimGorebilir(tokenKullanici(claims))) {
        res.status(403).json({ error: 'Denetim kaydi yetkisini yalnizca bu yetkiye sahip bir yonetici degistirebilir' })
        return
      }
      update.permissions = { ...permissions, denetim: { read: yeniVar } }
    }
    if (eskiVar && !yeniVar) {
      const { data: yoneticiler } = await supabaseAdmin
        .from('users').select('id, role, permissions').eq('org_id', org).eq('role', 'admin')
      const kalan = (yoneticiler || []).filter(u => u.id !== id && denetimGorebilir({ role: u.role, permissions: u.permissions || {} }))
      if (!kalan.length) {
        res.status(400).json({ error: 'Denetim kaydini gorebilen son yonetici bu kullanici - once baska bir yoneticiye yetki verin' })
        return
      }
    }
    if (tel !== undefined) update.tel = tel
    if (email !== undefined) update.email = email
    if (meslek !== undefined) update.meslek = meslek
    /* GORUNEN AD. Yonetici de girebilir (yeni hesap acarken kisinin adi bilinir),
       ama kullanici da kendi degistirebilir - bkz. api/profil.js. Giris adi
       (username) buradan da degismez: kimlik anahtaridir. */
    if (ad !== undefined) update.ad = String(ad).trim().slice(0, 60)
    if (password) {
      // Asama 4: sifre kurali. Kullanici adi hedef kayittan geliyor ki "sifre =
      // kullanici adi" durumu da yakalansin.
      const kuralHatasi = sifreKurallari(password, hedef.username)
      if (kuralHatasi) { res.status(400).json({ error: kuralHatasi }); return }
      update.password = await hashPassword(password)
    }
    try {
      // adUyumlu: users.ad sutunu henuz eklenmemisse guncelleme adsiz gecer (bkz. lib/adSutunu.js)
      const { data, error } = await adUyumlu(adDahil => {
        const govde = { ...update }
        if (!adDahil) delete govde.ad
        return supabaseAdmin.from('users').update(govde).eq('id', id).eq('org_id', org).select().single()
      })
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
