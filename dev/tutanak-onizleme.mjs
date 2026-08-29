/* ==================================================================
   TUTANAK CANLI ONIZLEME  —  npm run tutanak
   ------------------------------------------------------------------
   index.html'deki GERCEK cikti kodunu (tutanakPrintCss / tutPrintHead /
   tutPrintFoot / tutPrintTableHead / tutanakPrintHtml) okur, ornek
   verilerle calistirir ve tarayiciya basar.

   - index.html kaydedildigi an sayfa kendini yeniler (kaydirma konumu
     korunur), boylece formatta yaptiginiz degisiklik aninda gorunur.
   - Uygulamaya, veritabanina, Supabase'e HIC dokunmaz: sadece dosyayi
     okur. Uretime giden pakete de girmez (vite yalniz kok index.html'i
     derler).
   - Ust seritteki senaryolarla sayfalama sinirlarini denersiniz: kalem
     sayisi, iade seridi, aciklama uzunlugu, bos antet, fotografsiz satir.
   - Her yaprakta gercek yuksekligi mm cinsinden gosteren bir rozet ve
     A4'un 297mm sinirini gosteren kirmizi cizgi vardir: kutu tasiyorsa
     (arkaya bos yaprak dusuren klasik hata) yazdirmadan once gorursunuz.
   ================================================================== */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const KOK = path.resolve(import.meta.dirname, '..');
const KAYNAK = path.join(KOK, 'index.html');
const PORT = Number(process.env.PORT) || 5180;

/* ---------- index.html'den cikti kodunu cikar ----------
   Satir numarasi SABITLENMEZ: bloklar adiyla bulunur, boylece dosyada
   satir kaydiran her duzenlemeden sonra da calisir. */
const FONKSIYONLAR = [
  'tutFirma', 'tutIadeVar', 'tutIadeTarihi', 'tutAntet', 'tutLineImg',
  'tutFilledLines', 'tutTotals',
  'tutanakPrintCss', 'tutPrintHead', 'tutPrintFoot', 'tutPrintTableHead', 'tutanakPrintHtml'
];
const SABITLER = ['TUT_ROWS_FIRST', 'TUT_ROWS_FIRST_ARA', 'TUT_ROWS_PER_PAGE', 'TUT_ROWS_ARA'];

/* Fonksiyon govdesini ayrac esleyerek cikarir. Satir sonuna / girintiye
   bakan basit bir kural burada calismaz: tutanakPrintCss bastan sona sus
   parantezi dolu bir sablon dizgisi, tutanakPrintHtml ise ic ice sablon +
   duzenli ifade barindiriyor. Bu yuzden dizgi ("..." '...' `...`), sablon
   icindeki ${...}, yorum satirlari ve duzenli ifadeler ayri ayri atlanir. */
function govdeSonu(src, acilis) {
  let i = acilis, derinlik = 0;
  const yigin = [];                 // sablon dizgisi icindeki ${} takibi
  let oncekiAnlamli = '';
  while (i < src.length) {
    const c = src[i], iki = src.slice(i, i + 2);
    if (iki === '//') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (iki === '/*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '"' || c === "'") { i = dizgiSonu(src, i, c); continue; }
    if (c === '`') { yigin.push('tpl'); i = sablonAtla(src, i, yigin); continue; }
    if (c === '/' && duzenliIfadeMi(oncekiAnlamli)) { i = dizgiSonu(src, i, '/'); oncekiAnlamli = '/'; continue; }
    if (c === '{') derinlik++;
    if (c === '}') { derinlik--; if (derinlik === 0) return i + 1; }
    if (!/\s/.test(c)) oncekiAnlamli = c;
    i++;
  }
  return -1;
}
// kapanis tirnagina kadar atla (ters bolu ile kacislari sayarak)
function dizgiSonu(src, i, tirnak) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === tirnak) return j + 1;
  }
  return src.length;
}
// sablon dizgisini atlar; icindeki ${ ... } parcalarinda kod kurallari yeniden gecerli
function sablonAtla(src, i, yigin) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '`') { yigin.pop(); return j + 1; }
    if (src.slice(j, j + 2) === '${') {
      let d = 1; j += 2;
      while (j < src.length && d > 0) {
        if (src[j] === '`') { j = sablonAtla(src, j, yigin) - 1; }
        else if (src[j] === '"' || src[j] === "'") { j = dizgiSonu(src, j, src[j]) - 1; }
        else if (src[j] === '{') d++;
        else if (src[j] === '}') d--;
        j++;
      }
      j--;
    }
  }
  return src.length;
}
// "/" duzenli ifade mi yoksa bolme mi: onceki anlamli karakter belirler
function duzenliIfadeMi(oncekiAnlamli) {
  return oncekiAnlamli === '' || '(,=:[!&|?{};+-*%~^<>'.includes(oncekiAnlamli);
}

