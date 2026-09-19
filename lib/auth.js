import jwt from 'jsonwebtoken'
import { VARSAYILAN_ORG } from './org.js'
import { VARSAYILAN_TASARI } from './tasari.js'
import { oturumAcikMi } from './oturum.js'

// index.html'deki SESSION_TTL_DEFAULT / SESSION_TTL_REMEMBER ile ayni degerler
// (ms). Burada bagimsiz tutuluyor cunku sunucu fonksiyonlari index.html'i
// import edemez; degistirilirse iki yerde de guncellenmeli.
export const SESSION_TTL_DEFAULT = 3600000 // 1 saat
export const SESSION_TTL_REMEMBER = 2592000000 // 30 gun

const SESSION_SECRET = process.env.SESSION_JWT_SECRET
if (!SESSION_SECRET) {
  throw new Error('Missing SESSION_JWT_SECRET in the server environment.')
}

/* Oturum tokeni. YETKILER de tokene yazilir (sections + permissions): /api/veri her
   istekte yetki kontrol ediyor, bunlar tokende olmasa acilistaki ~60 istegin her biri
   icin ayrica users tablosuna gidilmesi gerekirdi.
   Tazelik: token 20 dakikada bir /api/me'den yenileniyor, yani bir yetki degisikligi
   en gec o kadar sonra etkili olur - tarayicidaki onbellekli CURRENT_USER'da da durum
   zaten boyleydi, davranis degismedi. */
/* ORGANIZASYON DA TOKENE YAZILIR (org + sup):
   'org'  = istegin calisacagi AKTIF organizasyon. Istemci hicbir yerde org
            gondermez - /api/veri, /api/users ve /api/dosya bu iddiaya bakar.
            Org degistirme tokeni yeniden imzalar (api/org.js), yani aktif org
            kullanicinin degistiremeyecegi tek yerde durur.
   'sup'  = organizasyonlar arasi gecis yetkisi (users.is_super). Ayri bir ROL
            degil ayri bir BAYRAK: kodun her yerindeki role==='admin' kontrolu
            (index.html isAdmin, requireAdmin) oldugu gibi calismaya devam etsin.

   aktifOrg parametresi verilmezse kullanicinin kendi organizasyonu kullanilir -
   giris (api/login.js) icin dogru davranis budur. */
/* TASARI DA TOKENE YAZILIR (tas):
   'tas'  = istegin calisacagi AKTIF tasari (proje). Organizasyonun ALTINDAKI
            ikinci katman - is verisi her zaman tek bir tasariya aittir.
            Istemci hicbir yerde tasari gondermez; /api/veri bu iddiaya bakar.
            Tasari degistirme tokeni yeniden imzalar (api/org.js), yani aktif
            tasari da kullanicinin degistiremeyecegi tek yerde durur.

   ORG'DAN FARKI: tasari degistirmek icin 'sup' gibi bir bayrak YOKTUR -
   organizasyondaki herkes tasarilar arasinda gecebilir (alinan karar; bkz.
   lib/tasari.js basligi). Sunucu yine de gecilen tasarinin KENDI
   organizasyonunda oldugunu dogrular.

   aktifTasari parametresi verilmezse kullanicinin kendi varsayilan tasarisi
   kullanilir - giris (api/login.js) icin dogru davranis budur. */
export function signSession(user, ttlMs, aktifOrg, aktifTasari) {
  return jwt.sign(
    {
      sub: user.id, username: user.username, role: user.role,
      org: aktifOrg || user.org_id || VARSAYILAN_ORG,
      tas: aktifTasari || user.tasari_id || VARSAYILAN_TASARI,
      sup: !!user.is_super,
      sections: user.sections || [], perms: user.permissions || {},
      // 'sv' = imzalandigi andaki oturum sayaci; "diger oturumlari kapat" sayaci
      // arttirinca daha kucuk sv'li tokenler reddedilir (bkz. lib/oturum.js)
      sv: Number(user.oturum_surumu) || 0,
    },
    SESSION_SECRET,
    { expiresIn: Math.floor((ttlMs || SESSION_TTL_DEFAULT) / 1000) }
  )
}

/* Ayni oturumun YENI tokeni icin omur: kalan omur 1 saatten uzunsa oturum "Beni
   Hatirla" ile acilmistir, yeni token da uzun omurlu imzalanir (api/me.js ile ayni olcut). */
export function yenilenenTtl(claims) {
  const kalanMs = claims && claims.exp ? (claims.exp * 1000 - Date.now()) : 0
  return kalanMs > SESSION_TTL_DEFAULT ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT
}

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

/* Gecerli bir oturum tokeni varsa iceriğini (sub/username/role) dondurur, yoksa null.
   ASENKRON: imza/sure kontrolunden sonra oturum sayaci da bakilir (lib/oturum.js) -
   "diger oturumlari kapat" ile iptal edilmis bir token imzasi gecerli olsa da
   reddedilir. Cagiranlar `await` KULLANMALIDIR: unutulursa donen Promise "gecerli
   oturum" gibi gorunurdu. */
export async function requireAuth(req) {
  const token = bearerToken(req)
  if (!token) return null
  let claims
  try {
    claims = jwt.verify(token, SESSION_SECRET)
  } catch (e) {
    return null
  }
  return (await oturumAcikMi(claims)) ? claims : null
}

// requireAuth + rol admin olmali.
export async function requireAdmin(req) {
  const claims = await requireAuth(req)
  if (!claims || claims.role !== 'admin') return null
  return claims
}
