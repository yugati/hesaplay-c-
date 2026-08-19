import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'

// ─────────────────────────────────────────────────────────────────────────────
// BELGE (PDF) ERISIMI - 'belgeler' kovasi PRIVATE'dir, tarayici anon anahtarla
// oraya erisemez. Bu fonksiyon oturumu dogrular ve KISA OMURLU imzali adres verir.
//
// Neden Storage: eskiden PDF'ler siparis kaydinin icinde base64 olarak duruyordu ve
// uygulama HER acilista hepsini indiriyordu (33 MB). Dosya Storage'a alininca kayitta
// yalnizca 'path' kalir; dosya sadece kullanici PDF'e tikladiginda iner.
//
// Yukleme de buradan gecer ama dosyanin KENDISI buradan gecmez: sunucu yalnizca
// imzali yukleme adresi uretir, tarayici dosyayi dogrudan Storage'a gonderir.
// Boylece Vercel'in 4.5 MB istek govdesi siniri yola girmez.
// ─────────────────────────────────────────────────────────────────────────────

const KOVA = 'belgeler'
const INDIRME_OMRU = 300 // sn - sekmede acilmasina yeter, link paylasilirsa kisa surede oler

// Yol guvenligi: yalnizca bilinen onekler, ust dizine cikis yok, sade karakterler.
// Bu kontrol olmadan istemci 'path' ile kovadaki baska bir dosyayi isteyebilirdi.
const IZINLI_ONEK = /^(siparis|hareket|tutanak)\//
function yolGecerli(p) {
  if (typeof p !== 'string' || !p || p.length > 300) return false
  if (p.includes('..') || p.startsWith('/') || p.includes('\\')) return false
  if (!IZINLI_ONEK.test(p)) return false
  return /^[A-Za-z0-9/_.-]+$/.test(p)
}

// Dosya adindan guvenli uzanti cikarir (yalnizca pdf desteklenir - tek kullanim yeri fatura).
function uzanti(ad) {
  const e = String(ad || '').split('.').pop().toLowerCase()
  return e === 'pdf' ? 'pdf' : null
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
      const path = req.query.path
      if (!yolGecerli(path)) { res.status(400).json({ error: 'Gecersiz dosya yolu' }); return }
      const { data, error } = await supabaseAdmin.storage.from(KOVA).createSignedUrl(path, INDIRME_OMRU)
      if (error || !data) { res.status(404).json({ error: 'Dosya bulunamadi' }); return }
      res.status(200).json({ url: data.signedUrl, expiresIn: INDIRME_OMRU })
      return
    }

    // ── yukleme: imzali yazma adresi ──────────────────────────────────────────
    // Govde: { kind:'siparis'|'hareket', id:'<kayit id>', name:'fatura.pdf' }
    if (req.method === 'POST') {
      const { kind, id, name } = req.body || {}
      if (!['siparis', 'hareket', 'tutanak'].includes(kind)) { res.status(400).json({ error: 'Gecersiz tur' }); return }
      if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(String(id))) { res.status(400).json({ error: 'Gecersiz kayit id' }); return }
      const ext = uzanti(name)
      if (!ext) { res.status(400).json({ error: 'Yalnizca PDF yuklenebilir' }); return }

      const path = `${kind}/${id}/${rastgele()}.${ext}`
      const { data, error } = await supabaseAdmin.storage.from(KOVA).createSignedUploadUrl(path)
      if (error || !data) { res.status(500).json({ error: 'Yukleme adresi alinamadi' }); return }
      res.status(200).json({ path, signedUrl: data.signedUrl, token: data.token })
      return
    }

    // ── silme: kayittan cikarilan dosyayi kovadan da al ───────────────────────
    if (req.method === 'DELETE') {
      const path = req.query.path
      if (!yolGecerli(path)) { res.status(400).json({ error: 'Gecersiz dosya yolu' }); return }
      const { error } = await supabaseAdmin.storage.from(KOVA).remove([path])
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
