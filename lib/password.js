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
