import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth, signSession, SESSION_TTL_DEFAULT, SESSION_TTL_REMEMBER } from '../lib/auth.js'
import { VARSAYILAN_ORG, orgKullanilabilir } from '../lib/org.js'
import { tasariCoz, tasariKonumOku } from '../lib/tasari.js'
import { birimCoz } from '../lib/birim.js'

// Aktif oturumun kullanicisini tazeler (ör. baska bir admin yetkisini
// degistirdiyse sayfa yenilemede yansisin diye arka planda cagrilir).
//
// TOKEN YENILEME: kullaniciyla birlikte TAZE bir oturum tokeni de doner.
// Asama 1'den beri tum veri islemleri bu tokene bagli - suresi dolunca uygulama
// calisir gorunup her istekte 401 alirdi. Istemci belirli araliklarla burayi
// cagirip tokeni tazeliyor (bkz. index.html oturumTazele).
// Kalan sure "Beni Hatirla" ile acilmis uzun oturumu kisaltmasin diye, tokenin
// kendi omrunden turetilir: 1 saatten uzun kalmissa uzun TTL ile imzalanir.
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const claims = await requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users').select('*').eq('id', claims.sub).maybeSingle()
    if (error) throw error
    if (!user) { res.status(404).json({ error: 'Kullanici bulunamadi' }); return }
    const safeUser = { ...user }
    delete safeUser.password
    // claims.exp/iat saniye cinsindendir; kalan omur 1 saatten fazlaysa oturum
    // "Beni Hatirla" ile acilmistir, yeni token da uzun omurlu imzalanir
    const kalanMs = claims.exp ? (claims.exp * 1000 - Date.now()) : 0
    const ttl = kalanMs > SESSION_TTL_DEFAULT ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT

    /* AKTIF ORGANIZASYON TAZELEMEDE KORUNUR. Super yonetici baska bir
       organizasyona gectiyse (api/org.js) aktif org tokende yasar; burada
       korunmazsa 20 dakikada bir sessizce kendi organizasyonuna geri atilirdi -
       ekranda veri degisir, sebebi gorunmezdi.
       Kendi organizasyonu disindaki bir org icin varligi da dogrulanir: gecilen
       organizasyon sonradan silinmis/askiya alinmissa kullanici bos bir uygulamada
       kalmak yerine kendi organizasyonuna doner. */
    const evOrg = user.org_id || VARSAYILAN_ORG
    let aktif = evOrg
    if (claims.sup && claims.org && claims.org !== evOrg && user.is_super) {
      if (await orgKullanilabilir(claims.org)) aktif = claims.org
    }

    /* AKTIF TASARI DA TAZELEMEDE KORUNUR - org ile birebir ayni gerekce.
       Korunmazsa kullanici 20 dakikada bir sessizce kendi varsayilan projesine
       geri atilirdi: ekrandaki siparisler degisir, sebebi gorunmez ve o sirada
       acik olan bir form YANLIS PROJEYE kaydedilirdi.

       Cozum aktif ORGANIZASYONA gore yapilir (tasariCoz): tasari kimlikleri
       organizasyon icinde benzersiz oldugu icin, super yonetici baska bir
       organizasyondayken elindeki tasari orada gecerli olmayabilir. O durumda
       hedef organizasyonun ilk tasarisina duser - kendi organizasyonunun
       projesiyle imzalayip bos bir uygulama gostermek yerine.

       Tasari sonradan silinmis/askiya alinmissa da ayni yol calisir. */
    const aktifTas = await tasariCoz(aktif, claims.tas, user)
    /* AKTIF BIRIM DE KORUNUR - ayni gerekcenin bir kat asagisi. Ek olarak ERISIM
       yeniden dogrulanir: yonetici bu kullanicinin birim listesinden aktif birimi
       cikardiysa, 20 dakika icinde token erisebildigi ilk birimle imzalanir ve
       istemci "Aktif birim degisti" der (index.html oturumTazeleUygula). */
    const aktifBir = await birimCoz(aktif, aktifTas, claims.bir, user)

    // Konum da tazelenir: yonetici baska bir tarayicidan degistirdiyse 20 dk icinde herkese yansir
    const konum = await tasariKonumOku(aktif, aktifTas)
    res.status(200).json({
      user: safeUser, org: aktif, tasari: aktifTas, konum, birim: aktifBir,
      token: signSession(user, ttl, aktif, aktifTas, aktifBir), ttl,
    })
  } catch (e) {
    console.error('me: kullanici sorgusu basarisiz', e)
    res.status(500).json({ error: 'Sunucu hatasi' })
  }
}
