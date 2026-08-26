import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'
import { aktifOrg, orgIdGecerli, VARSAYILAN_ORG } from '../lib/org.js'

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
  belgeler: { onek: /^(siparis|hareket|tutanak|gorev)\// },
  'bina-modelleri': { onek: /^model\// },
}
/* kind -> kova + izin verilen uzanti.
   UZANTI LISTESI KOVA BASINA DEGIL TUR BASINA tanimlidir: gorev ekran goruntuleri de
   'belgeler' kovasinda durur ama oraya PDF degil yalnizca gorsel girebilir; ayni
   sekilde fatura yollarina da gorsel giremez. Kova basina tek liste olsaydi iki tur
   birbirinin iznini sessizce genisletirdi. */
const TURLER = {
  siparis: { kova: 'belgeler', uzantilar: ['pdf'] },
  hareket: { kova: 'belgeler', uzantilar: ['pdf'] },
  tutanak: { kova: 'belgeler', uzantilar: ['pdf'] },
  gorev: { kova: 'belgeler', uzantilar: ['jpg', 'jpeg', 'png', 'webp'] },
  model: { kova: 'bina-modelleri', uzantilar: ['glb', 'gltf'] },
}

function kovaSec(ad) {
  const k = ad || 'belgeler'
  return KOVALAR[k] ? k : null
}

/* ─── ORGANIZASYON VE DOSYA YOLU ───────────────────────────────────────────────
   Yeni yuklemeler org onekiyle yazilir:  bykara/siparis/<id>/<rastgele>.pdf
   ESKI dosyalar oneksiz duruyor:                siparis/<id>/<rastgele>.pdf

   Eski dosyalarin hicbiri TASINMADI - tasima, kayitlardaki pdf.path alanlarini
   toplu guncellemeyi gerektirirdi ve yarida kalirsa acilmayan fatura baglantilari
   birakirdi. Gerek de yok: onek siz her yol, tek kiraci donemine ait, yani
   tanimi geregi BYKARA'nindir. Kural bu kadar basit:
     - onekli yol  -> onek, istegi yapanin aktif organizasyonuna esit olmali
     - oneksiz yol -> yalnizca BYKARA acabilir
   Boylece ne dosya tasindi, ne de bir kiraci digerinin faturasina ulasabiliyor.

   Doner: yolun ait oldugu organizasyon, ya da gecersizse null. */
function yolunOrgu(kova, p) {
  if (typeof p !== 'string' || !p || p.length > 300) return null
  if (p.includes('..') || p.startsWith('/') || p.includes('\\')) return null
  if (!/^[A-Za-z0-9/_.-]+$/.test(p)) return null

  const onek = KOVALAR[kova].onek
  if (onek.test(p)) return VARSAYILAN_ORG   // oneksiz = tek kiraci donemi

  const i = p.indexOf('/')
  if (i <= 0) return null
  const org = p.slice(0, i)
  // Org kimlikleri 'siparis'/'model' gibi tur adlariyla cakisamaz (lib/org.js
  // YASAKLI_ORG_ID) - bu yuzden iki yol bicimi birbirine karisamaz.
  if (!orgIdGecerli(org)) return null
  if (!onek.test(p.slice(i + 1))) return null
  return org
}
function uzanti(tur, ad) {
  const e = String(ad || '').split('.').pop().toLowerCase()
  return tur.uzantilar.includes(e) ? e : null
}
function rastgele() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export default async function handler(req, res) {
  const claims = requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  const org = await aktifOrg(claims)

  try {
    // ── indirme: imzali okuma adresi ──────────────────────────────────────────
    if (req.method === 'GET') {
      const kova = kovaSec(req.query.kova)
      if (!kova) { res.status(400).json({ error: 'Gecersiz kova' }); return }
      const path = req.query.path
      // Baska organizasyonun dosyasi icin de "bulunamadi" denir: farkli bir mesaj
      // o yolun gercekten var oldugunu ele verirdi.
      if (yolunOrgu(kova, path) !== org) { res.status(404).json({ error: 'Dosya bulunamadi' }); return }
      const { data, error } = await supabaseAdmin.storage.from(kova).createSignedUrl(path, INDIRME_OMRU)
      if (error || !data) { res.status(404).json({ error: 'Dosya bulunamadi' }); return }
      res.status(200).json({ url: data.signedUrl, expiresIn: INDIRME_OMRU })
      return
    }

    // ── yukleme: imzali yazma adresi ──────────────────────────────────────────
    // Govde: { kind:'siparis'|'hareket'|'tutanak'|'model', id:'<kayit id>', name:'dosya.pdf' }
    if (req.method === 'POST') {
      const { kind, id, name } = req.body || {}
      const tur = TURLER[kind]
      if (!tur) { res.status(400).json({ error: 'Gecersiz tur' }); return }
      const kova = tur.kova
      if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(String(id))) { res.status(400).json({ error: 'Gecersiz kayit id' }); return }
      const ext = uzanti(tur, name)
      if (!ext) { res.status(400).json({ error: 'Bu turde dosya yuklenemez' }); return }

      // Yeni yollar HER ZAMAN org onekli - BYKARA icin de. Boylece "onek yoksa
      // BYKARA'dir" kurali yalnizca gecmis dosyalar icin gecerli kalir ve
      // zamanla kendiliginden tukenir.
      const path = `${org}/${kind === 'model' ? 'model' : kind}/${id}/${rastgele()}.${ext}`
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
      if (yolunOrgu(kova, path) !== org) { res.status(404).json({ error: 'Dosya bulunamadi' }); return }
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
