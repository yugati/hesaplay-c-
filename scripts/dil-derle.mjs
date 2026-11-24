// ARAYUZ CEVIRISI - sozluk derleyici. Kullanim: node scripts/dil-derle.mjs . anahtarlar.json ceviri.txt ...
// ceviri.txt satirlari: 'N|ceviri' (anahtarlar.json'daki N. anahtar) ya da '=anahtar|ceviri'.
// public/dil-ru.js ile birlestirir; '#' sayisi tutmayan ceviriyi reddeder.
// node derle.mjs <repo> <anahtarlar.json> <ru1.txt> [ru2.txt ...]
// Mevcut public/dil-ru.js ile birlestirir (yeni ceviriler ustune yazar).
import fs from 'node:fs';
const [repo, anahtarDosya, ...ceviriler] = process.argv.slice(2);
const keys = JSON.parse(fs.readFileSync(anahtarDosya, 'utf8'));
const hedef = repo + '/public/dil-ru.js';
let soz = {};
if (fs.existsSync(hedef)) { const t = fs.readFileSync(hedef, 'utf8'); const m = t.indexOf('{', t.indexOf('window.DIL_RU=')); soz = JSON.parse(t.slice(m, t.lastIndexOf('}') + 1)); }
const hata = [];
const yerTut = s => (s.replace(/\{[^{}]*\}/g, '').match(/#/g) || []).length;
const ekle = (k, t, kaynak) => {
  k = k.trim(); t = t.trim(); if (!k || !t) return;
  // anahtar hicbir zaman noktalamayla bitmez/baslamaz; ekrandaki kenar runtime'da geri eklenir,
  // ceviride de olursa iki kez yazilirdi ("Заказы (91))")
  t = t.replace(/^(?:[\s·:,;!?)\]]+|[—–]\s+)/, '').replace(/[\s·:,;!?)\]…]+$/, '');
  if (yerTut(k) !== yerTut(t)) { hata.push(`${kaynak}: '#' sayisi tutmuyor: ${k}  =>  ${t}`); return; }
  soz[k] = t;
  // simge artiklari: "${ico()} Excel" -> anahtar "# Excel", ekranda "Excel"
  const v = [];
  if (k.startsWith('# ')) v.push([k.slice(2), t.startsWith('# ') ? t.slice(2) : t]);
  if (k.endsWith(' #')) v.push([k.slice(0, -2), t.endsWith(' #') ? t.slice(0, -2) : t]);
  else if (/[^#\s]#+$/.test(k)) { const n = k.match(/#+$/)[0].length; v.push([k.slice(0, -n).trim(), t.replace(new RegExp('#{' + n + '}$'), '').trim()]); }
  v.forEach(([k2, t2]) => { if (k2 && t2 && !(k2 in soz) && yerTut(k2) === yerTut(t2)) soz[k2] = t2; });
};
for (const f of ceviriler) {
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const p = line.indexOf('|'); if (p < 0) return;
    const sol = line.slice(0, p), sag = line.slice(p + 1);
    if (sol.startsWith('=')) ekle(sol.slice(1), sag, f + ':' + (i + 1));
    else { const n = +sol; if (!(n in keys)) { hata.push('yok indeks ' + sol); return; } ekle(keys[n], sag, f + ':' + (i + 1) + ' [' + n + ']'); }
  });
}
const sirali = Object.keys(soz).sort((a, b) => a.localeCompare(b, 'tr'));
const govde = sirali.map(k => '  ' + JSON.stringify(k) + ':' + JSON.stringify(soz[k])).join(',\n');
fs.writeFileSync(hedef, `/* Arayuz sozlugu TR -> RU (bkz. dil.js). Anahtar: ekrandaki metnin cekirdegi - sayilar '#',
   bas/son noktalama ayrilmis. Ceviride '#' sayiyla doldurulur; {bir|iki-dort|bes+} Rusca cogul. */
window.DIL_RU={
${govde}
};
`);
console.log('girdi', sirali.length);
hata.forEach(h => console.log('HATA', h));
