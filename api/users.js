import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAdmin, signSession, yenilenenTtl } from '../lib/auth.js'
import { oturumlariKapat } from '../lib/oturum.js'
import { hashPassword, sifreKurallari } from '../lib/password.js'
import { aktifOrg, VARSAYILAN_ORG } from '../lib/org.js'
import { aktifTasari } from '../lib/tasari.js'
import { denetimGorebilir, tokenKullanici } from '../lib/yetki.js'
import { adUyumlu } from '../lib/adSutunu.js'

// GET    /api/users     - AKTIF ORGANIZASYONUN kullanicilarini listeler (sifresiz)
// POST   /api/users     - aktif organizasyonda yeni kullanici olusturur
// PUT    /api/users/:id - kullanici guncelle (sifre bos birakilirsa degismez)
// DELETE /api/users/:id - kullanici sil
// Hepsi yalnizca admin rolundeki gecerli bir oturum tokeniyle calisir.
//
// TEK DOSYADA: id'li ve id'siz uclar eskiden ayri dosyalardaydi (users.js +
// users/[id].js). Vercel Hobby plani deploy basina 12 Serverless Function ile
// sinirli - iki dosya bu sayiyi astirip deploy'u "Deploying outputs..."
// asamasinda sessizce basarisiz birakiyordu.
//
// id, vercel.json'daki rewrite ile SORGU PARAMETRESI olarak gelir:
//   /api/users/:id  ->  /api/users?id=:id
// Dosya adinda [[...id]] (optional catch-all) KULLANILMAZ: Next.js olmayan bir
// Vercel projesinde o desen yok - rota tek segmentlik kalir, /api/users 404
// doner ve parametre 'id' degil '[...id]' adiyla gelir. 14 Eylul 2026'da canli
// bu yuzden bozuldu (Kullanici Yonetimi "Istek basarisiz (404)").
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
      const { username, password, role, sections, buildings, permissions, tel, email, meslek, ad } = req.body || {}
      if (!username || !password) { res.status(400).json({ error: 'Kullanici adi ve sifre gerekli' }); return }
      // Asama 4: yeni sifreler asgari kuraldan gecer (bkz. lib/password.js sifreKurallari)
      const kuralHatasi = sifreKurallari(password, username)
      if (kuralHatasi) { res.status(400).json({ error: kuralHatasi }); return }
      /* DENETIM KAYDI YETKISI YENI HESAPTA VARSAYILAN OLARAK KAPALIDIR.
         lib/yetki.js'teki "alan yoksa acik" kurali yalnizca GERIYE UYUM icindir -
         ozellik gelmeden once var olan yoneticiler ekrandan dusmesin diye. Yeni
         acilan bir yoneticiye ayni kural uygulansaydi, "istedigim yoneticiye
         atarim" kurali daha ilk hesapta delinirdi: her yeni yonetici kendiliginden
         denetim okuyucusu olurdu. O yuzden deger burada ACIKCA yazilir. */
      const izinler = { ...(permissions || {}) }
      if (role === 'admin') {
        const istenen = izinler.denetim ? !!izinler.denetim.read : false
        if (istenen && !denetimGorebilir(tokenKullanici(claims))) {
          res.status(403).json({ error: 'Denetim kaydi yetkisini yalnizca bu yetkiye sahip bir yonetici verebilir' })
          return
        }
        izinler.denetim = { read: istenen }
      } else {
        delete izinler.denetim   // yetkiyi yalnizca Yonetici tasiyabilir
      }

      try {
        const hashed = await hashPassword(password)
        /* org_id ZORLA aktif organizasyon; is_super ZORLA false. Super yoneticilik
           bu uctan verilemez - verilebilseydi herhangi bir sirket yoneticisi kendine
           butun organizasyonlari acan bir hesap yaratabilirdi. O bayrak yalnizca
           veritabanindan elle konur (bkz. migration_org_1.sql). */
        /* tasari_id ACIKCA YAZILIR. migration_tasari_2.sql sutunun varsayilanini
           dusuruyor (bir hatanin veriyi sessizce AKKUYU NGS'ye doldurmasini
           engellemek icin), yani burada verilmezse insert NOT NULL ihlaliyle
           doner. Deger, kullaniciyi OLUSTURAN yoneticinin aktif tasarisidir:
           yonetici hangi projede calisiyorsa yeni kullanici da orada acilir.
           Bir kilit degil, bir baslangic noktasi - herkes tasarilar arasinda
           gecebilir (bkz. lib/tasari.js).
           adUyumlu'nun DISINDA cozulur: o sarmalayici geri cagirmayi gerektiginde
           ikinci kez calistiriyor ve geri cagirma senkron - icine await konamaz. */
        const tasari = await aktifTasari(claims)
        // adUyumlu: users.ad sutunu henuz eklenmemisse kayit adsiz gecer (bkz. lib/adSutunu.js)
        const { data, error } = await adUyumlu(adDahil => {
          const satir = { username, password: hashed, role, sections, buildings, permissions: izinler, tel: tel || '', email: email || '', meslek: meslek || '', org_id: org, tasari_id: tasari, is_super: false }
          if (adDahil) satir.ad = ad || ''
          return supabaseAdmin.from('users').insert([satir]).select().single()
        })
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
    return
  }

  // ---- id VERILMIS: PUT / DELETE ----
  // ORGANIZASYON: hedef kullanici AKTIF ORGANIZASYONDA olmak zorunda. Bu kontrol
  // olmadan bir sirketin yoneticisi, id'sini bildigi baska bir sirketin hesabinin
  // sifresini degistirebilir ya da onu silebilirdi - kullanici listesini org'a
  // daraltmak tek basina yetmez, id dogrudan da verilebiliyor.
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
      /* SIFRE DEGISTIYSE HEDEF KULLANICININ TUM ACIK OTURUMLARI KAPANIR: yonetici
         sifreyi genellikle hesabin ele gecirildiginden suphelenildiginde ya da
         calisan ayrilirken sifirlar - eski sifreyle acilmis oturum yasamaya
         devam ederse sifirlamanin anlami kalmaz. Sayac artirma BASARISIZ olsa
         (sutun yok) sifre degisikligi yine gecerli kalir (bkz. lib/oturum.js).
         Yonetici KENDI sifresini degistiriyorsa kendi oturumu da dusmesin diye
         yeni sayacli taze token doner. */
      if (password) {
        const yeniSurum = await oturumlariKapat(id)
        if (yeniSurum !== null && id === claims.sub) {
          const ttl = yenilenenTtl(claims)
          res.status(200).json({ ...safe, token: signSession({ ...data, oturum_surumu: yeniSurum }, ttl, claims.org, claims.tas), ttl })
          return
        }
      }
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
