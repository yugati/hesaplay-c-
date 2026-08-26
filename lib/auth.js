import jwt from 'jsonwebtoken'
import { VARSAYILAN_ORG } from './org.js'

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
export function signSession(user, ttlMs, aktifOrg) {
  return jwt.sign(
    {
      sub: user.id, username: user.username, role: user.role,
      org: aktifOrg || user.org_id || VARSAYILAN_ORG,
      sup: !!user.is_super,
      sections: user.sections || [], perms: user.permissions || {},
    },
    SESSION_SECRET,
    { expiresIn: Math.floor((ttlMs || SESSION_TTL_DEFAULT) / 1000) }
  )
}

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

// Gecerli bir oturum tokeni varsa iceriğini (sub/username/role) dondurur, yoksa null.
export function requireAuth(req) {
  const token = bearerToken(req)
  if (!token) return null
  try {
    return jwt.verify(token, SESSION_SECRET)
  } catch (e) {
    return null
  }
}

// requireAuth + rol admin olmali.
export function requireAdmin(req) {
  const claims = requireAuth(req)
  if (!claims || claims.role !== 'admin') return null
  return claims
}