function blokCikar(src, ad) {
  const im = 'function ' + ad + '(';
  const bas = src.startsWith(im) ? 0 : src.indexOf('\n' + im);
  if (bas < 0) throw new Error('index.html icinde "' + im + '" bulunamadi - fonksiyon adi mi degisti?');
  const b = bas === 0 ? 0 : bas + 1;
  const acilis = src.indexOf('{', src.indexOf(')', b));
  const son = govdeSonu(src, acilis);
  if (son < 0) throw new Error('"' + ad + '" fonksiyonunun sonu bulunamadi');
  return src.slice(b, son);
}
function sabitCikar(satirlar, ad) {
  const s = satirlar.find(x => x.startsWith('const ' + ad + '='));
  if (!s) throw new Error('index.html icinde "const ' + ad + '=" bulunamadi');
  return s;
}

function ciktiKodu() {
  const src = fs.readFileSync(KAYNAK, 'utf8');
  const satirlar = src.split(/\r?\n/);
  return [
    ...SABITLER.map(a => sabitCikar(satirlar, a)),
    ...FONKSIYONLAR.map(a => blokCikar(src, a))
  ].join('\n');
}

/* ---------- uygulamadaki yardimcilarin birebir karsiliklari ---------- */
const ORTAM = [
  'const esc=s=>String(s==null?\'\':s).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]));',
  'const fmtDate=ts=>{ if(ts==null||ts==="")return""; const d=new Date(ts); return isNaN(d)?String(ts):d.toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"}); };',
  'const fmtNum=n=>(Math.round((Number(n)||0)*100)/100).toLocaleString("tr-TR");',
  'const location={origin:""};'
].join('\n');

/* ---------- ornek veri ---------- */
const foto = (harf, renk) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="' + renk + '"/>' +
  '<text x="40" y="47" font-family="Arial" font-size="28" fill="#fff" text-anchor="middle">' + harf + '</text></svg>');

const LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60"><rect width="220" height="60" fill="#fff"/>' +
  '<text x="2" y="43" font-family="Arial" font-weight="bold" font-size="34" fill="#3e5680">YUGATI</text></svg>');

const KUTUPHANE = {
  m1: { id: 'm1', img: foto('K', '#4d6288') }, m2: { id: 'm2', img: foto('P', '#9e5f5f') },
  m3: { id: 'm3', img: foto('B', '#3a5f96') }, m4: { id: 'm4', img: foto('T', '#6b8f71') },
  m5: { id: 'm5', img: foto('S', '#b08968') }, m6: { id: 'm6', img: foto('A', '#7b6a9c') }
};

