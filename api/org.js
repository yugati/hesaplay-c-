import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth, signSession, SESSION_TTL_DEFAULT, SESSION_TTL_REMEMBER } from '../lib/auth.js'
import { aktifOrg, orgIdGecerli } from '../lib/org.js'

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZASYON UCU
//
// GET  /api/org                          -> { orgs, aktif, super }
// POST /api/org  { op:'gecis', org }     -> { token, org, ttl }  (yalnizca super)
// POST /api/org  { op:'yeni', id, ad }   -> { org }              (yalnizca super)
//
// NEDEN AYRI BIR UC: 'organizations' tablosu bilerek /api/veri beyaz listesinde
// degil. Oradan erisilebilseydi herhangi bir kullanici kendi kiraci kaydini
// duzenleyebilir ya da yeni kiraci uydurabilirdi.
//
// GECIS TOKENI YENIDEN IMZALAR. Aktif organizasyonu istemcide bir degiskende
// tutup her istekte gondermek, o degiskeni degistiren herkese butun sirketlerin
// verisini acmak demekti. Imzali tokende duran bir iddiayi ise kullanici
// degistiremez - sunucu her istekte ayni tek kaynaga bakar (bkz. lib/org.js).
//
// YENI ORGANIZASYON BOMBOS DOGAR: hicbir tanim, sartname ya da kutuphane
// kopyalanmaz (alinan karar). Yeni sirket kendi verisini bastan girer.
// ─────────────────────────────────────────────────────────────────────────────

function orgSatiri(r) {
  return { id: r.id, ad: (r.data && r.data.ad) || r.id, aktif: r.aktif !== false }
}

export default async function handler(req, res) {
  const claims = requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  const org = await aktifOrg(claims)

  if (req.method === 'GET') {
    try {
      /* Super olmayan kullanici YALNIZCA kendi organizasyonunu gorur. Tam listeyi
         donmek, degistirici dugmeyi gizlesek bile sirket adlarini sizdirirdi. */
      let sorgu = supabaseAdmin.from('organizations').select('id, data, aktif')
      if (!claims.sup) sorgu = sorgu.eq('id', org)
      const { data, error } = await sorgu.order('id', { ascending: true })
      if (error) throw error
      const orgs = (data || []).filter(r => claims.sup ? r.aktif !== false : true).map(orgSatiri)
      res.status(200).json({ orgs, aktif: org, super: !!claims.sup })
    } catch (e) {
      console.error('org GET basarisiz', e)
      res.status(500).json({ error: 'Sunucu hatasi' })
    }
    return
  }

  if (req.method === 'POST') {
    const { op } = req.body || {}
    if (op !== 'gecis' && op !== 'yeni') { res.status(400).json({ error: 'Bilinmeyen islem' }); return }
    if (!claims.sup) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

    if (op === 'yeni') {
      const { id, ad } = req.body || {}
      /* Kimlik kurallari lib/org.js'te: kucuk harf/rakam/tire, 'siparis' gibi
         DOSYA YOLU parcalariyla cakisamaz. Bu dar liste kazara degil - org kimligi
         hem imzali tokende hem depolama yolunda geciyor. */
      if (!orgIdGecerli(id)) {
        res.status(400).json({ error: 'Kimlik yalnizca kucuk harf, rakam ve tire icerebilir (ornek: yuem)' }); return
      }
      const isim = String(ad || '').trim()
      if (!isim || isim.length > 60) { res.status(400).json({ error: 'Organizasyon adi gerekli (en fazla 60 karakter)' }); return }

      try {
        const { error } = await supabaseAdmin.from('organizations').insert([{ id, data: { ad: isim } }])
        if (error) {
          if (error.code === '23505') { res.status(409).json({ error: 'Bu kimlikte bir organizasyon zaten var' }); return }
          throw error
        }
        // Organizasyon BOS dogar; ilk kullanicisi Kullanicilar ekranindan, o
        // organizasyona GECILDIKTEN sonra acilir (api/users.js aktif org'a yazar).
        res.status(201).json({ org: { id, ad: isim, aktif: true } })
      } catch (e) {
        console.error('org yeni basarisiz', e)
        res.status(500).json({ error: 'Sunucu hatasi' })
      }
      return
    }

    const hedef = (req.body || {}).org
    if (!orgIdGecerli(hedef)) { res.status(400).json({ error: 'Gecersiz organizasyon' }); return }

    try {
      /* Bayrak TOKENDEN degil KAYITTAN da dogrulanir: super yetkisi geri alinmis
         bir kullanicinin elinde eski tokeni 20 dakikaya kadar gecerli kalabilir -
         bu sure boyunca organizasyon degistirebilmesi dogru olmazdi. */
      const { data: user, error: uErr } = await supabaseAdmin
        .from('users').select('*').eq('id', claims.sub).maybeSingle()
      if (uErr) throw uErr
      if (!user) { res.status(401).json({ error: 'Kullanici bulunamadi' }); return }
      if (!user.is_super) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

      const { data: o, error: oErr } = await supabaseAdmin
        .from('organizations').select('id, data, aktif').eq('id', hedef).maybeSingle()
      if (oErr) throw oErr
      if (!o || o.aktif === false) { res.status(404).json({ error: 'Organizasyon bulunamadi' }); return }

      // Kalan omur korunur: gecis yapmak "Beni Hatirla" ile acilmis uzun oturumu
      // 1 saate dusurmesin (api/me.js ile ayni olcut).
      const kalanMs = claims.exp ? (claims.exp * 1000 - Date.now()) : 0
      const ttl = kalanMs > SESSION_TTL_DEFAULT ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT

      res.status(200).json({ token: signSession(user, ttl, o.id), org: o.id, ad: orgSatiri(o).ad, ttl })
    } catch (e) {
      console.error('org gecis basarisiz', e)
      res.status(500).json({ error: 'Sunucu hatasi' })
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
