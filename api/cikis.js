import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth, signSession, yenilenenTtl } from '../lib/auth.js'
import { denetimYaz } from '../lib/denetim.js'
import { aktifOrg } from '../lib/org.js'
import { surumBelirle } from '../lib/oturum.js'
import { istekIp } from '../lib/girisKoruma.js'

// POST /api/cikis - iki is yapar:
//
// 1) { sebep } : oturum kapatildigini denetim kaydina yazar.
//    Oturum tokeni JWT oldugu icin bu cikis, tarayicida tokeni atmaktan ibaret
//    (index.html logout); bu uc o yuzden bir GUVENLIK islemi degil, yalnizca
//    DENETIM kaydidir: "kim ne zaman girdi" sorusunun yaninda "ne zaman cikti"
//    da yazili olsun diye. Cevabi beklemek gerekmez ve HATA VERSE BILE cikis
//    yapilir (bkz. sbCikis) - log yazilamadi diye kullanici oturumda tutulamaz.
//
// 2) { digerleri: true } : kullanicinin KENDI hesabinin acik oldugu diger tum
//    yerlerden (cihaz/tarayici) cikis yapilir, BU oturum acik kalir. Bu bir
//    GUVENLIK islemidir - bkz. digerOturumlariKapat.
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const claims = await requireAuth(req)
  if (req.body && req.body.digerleri === true) { await digerOturumlariKapat(req, res, claims); return }

  // Suresi dolmus tokenle gelen cikis sessizce kabul edilir: kullanici zaten
  // disarida, 401 donmek istemcide gereksiz "oturum dustu" uyarisi tetiklerdi.
  if (!claims) { res.status(200).json({ ok: true }); return }

  await denetimYaz(await aktifOrg(claims), {
    user: claims.username, role: claims.role, action: 'logout',
    detail: (req.body && req.body.sebep === 'sure') ? 'Oturum suresi doldu' : 'Cikis yapildi',
  })
  res.status(200).json({ ok: true })
}

/* HEDEF HER ZAMAN TOKENDEKI KULLANICIDIR (claims.sub): istekten gelen bir id
   kabul edilmez - aksi halde herhangi biri baskasini tum oturumlarindan atabilirdi.
   Sayac artar; eski sayacli bir token ne kadar gecerli imzali olursa olsun bir
   sonraki istekte reddedilir (bkz. lib/oturum.js). Cagiran cihaz ise YENI sayacli
   taze bir token alir ve oturumda kalir. Sifre sorulmaz: bu islem hesabi
   devretmez, yalnizca oturumlari kapatir - acik bir ekrani bulan biri en fazla
   diger cihazlari atabilir, kendi tokeni zaten gecerli. */
async function digerOturumlariKapat(req, res, claims) {
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users').select('*').eq('id', claims.sub).maybeSingle()
    if (error) throw error
    if (!user) { res.status(404).json({ error: 'Kullanici bulunamadi' }); return }
    // migration_oturum_surumu.sql calistirilmamissa satirda alan da yoktur
    if (!('oturum_surumu' in user)) {
      res.status(503).json({ error: 'Bu ozellik icin veritabani guncellemesi gerekiyor (migration_oturum_surumu.sql)', code: 'migration' })
      return
    }
    const yeni = (Number(user.oturum_surumu) || 0) + 1
    const { error: uErr } = await supabaseAdmin.from('users').update({ oturum_surumu: yeni }).eq('id', user.id)
    if (uErr) throw uErr
    surumBelirle(user.id, yeni)

    const ttl = yenilenenTtl(claims)
    const token = signSession({ ...user, oturum_surumu: yeni }, ttl, claims.org, claims.tas)

    await denetimYaz(await aktifOrg(claims), {
      user: user.username, role: user.role, action: 'logout', ip: istekIp(req),
      detail: 'Diger tum oturumlar kapatildi',
    })
    res.status(200).json({ ok: true, token, ttl })
  } catch (e) {
    console.error('cikis: diger oturumlar kapatilamadi', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}