const MALZEMELER = [
  ['KBL-3X2.5', 'NYY Kablo 3x2,5 mm² siyah', 'Prysmian', 'm', 450, 'Siyah'],
  ['PRZ-16A', 'Priz topraklı sıva altı 16A', 'Viko', 'ad', 120, 'Beyaz'],
  ['BUAT-100', 'Buat kutusu 100x100 IP55', 'Mutlusan', 'ad', 75, 'Gri'],
  ['TAV-200', 'Kablo tavası 200x60 sıcak daldırma galvaniz', 'Eleks', 'm', 96, 'Galvaniz'],
  ['SGT-25', 'Spiral boru 25 mm halojensiz', 'Boryapı', 'm', 300, 'Turuncu'],
  ['AVZ-60', 'LED armatür 60x60 40W 4000K', 'Vestel', 'ad', 48, 'Beyaz'],
  ['KBL-5X6', 'NYY Kablo 5x6 mm²', 'Prysmian', 'm', 180, 'Siyah'],
  ['ANH-16A', 'Anahtar komütatör sıva altı', 'Viko', 'ad', 64, 'Beyaz'],
  ['PNO-12', 'Sıva altı pano 12 modül', 'Çetinkaya', 'ad', 8, 'Beyaz'],
  ['TOP-16', 'Topraklama iletkeni 16 mm² yeşil/sarı', 'Hes', 'm', 220, 'Yeşil/Sarı'],
  ['KLP-25', 'Kablo kelepçesi 25 mm', 'Mutlusan', 'ad', 500, 'Gri'],
  ['ACL-24', 'Acil aydınlatma armatürü 3 saat', 'Arsel', 'ad', 24, 'Beyaz']
];
const UZUN_AD = 'Halojensiz alev iletmeyen çok damarlı bakır iletkenli yangına dayanıklı güç kablosu N2XH FE180/E90 5x25 mm² (TSE belgeli, 90 dakika fonksiyon koruma)';

const NOTLAR = {
  yok: '',
  kisa: 'Malzemeler sahada teslim alınmış, ambalajları kontrol edilmiştir.',
  uzun: 'Malzemeler sahada teslim alınmış, ambalajları ve miktarları karşılıklı sayılarak kontrol edilmiştir. İade şartlı kalemler proje bitiminde eksiksiz olarak depoya iade edilecektir.\nTeslim sırasında hasarlı veya eksik kalem tespit edilmemiştir.\nTaşıma ve istifleme sorumluluğu teslim alan tarafa aittir.',
  cokuzun: Array.from({ length: 26 }, (_, i) =>
    (i + 1) + '. Teslim edilen malzemelerin şantiye içi taşınması, istiflenmesi ve hava şartlarından korunması teslim alan tarafın sorumluluğundadır; bu maddede belirtilen şartlara uyulmaması hâlinde doğacak hasarlardan teslim eden taraf sorumlu tutulamaz.').join('\n')
};

function ornekTutanak(q) {
  const n = Math.max(0, Math.min(60, Number(q.n == null ? 12 : q.n) || 0));
  const fotoVar = q.foto !== '0';
  const uzunAd = q.uzun === '1';
  const lines = Array.from({ length: n }, (_, i) => {
    const m = MALZEMELER[i % MALZEMELER.length];
    const tur = (i % 6) + 1;
    return {
      id: 'l' + i, matId: fotoVar ? 'm' + tur : '',
      code: i >= MALZEMELER.length ? m[0] + '-' + (Math.floor(i / MALZEMELER.length) + 1) : m[0],
      ad: (uzunAd && i % 3 === 0) ? UZUN_AD : m[1],
      marka: m[2], birim: m[3], qty: String(m[4] + i),
      barkod: '869' + String(1000000000 + i * 7), renk: m[5]
    };
  });
  const iade = q.iade === '1';
  return {
    // belge kodu: KISALTMA-TNK-ggaayyyy-sira (bkz. index.html tutKodOnek)
    id: 't1', no: 'YU-TNK-' + ornekKodTarih() + '-0007', tarih: Date.now(), tur: 'teslim',
    iade, iadeTarih: (iade && q.iadetarih !== '0') ? Date.now() + 30 * 86400000 : null,
    eden: { firmaId: 'c1', ad: 'Mahmut U.', gorev: 'Saha Depo Sorumlusu' },
    alan: { firma: 'STROY MONTAJ OOO', ad: 'Иванов И.И.', gorev: 'Прораб' },
    aciklama: NOTLAR[q.not || 'uzun'] == null ? NOTLAR.uzun : NOTLAR[q.not || 'uzun'],
    lines
  };
}

// ciktidaki ornek numaranin tarih bolumu, tutanagin tarihiyle ayni gunu gostersin
function ornekKodTarih() {
  const d = new Date(), p = x => String(x).padStart(2, '0');
  return p(d.getDate()) + p(d.getMonth() + 1) + d.getFullYear();
}

