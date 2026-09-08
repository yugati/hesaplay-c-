import crypto from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// DAVET TOKENLARI — ortak yardimcilar (api/invites.js, api/invites/[id].js,
// api/davet/[token].js, api/davet/[token]/kabul.js tarafindan kullanilir).
//
// Token DUZ METIN OLARAK DB'DE TUTULMAZ: sifre hash'leme ile ayni prensip.
// Token'in kendisi zaten yeterince rastgele (192 bit) oldugu icin bcrypt gibi
// yavas bir hash gerekmiyor - sha256 yeterli ve hizli (davet onizleme/kabul
// her istekte hash'i yeniden hesaplayip DB'de arayacak).
// ─────────────────────────────────────────────────────────────────────────────

export const DAVET_GECERLILIK_MS = 7 * 24 * 60 * 60 * 1000 // 7 gun

export function uretToken() {
  return crypto.randomBytes(24).toString('base64url')
}

export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

// APP_BASE_URL yoksa (yerel gelistirme) istekten gelen origin'e duser.
export function davetLinki(token, origin) {
  const taban = process.env.APP_BASE_URL || origin || ''
  return taban.replace(/\/+$/, '') + '/?davet=' + encodeURIComponent(token)
}
