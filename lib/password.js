import bcrypt from 'bcryptjs'

const BCRYPT_PREFIX = /^\$2[aby]\$/

export function isHashed(pw) {
  return typeof pw === 'string' && BCRYPT_PREFIX.test(pw)
}

export function hashPassword(pw) {
  return bcrypt.hash(pw, 10)
}

// Eski kayitlar duz metin sifre iceriyor olabilir (bu sistem hash'lenmeden
// once kuruldu). Hash'liyse bcrypt karsilastirmasi, degilse - geriye donuk
// uyumluluk icin - duz metin karsilastirmasi yapilir. login.js basarili bir
// duz metin girisinden sonra kaydi sessizce hash'e yukseltir.
export async function verifyPassword(plain, stored) {
  if (isHashed(stored)) return bcrypt.compare(plain, stored)
  return plain === stored
}

/* SIFRE KURALI (Asama 4). Asama 3'ten sonra veriye tek yol giris ekrani; kaba
   kuvvet engeli (lib/girisKoruma.js) ancak sifre tahmin edilebilir DEGILSE anlam
   tasir. Bu yuzden yeni/degistirilen sifreler asgari bir esikten geciyor.
   MEVCUT sifreler zorlanmaz - girisde kural uygulanmaz, yoksa kullanicilar
   bir anda disarida kalirdi. Zayif olanlar tespit edilip degistirilmeli
   (bkz. scripts/zayif-sifre-tara.mjs). */
const ZAYIF = new Set([
  '12345678','123456789','1234567890','password','parola','sifre','şifre','qwerty','qwertyui',
  'asdfasdf','11111111','00000000','abcdefgh','admin123','password1','deneme123','iloveyou',
  'letmein','welcome','monkey','dragon','baseball','football','superman','trustno1','sunshine',
])

export function sifreKurallari(pw, username) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Sifre en az 8 karakter olmali'
  if (pw.length > 200) return 'Sifre cok uzun'
  if (/^(.)\1+$/.test(pw)) return 'Sifre tek bir karakterin tekrari olamaz'
  if (/^(0123456789|1234567890|123456789|12345678|987654321|abcdefgh)/.test(pw)) return 'Sifre ardisik karakterlerden olusamaz'
  if (ZAYIF.has(pw.toLowerCase())) return 'Bu sifre cok yaygin - baska bir sifre secin'
  if (username && pw.toLowerCase() === String(username).toLowerCase()) return 'Sifre kullanici adiyla ayni olamaz'
  return null   // kurallara uygun
}