function ornekDB(q) {
  const bos = q.antet === '0';
  return {
    companies: [{ id: 'c1', ad: 'YUGATI İNŞAAT SAN. VE TİC. A.Ş.' }],
    meta: {
      tutanakAntet: bos ? {} : {
        unvan: 'YUGATI İNŞAAT SAN. VE TİC. A.Ş.',
        adres: 'Örnek Mah. Şantiye Cad. No:12, İstanbul',
        tel: '+90 212 000 00 00', email: 'info@yugati.com.tr',
        vergi: '1234567890', logo: LOGO
      }
    }
  };
}

/* ---------- cikti uret ---------- */
function ciktiUret(q) {
  const uret = new Function('DB', 'getMaterial', ORTAM + '\n' + ciktiKodu() + '\nreturn tutanakPrintHtml;');
  return uret(ornekDB(q), id => KUTUPHANE[id] || null)(ornekTutanak(q));
}

/* ---------- onizleme kabugu: dev seridi + olcum + canli yenileme ---------- */
const SENARYOLAR = [
  ['Standart (12 kalem)', 'n=12&iade=1&not=uzun'],
  ['Tek sayfa (6 kalem)', 'n=6&iade=0&not=kisa'],
  ['Tam sınır (8 kalem)', 'n=8&iade=0&not=kisa'],
  ['Uzun (30 kalem)', 'n=30&iade=1&not=uzun'],
  ['Çok uzun açıklama', 'n=10&iade=0&not=cokuzun'],
  ['Açıklama yok', 'n=9&iade=0&not=yok'],
  ['Uzun malzeme adı', 'n=12&iade=1&not=kisa&uzun=1'],
  ['Fotoğrafsız', 'n=12&iade=0&not=kisa&foto=0'],
  ['Antet boş', 'n=8&iade=0&not=kisa&antet=0']
];

