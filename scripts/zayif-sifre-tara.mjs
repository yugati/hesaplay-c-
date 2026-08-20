/* ZAYIF SIFRE TARAMASI - kullanim:  node scripts/zayif-sifre-tara.mjs

   Asama 3'ten sonra veriye tek yol giris ekrani; Asama 4'te kaba kuvvet engeli
   eklendi. Ama engel ancak sifre TAHMIN EDILEBILIR DEGILSE anlam tasir: 5 denemede
   bulunabilen bir sifreyi hicbir kilit kurtarmaz.
   Bu betik, kayitli sifre hash'lerini yaygin/tahmin edilebilir adaylarla dener ve
   HANGI HESAPLARIN degistirilmesi gerektigini soyler.

   - Sifreler cozulmez; yalnizca aday listesi denenir (bcrypt.compare).
   - Bulunan sifre EKRANA YAZILMAZ, sadece "tahmin edilebilir" denir.
   - Salt-okuma: hicbir kaydi degistirmez.
   - .env icindeki APP_SUPABASE_SECRET_KEY ile calisir, yerelde calistirilmalidir. */
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.APP_SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const YAYGIN = ['123456','1234567','12345678','123456789','1234567890','12345','1234','123','12','1',
  'password','Password','password1','passw0rd','parola','sifre','şifre','Sifre123','qwerty','qwertyui',
  'asdf','asdfasdf','abc123','abcdefgh','111111','11111111','000000','00000000','admin','admin123',
  'Admin123','root','test','test123','deneme','deneme123','user','user123','letmein','welcome','iloveyou',
  'yugati','yugati123','saha','saha123','elektrik','elektrik123','malzeme','proje','proje123','2026','2025'];

const { data: users, error } = await sb.from('users').select('id, username, password, role');
if (error) { console.log('users okunamadi:', error.message); process.exit(1); }

console.log('== ZAYIF SIFRE TARAMASI ==');
console.log(users.length + ' kullanici, her biri icin ~' + (YAYGIN.length + 6) + ' aday deneniyor...\n');

let zayif = 0, hashsiz = 0;
for (const u of users) {
  const adaylar = [...YAYGIN,
    u.username, String(u.username).toLowerCase(), String(u.username).toUpperCase(),
    u.username + '123', u.username + '1', String(u.username).toLowerCase() + '123'];

  // duz metin (hic hash'lenmemis) kayit en agir durum
  const duz = !/^\$2[aby]\$/.test(String(u.password || ''));
  if (duz) {
    hashsiz++;
    console.log('  !! ' + String(u.username).padEnd(14) + String(u.role).padEnd(16) + 'SIFRE DUZ METIN SAKLANIYOR (hic giris yapmamis)');
    continue;
  }

  let bulundu = false;
  for (const a of adaylar) {
    if (await bcrypt.compare(a, u.password)) { bulundu = true; break; }
  }
  if (bulundu) zayif++;
  console.log('  ' + (bulundu ? '!! ' : 'OK ') + String(u.username).padEnd(14) + String(u.role).padEnd(16) +
    (bulundu ? 'TAHMIN EDILEBILIR - degistirilmeli' : 'aday listesinde bulunamadi'));
}

console.log('\n' + (zayif || hashsiz
  ? (zayif + hashsiz) + ' HESAP RISKLI - sifreleri degistirin (Kullanicilar ekrani)'
  : 'Denenen adaylarda eslesme yok'));
console.log('Not: "bulunamadi" = bu liste ile kirilmadi demektir, "guclu" demek degildir.');
