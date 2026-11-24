// ARAYUZ CEVIRISI - metin cikarici. Kullanim: node scripts/dil-cikar.mjs . cikti.json
// index.html'deki arayuz metinlerini (sablon metinleri, title/placeholder/aria-label, toast/confirm
// metinleri) dil.js ile AYNI anahtar bicimine cevirip [{k,satir,fn}] olarak yazar.
// index.html icindeki arayuz metinlerini cikarir -> JSON [{k, satir, fn}]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const repo = process.argv[2];
const require = createRequire(repo + '/package.json');
const { parseAst } = require('rollup/parseAst');
const html = fs.readFileSync(repo + '/index.html', 'utf8');

// satir numarasi icin
const satirBas = [0]; for (let i = 0; i < html.length; i++) if (html[i] === '\n') satirBas.push(i + 1);
const satirOf = off => { let lo = 0, hi = satirBas.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (satirBas[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };

// RUNTIME ILE AYNI anahtar fonksiyonu
const KENAR = /^[\s·:,;.!?()\[\]\-–—•|/…*"'«»>]+|[\s·:,;.!?()\[\]\-–—•|/…*"'«»<]+$/g;
function anahtar(s) { return String(s).replace(/\u0001/g, '#').replace(/\s+/g, ' ').replace(/\d+(?:[.,]\d+)*/g, '#').replace(KENAR, '').trim(); }

const TRHARF = /[çğıöşüÇĞİÖŞÜ]/;
function uiMi(k) {
  if (!k || k.length < 2) return false;
  if (!/[A-Za-zçğıöşüÇĞİÖŞÜ]{2}/.test(k)) return false;
  if (/^#+$/.test(k.replace(/[^#\w]/g, ''))) return false;
  if (/[{};=<>\\]|=>|&&|\|\||^\.|^#[\w-]|https?:|\.(js|png|pdf|xlsx|json|svg|html)\b|^\//.test(k)) return false;
  if (/^[a-z_$][\w$-]*$/.test(k)) return false;                 // tanimlayici / sinif adi
  if (/^[\w-]+(\s+[\w-]+)*$/.test(k) && !/\s/.test(k) && /[_]/.test(k)) return false;
  if (/^[a-z-]+:\s*\S/.test(k) && /;|px|%|var\(/.test(k)) return false; // css
  if (/^(var|rgba?|calc|translate|scale|url)\(/.test(k)) return false;
  if (/^[a-z][\w-]*( [a-z][\w-]*)+$/.test(k) && !TRHARF.test(k) && k.split(' ').every(w => /^[a-z][\w-]*$/.test(w)) && /-/.test(k)) return false; // "btn btn-ghost"
  if (/^(M|L|H|V|C|Z|m|l|h|v|c|z)[\d\s.,#-]/.test(k)) return false; // svg path
  // tek kelime: buyuk harfle baslamali ya da TR harf icermeli
  if (!/\s/.test(k) && !TRHARF.test(k) && !/^[A-ZÇĞİÖŞÜ]/.test(k)) return false;
  return true;
}

const out = [];
const ekle = (s, off, fn) => { const k = anahtar(s); if (uiMi(k)) out.push({ k, satir: satirOf(off), fn }); };

function parcala(flat, off, fn) {
  // HTML parcasi: etiket disi metinler + title/placeholder/aria-label/alt degerleri
  if (!/[<>]/.test(flat)) { ekle(flat, off, fn); return; }
  const re = /<[^>]*>/g; let son = 0, m;
  while ((m = re.exec(flat))) {
    ekle(flat.slice(son, m.index), off, fn);
    const tag = m[0]; let a; const ar = /\b(title|placeholder|aria-label|alt|data-tip)="([^"]*)"/g;
    while ((a = ar.exec(tag))) ekle(a[2], off, fn);
    son = m.index + m[0].length;
  }
  ekle(flat.slice(son), off, fn);
}

const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let sm;
// statik HTML (scriptler disi): govde
const govdeBas = html.indexOf('<body>');
{
  const statik = html.slice(govdeBas).replace(/<script[\s\S]*?<\/script>/g, s => ' '.repeat(s.length)).replace(/<!--[\s\S]*?-->/g, s => ' '.repeat(s.length));
  // yalniz ilk script'e kadar (static markup)
  parcala(statik.slice(0, statik.search(/\S{0}<\/body>/) > 0 ? statik.indexOf('</body>') : statik.length), govdeBas, '(statik)');
}
while ((sm = scriptRe.exec(html))) {
  const kod = sm[1], bas = sm.index + sm[0].indexOf(kod);
  if (kod.length < 50) continue;
  let ast; try { ast = parseAst(kod); } catch (e) { console.error('parse hata', satirOf(bas), e.message); continue; }
  const yigin = [];
  (function gez(n, fn) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'FunctionDeclaration' && n.id) fn = n.id.name;
    if (n.type === 'Literal' && typeof n.value === 'string') parcala(n.value, bas + n.start, fn);
    else if (n.type === 'TemplateLiteral') {
      const flat = n.quasis.map(q => q.value.cooked ?? q.value.raw).join('\u0001');
      parcala(flat, bas + n.start, fn);
    }
    if (n.type === 'TaggedTemplateExpression') {}
    for (const key in n) { if (key === 'parent') continue; const v = n[key];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && gez(c, fn));
      else if (v && typeof v.type === 'string') gez(v, fn); }
  })(ast, '(ust)');
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log('aday', out.length, 'tekil', new Set(out.map(x => x.k)).size);