function kabuk(html, qs, rev) {
  const aktif = qs || 'n=12&iade=1&not=uzun';
  const baglantilar = SENARYOLAR.map(s =>
    '<a href="/?' + s[1] + '" class="' + (s[1] === aktif ? 'on' : '') + '">' + s[0] + '</a>').join('');

  const serit = '<div class="devbar">' +
    '<div class="dtitle">TUTANAK ÖNİZLEME<span>index.html kaydedilince kendini yeniler</span></div>' +
    '<div class="dlinks">' + baglantilar + '</div>' +
    '<div class="dtools"><label><input type="checkbox" id="dSinir" checked> A4 sınırı</label>' +
    '<button onclick="window.print()">Yazdır</button></div></div>';

  const stil = `<style id="devstil">
  .devbar{position:sticky;top:0;z-index:20;background:#141b24;color:#dbe3ee;padding:9px 14px;
    font:12px/1.45 Arial,Helvetica,sans-serif;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}
  .devbar .dtitle{font-weight:bold;letter-spacing:.6px;color:#fff}
  .devbar .dtitle span{display:block;font-weight:normal;letter-spacing:0;color:#7f8ea3;font-size:11px}
  .devbar .dlinks{display:flex;flex-wrap:wrap;gap:5px;flex:1}
  .devbar a{color:#c3cfe0;text-decoration:none;padding:4px 9px;border-radius:5px;background:#1f2937;white-space:nowrap}
  .devbar a:hover{background:#2b3a4d;color:#fff}
  .devbar a.on{background:#3b82f6;color:#fff;font-weight:bold}
  .devbar .dtools{display:flex;gap:12px;align-items:center;color:#9fb0c4}
  .devbar button{background:#3b82f6;color:#fff;border:none;border-radius:5px;padding:5px 13px;
    font:bold 12px Arial,sans-serif;cursor:pointer}
  .devbar label{display:flex;gap:5px;align-items:center;cursor:pointer}
  /* yaprak olcum rozeti */
  .sheets .page{position:relative}
  .dmark{position:absolute;top:0;right:-124px;width:112px;font:11px/1.35 Arial,sans-serif;color:#5b6a7d}
  .dmark b{display:block;font-size:12px;color:#1f2937}
  .dmark.tasti b{color:#b91c1c}
  .dmark.tasti::after{content:'A4 sınırını aşıyor — arkaya boş yaprak düşer';display:block;color:#b91c1c;margin-top:3px}
  /* A4'un gercek 297mm siniri */
  .dsinir{position:absolute;left:0;right:0;top:297mm;border-top:1.5px dashed #ef4444;pointer-events:none}
  .dsinir::after{content:'297 mm — A4 alt kenarı';position:absolute;right:2mm;top:2px;font:10px Arial,sans-serif;color:#ef4444}
  body.dgizli .dsinir{display:none}
  @media print{.devbar,.dmark,.dsinir{display:none}}
  </style>`;

  const betik = '<script id="devbetik">\n' +
    '(function(){\n' +
    '  var REV=' + JSON.stringify(rev) + ';\n' +
    '  try{ var y=sessionStorage.getItem("tutY"); if(y) window.scrollTo(0,Number(y));\n' +
    '       addEventListener("scroll",function(){ sessionStorage.setItem("tutY",String(scrollY)); },{passive:true}); }catch(e){}\n' +
    '  var PX_MM=96/25.4;\n' +
    '  document.querySelectorAll(".sheets .page").forEach(function(p,i){\n' +
    '    var mm=p.getBoundingClientRect().height/PX_MM, tasti=mm>297.2;\n' +
    '    var d=document.createElement("div");\n' +
    '    d.className="dmark"+(tasti?" tasti":"");\n' +
    '    d.innerHTML="<b>Sayfa "+(i+1)+" · "+mm.toFixed(1)+" mm</b>"+(tasti?"":"kalan: "+(297-mm).toFixed(1)+" mm");\n' +
    '    p.appendChild(d);\n' +
    '    var s=document.createElement("div"); s.className="dsinir"; p.appendChild(s);\n' +
    '  });\n' +
    '  var cb=document.getElementById("dSinir");\n' +
    '  cb.addEventListener("change",function(){ document.body.classList.toggle("dgizli",!cb.checked); });\n' +
    '  setInterval(function(){ fetch("/rev").then(function(r){return r.text();})\n' +
    '    .then(function(t){ if(t!==REV) location.reload(); }).catch(function(){}); },400);\n' +
    '})();\n' +
    '<' + '/script>';

  return html
    // uygulamanin kendi kendine yazdirma betigi onizlemede kapali kalir
    .replace(/<script>window\.addEventListener\('load'[\s\S]*?<\/script>/, '')
    // ciktinin kendi ust seridi yerine dev seridi
    .replace(/<div class="tbar">[\s\S]*?<\/div>\s*(?=<div class="sheets">)/, serit)
    .replace('</head>', stil + '</head>')
    .replace('</body>', betik + '</body>');
}

/* ---------- sunucu ---------- */
const rev = () => { try { return String(fs.statSync(KAYNAK).mtimeMs); } catch (e) { return '0'; } };
const kacis = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/rev') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(rev()); return;
  }
  if (url.pathname !== '/') { res.writeHead(404); res.end('yok'); return; }
  try {
    const q = Object.fromEntries(url.searchParams);
    const html = kabuk(ciktiUret(q), url.searchParams.toString(), rev());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><meta charset="utf-8"><body style="font:14px/1.6 Arial;padding:28px;color:#7f1d1d;background:#fef2f2">' +
      '<h2 style="margin:0 0 8px">Önizleme üretilemedi</h2>' +
      '<p style="color:#991b1b">index.html\'deki tutanak kodu okunurken hata oluştu. Düzeltip kaydedin, sayfa kendini yenileyecek.</p>' +
      '<pre style="background:#fff;border:1px solid #fecaca;border-radius:6px;padding:14px;white-space:pre-wrap">' +
      kacis(e && e.stack || e) + '</pre>' +
      '<script>setInterval(function(){location.reload()},1200)<' + '/script></body>');
  }
}).listen(PORT, () => {
  console.log('\n  Tutanak önizleme:  http://localhost:' + PORT + '/');
  console.log('  Kaynak:            index.html  (kaydedince sayfa kendini yeniler)');
  console.log('  Durdurmak için:    Ctrl+C\n');
});
