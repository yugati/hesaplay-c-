import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'

// ─────────────────────────────────────────────────────────────────────────────
// DOSYA ERISIMI (fatura PDF'leri + 3D bina modelleri)
//
// Iki kova da PRIVATE'dir; tarayicinin oralara dogrudan erisimi YOKTUR. Bu fonksiyon
// oturumu dogrular ve kisa omurlu IMZALI adres uretir.
//
// Dosyanin KENDISI bu fonksiyondan gecmez: sunucu yalnizca imzali adres verir,
// tarayici dosyayi dogrudan Storage'a gonderir/oradan alir. Boylece hem Vercel'in
// 4.5 MB istek govdesi siniri yola girmez, hem de tarayicida hicbir Supabase
// anahtari bulunmasi gerekmez (Asama 3: anon anahtar paketten tamamen kaldirildi).
// ─────────────────────────────────────────────────────────────────────────────

const INDIRME_OMRU = 300 // sn - sekmede acilmasina yeter, link paylasilirsa kisa surede oler

/* Kova tanimlari. Yol oneki ve uzanti beyaz listeyle sinirlidir: bu kontrol olmadan
   istemci 'path' ile kovadaki baska bir dosyayi isteyebilir ya da istedigi turde
   dosya yukleyebilirdi. */
const KOVALAR = {
  belgeler: { onek: /^(siparis|hareket|tutanak)\//, uzantilar: ['pdf'] },
  'bina-modelleri': { onek: /^model\//, uzantilar: ['glb', 'gltf'] },
}
// kind -> kova
const TUR_KOVA = { siparis: 'belgeler', hareket: 'belgeler', tutanak: 'belgeler', model: 'bina-modelleri' }

function kovaSec(ad) {
  const k = ad || 'belgeler'
  return KOVALAR[k] ? k : null
}
function yolGecerli(kova, p) {
  if (typeof p !== 'string' || !p || p.length > 300) return false
  if (p.includes('..') || p.startsWith('/') || p.includes('\\')) return false
  if (!KOVALAR[kova].onek.test(p)) return false
  return /^[A-Za-z0-9/_.-]+$/.test(p)
}
function uzanti(kova, ad) {
  const e = String(ad || '').split('.').pop().toLowerCase()
  return KOVALAR[kova].uzantilar.includes(e) ? e : null
}
function rastgele() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export default async function handler(req, res) {
  const claims = requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  try {
    // ── indirme: imzali okuma adresi ──────────────────────────────────────────
    if (req.method === 'GET') {
      const kova = kovaSec(req.query.kova)
      if (!kova) { res.status(400).json({ error: 'Gecersiz kova' }); return }
      const path = req.query.path
      if (!yolGecerli(kova, path)) { res.status(400).json({ error: 'Gecersiz dosya yolu' }); return }
      const { data, error } = await supabaseAdmin.storage.from(kova).createSignedUrl(path, INDIRME_OMRU)
      if (error || !data) { res.status(404).json({ error: 'Dosya bulunamadi' }); return }
      res.status(200).json({ url: data.signedUrl, expiresIn: INDIRME_OMRU })
      return
    }

    // ── yukleme: imzali yazma adresi ──────────────────────────────────────────
    // Govde: { kind:'siparis'|'hareket'|'tutanak'|'model', id:'<kayit id>', name:'dosya.pdf' }
    if (req.method === 'POST') {
      const { kind, id, name } = req.body || {}
      const kova = TUR_KOVA[kind]
      if (!kova) { res.status(400).json({ error: 'Gecersiz tur' }); return }
      if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(String(id))) { res.status(400).json({ error: 'Gecersiz kayit id' }); return }
      const ext = uzanti(kova, name)
      if (!ext) { res.status(400).json({ error: 'Bu turde dosya yuklenemez' }); return }

      const path = `${kind === 'model' ? 'model' : kind}/${id}/${rastgele()}.${ext}`
      const { data, error } = await supabaseAdmin.storage.from(kova).createSignedUploadUrl(path)
      if (error || !data) { res.status(500).json({ error: 'Yukleme adresi alinamadi' }); return }
      res.status(200).json({ kova, path, signedUrl: data.signedUrl, token: data.token })
      return
    }

    // ── silme: kayittan cikarilan dosyayi kovadan da al ───────────────────────
    if (req.method === 'DELETE') {
      const kova = kovaSec(req.query.kova)
      if (!kova) { res.status(400).json({ error: 'Gecersiz kova' }); return }
      const path = req.query.path
      if (!yolGecerli(kova, path)) { res.status(400).json({ error: 'Gecersiz dosya yolu' }); return }
      const { error } = await supabaseAdmin.storage.from(kova).remove([path])
      if (error) { res.status(500).json({ error: 'Dosya silinemedi' }); return }
      res.status(200).json({ ok: true })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('dosya:', req.method, e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}
