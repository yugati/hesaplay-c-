import crypto from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// DAVET TOKENLARI — ortak yardimcilar (api/invites.js ve api/davet.js
// tarafindan kullanilir).
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

/* DAVET KODU: elle yazilabilen kisa kod (orn. K7M4-9XQ2). Eski uzun tokenla AYNI
   sutunda (token_hash) ve ayni yolla saklanir - yalnizca bicimi farklidir.
   Karistirilan karakterler (0/O, 1/I/L) alfabede yok: kod telefonda okunup
   elle yazilabiliyor. 31^8 (~40 bit) tek basina uzun token kadar guclu degil;
   tahmini engelleyen sey lib/girisKoruma.js kilididir (bkz. api/davet.js). */
const KOD_ALFABE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const KOD_UZUNLUK = 8

export function uretKod() {
  let kod = ''
  for (let i = 0; i < KOD_UZUNLUK; i++) kod += KOD_ALFABE[crypto.randomInt(KOD_ALFABE.length)]
  return kod.slice(0, 4) + '-' + kod.slice(4)
}

/* Kullanicinin yazdigi/linkten gelen degeri hash'lenecek bicime getirir. Kod
   ise tire/bosluk atilir ve buyuk harfe cevrilir ("k7m4 9xq2" da gecer); eski
   uzun tokenlar (32 karakter, buyuk-kucuk harf duyarli) oldugu gibi kalir. */
export function davetAnahtar(girdi) {
  const ham = String(girdi || '').trim()
  const sade = ham.replace(/[\s-]/g, '')
  return sade.length === KOD_UZUNLUK && /^[A-Za-z0-9]+$/.test(sade) ? sade.toUpperCase() : ham
}

// APP_BASE_URL yoksa (yerel gelistirme) istekten gelen origin'e duser.
export function davetLinki(token, origin) {
  const taban = process.env.APP_BASE_URL || origin || ''
  return taban.replace(/\/+$/, '') + '/?davet=' + encodeURIComponent(token)
}
