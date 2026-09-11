import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'
import { verifyPassword, hashPassword, sifreKurallari } from '../lib/password.js'
import { girisKilitli, hataliDeneme, basariliGiris, istekIp } from '../lib/girisKoruma.js'
import { denetimYaz } from '../lib/denetim.js'
import { VARSAYILAN_ORG } from '../lib/org.js'
import { adUyumlu } from '../lib/adSutunu.js'

// PUT /api/profil - KULLANICININ KENDI hesabi: gorunen ad, telefon, e-posta, sifre.
//
// NEDEN AYRI BIR UC: /api/users/:id requireAdmin ile basliyor, yani bugune kadar
// sifreyi yalnizca yonetici degistirebiliyordu - kullaniciya atanan sifre elden
// verilip oyle kaliyordu. Burasi requireAuth ile calisir ve HEDEF HER ZAMAN
// tokendeki kullanicidir (claims.sub): istekten gelen bir id kabul edilmez, aksi
// halde herhangi bir kullanici bu uctan baskasinin sifresini degistirebilirdi.
//
// DEGISTIRILEBILEN ALANLAR BILEREK DARDIR. Rol, modul izinleri, bina erisimi ve
// unvan buradan gecmez - gecseydi her kullanici kendini yonetici yapabilirdi.
// Giris adi (username) da degismez: kimlik anahtaridir, gecmis kayitlarin icine
// metin olarak yazilmistir (bkz. migration_gorunen_ad.sql). Ad degisikligi
// 'ad' sutununda durur ve yalnizca gosterimi etkiler.
export default async function handler(req, res) {
  if (req.method !== 'PUT') { res.status(405).json({ error: 'Method not allowed' }); return }

  const claims = requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  const { ad, tel, email, mevcutSifre, yeniSifre } = req.body || {}

  let user
  try {
    const { data, error } = await supabaseAdmin
      .from('users').select('*').eq('id', claims.sub).maybeSingle()
    if (error) throw error
    user = data
  } catch (e) {
    console.error('profil: kullanici sorgusu basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' }); return
  }
  if (!user) { res.status(404).json({ error: 'Kullanici bulunamadi' }); return }

  const org = user.org_id || VARSAYILAN_ORG
  const update = {}
  const degisenler = []

  if (ad !== undefined) {
    const yeniAd = String(ad).trim()
    if (yeniAd.length > 60) { res.status(400).json({ error: 'Ad en fazla 60 karakter olabilir' }); return }
    if (yeniAd !== (user.ad || '')) { update.ad = yeniAd; degisenler.push('ad') }
  }
  if (tel !== undefined) {
    const yeniTel = String(tel).trim()
    if (yeniTel.length > 40) { res.status(400).json({ error: 'Telefon cok uzun' }); return }
    if (yeniTel !== (user.tel || '')) { update.tel = yeniTel; degisenler.push('telefon') }
  }
  if (email !== undefined) {
    const yeniMail = String(email).trim()
    if (yeniMail.length > 120) { res.status(400).json({ error: 'E-posta cok uzun' }); return }
    if (yeniMail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(yeniMail)) { res.status(400).json({ error: 'E-posta adresi gecersiz' }); return }
    if (yeniMail !== (user.email || '')) { update.email = yeniMail; degisenler.push('e-posta') }
  }

  if (yeniSifre) {
    /* MEVCUT SIFRE SORULUR. Gecerli bir oturum tokeni tek basina yetmez: acik
       birakilmis bir ekrani bulan biri sifreyi degistirip hesabi tamamen ele
       gecirebilir, asil sahibi de disarida kalirdi. Mevcut sifre, tokenin
       veremeyecegi tek kaniti ister - "bu gercekten hesabin sahibi". */
    if (!mevcutSifre) { res.status(400).json({ error: 'Mevcut sifrenizi girin' }); return }

    /* DENEME SINIRI GIRISLE AYNI SAYACI KULLANIR (lib/girisKoruma.js). Bu kutu
       da bir sifre tahmin kapisidir; sinirsiz birakilsaydi calinmis bir oturumla
       mevcut sifre rahatca denenebilirdi. Kilit kontrolu bcrypt hesabindan ONCE
       yapilir - kilitliyken sunucu mesgul edilemesin. */
    const ip = istekIp(req)
    const kilit = await girisKilitli(user.username, ip)
    if (kilit.kilitli) {
      const kalan = kilit.kalanSn >= 60 ? Math.ceil(kilit.kalanSn / 60) + ' dakika' : kilit.kalanSn + ' saniye'
      res.status(429).json({ error: 'Cok fazla hatali deneme. ' + kalan + ' sonra tekrar deneyin.' }); return
    }

    const dogru = await verifyPassword(mevcutSifre, user.password)
    if (!dogru) {
      const d = await hataliDeneme(user.username, ip)
      await denetimYaz(org, {
        user: user.username, role: user.role, action: 'girisHata', ip,
        detail: 'Profil: mevcut sifre hatali',
      })
      if (d.kilitSn) {
        const kalan = d.kilitSn >= 60 ? Math.ceil(d.kilitSn / 60) + ' dakika' : d.kilitSn + ' saniye'
        res.status(429).json({ error: 'Cok fazla hatali deneme. ' + kalan + ' sonra tekrar deneyin.' })
      } else {
        res.status(401).json({ error: 'Mevcut sifre hatali' })
      }
      return
    }
    await basariliGiris(user.username, ip)

    // Yeni sifre asgari kuraldan gecer - yonetici ekraniyla ayni esik
    // (api/users/[id].js). Kullanici adi da verilir ki "sifre = kullanici adi"
    // durumu yakalansin.
    const kuralHatasi = sifreKurallari(yeniSifre, user.username)
    if (kuralHatasi) { res.status(400).json({ error: kuralHatasi }); return }
    if (await verifyPassword(yeniSifre, user.password)) {
      res.status(400).json({ error: 'Yeni sifre eskisiyle ayni olamaz' }); return
    }
    update.password = await hashPassword(yeniSifre)
    degisenler.push('sifre')
  }

  if (!degisenler.length) { const s = { ...user }; delete s.password; res.status(200).json(s); return }

  try {
    /* adUyumlu: users.ad sutunu henuz eklenmemisse SIFRE ve iletisim bilgisi yine
       kaydedilir, yalnizca ad atlanir (bkz. lib/adSutunu.js). Sifre degistirmek
       isteyen bir kullaniciyi eksik bir migration yuzunden geri cevirmek olmaz. */
    const { data, error } = await adUyumlu(adDahil => {
      const govde = { ...update }
      if (!adDahil) delete govde.ad
      return supabaseAdmin.from('users').update(govde).eq('id', user.id).select().single()
    })
    if (error) throw error
    const safe = { ...data }; delete safe.password
    /* DENETIM KAYDI SUNUCUDA YAZILIR. Sifre degisikligi hesap devrinin en kritik
       anidir; tarayiciya birakilsaydi konsolu acan biri iz birakmadan degistirebilirdi
       (bkz. lib/denetim.js). Yeni sifre ELBETTE yazilmaz - yalnizca "degisti" bilgisi. */
    await denetimYaz(org, {
      user: user.username, role: user.role, action: 'profil', ip: istekIp(req),
      detail: 'Kendi profilini guncelledi: ' + degisenler.join(', '),
    })
    res.status(200).json(safe)
  } catch (e) {
    console.error('profil PUT basarisiz', e)
    res.status(500).json({ error: e.message || 'Sunucu hatasi' })
  }
}
