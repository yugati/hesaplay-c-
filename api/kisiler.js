import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'
import { aktifOrg } from '../lib/org.js'
import { adUyumlu } from '../lib/adSutunu.js'

// GET /api/kisiler - aktif organizasyondaki kullanicilarin GOSTERIM dizini:
// [{ username, ad, meslek }]
//
// NEDEN AYRI BIR UC: /api/users yalnizca YONETICIYE acik (requireAdmin) ve butun
// kaydi doner - rol, izinler, telefon, e-posta. Oysa "olusturan kisi" adi her
// ekranda gorunur (rapor girisleri, ihtiyac listesi, fatura, tutanak): gorunen
// adi cozebilmek icin saha personelinin de bu eslemeye ulasmasi gerekir.
// Burasi o yuzden HERKESE acik ama YALNIZCA UC ALANI doner - dizin, kullanici
// yonetimi degil. Ayni sebeple meslek de burada: bugune kadar unvan yalnizca
// yonetici ekraninda SB_USERS doldugunda cozulebiliyordu (index.html kisiMeslek),
// yani ciktiyi bir saha personeli aldiginda unvan bos kaliyordu.
//
// KAPSAM her zaman tokendeki aktif organizasyon - istekten gelen bir alan degil.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const claims = requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  try {
    const org = await aktifOrg(claims)
    // adUyumlu: users.ad sutunu henuz eklenmemisse dizin yalnizca unvani tasir,
    // ekranlarda giris adi gorunmeye devam eder (bkz. lib/adSutunu.js)
    const { data, error } = await adUyumlu(adDahil =>
      supabaseAdmin.from('users').select(adDahil ? 'username, ad, meslek' : 'username, meslek').eq('org_id', org))
    if (error) throw error
    res.status(200).json((data || []).map(u => ({
      username: u.username, ad: u.ad || '', meslek: u.meslek || '',
    })))
  } catch (e) {
    console.error('kisiler GET basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}
