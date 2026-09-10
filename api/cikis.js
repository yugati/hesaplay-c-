import { requireAuth } from '../lib/auth.js'
import { denetimYaz } from '../lib/denetim.js'
import { aktifOrg } from '../lib/org.js'

// POST /api/cikis - oturum kapatildigini denetim kaydina yazar.
//
// Oturum tokeni JWT oldugu icin sunucuda "iptal" edilecek bir kayit yok; cikis
// tarayicida tokeni atmaktan ibaret (index.html logout). Bu uc o yuzden bir
// GUVENLIK islemi degil, yalnizca DENETIM kaydidir: "kim ne zaman girdi"
// sorusunun yaninda "ne zaman cikti" da yazili olsun diye.
//
// Cevabi beklemek gerekmez ve HATA VERSE BILE cikis yapilir (bkz. sbCikis) -
// log yazilamadi diye kullanici oturumda tutulamaz.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const claims = requireAuth(req)
  // Suresi dolmus tokenle gelen cikis sessizce kabul edilir: kullanici zaten
  // disarida, 401 donmek istemcide gereksiz "oturum dustu" uyarisi tetiklerdi.
  if (!claims) { res.status(200).json({ ok: true }); return }

  await denetimYaz(await aktifOrg(claims), {
    user: claims.username, role: claims.role, action: 'logout',
    detail: (req.body && req.body.sebep === 'sure') ? 'Oturum suresi doldu' : 'Cikis yapildi',
  })
  res.status(200).json({ ok: true })
}
