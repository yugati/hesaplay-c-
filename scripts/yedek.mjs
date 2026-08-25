/* TAM YEDEK - kullanim:  node scripts/yedek.mjs
   Canlidaki tum tablolari cekip OneDrive/Rabo.tr/YEDEK altina iki dosya yazar:
     1) saha-yedek_*_tam.json : uygulamanin "Yedek Yukle" dugmesinin tanidigi zarf (format 2)
     2) ham-yedek_*_tam.json  : tablo/satir ham kopyasi (id, data, created_at, updated_at)
                                -> cerrahi (yalniz eksik id'leri geri ekleme) icin
   Salt-okuma: hicbir yazma islemi yapmaz. Sonunda canli/yedek satir sayilarini karsilastirir.
   .env dosyasindaki VITE_SUPABASE_URL + APP_SUPABASE_SECRET_KEY (service_role) kullanilir.
   NOT: anon anahtar Asama 3'te kapatildi (bkz. asama3_anon_kapat.sql) - bu betik
   artik service_role ile okur. Anahtar .env'de, git'e girmiyor. */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import crypto from 'crypto';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.APP_SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const OUT = 'C:/Users/bykara-a/OneDrive/Rabo.tr/YEDEK';
const mb = b => (b / 1048576).toFixed(2) + ' MB';
const uyku = ms => new Promise(r => setTimeout(r, ms));

async function sayi(t) {
  const { count, error } = await sb.from(t).select('id', { count: 'exact', head: true });
  if (error) return { n: null, err: error.message };
  return { n: count || 0 };
}

/* Sayfa boyutunu UYARLAYARAK ceker: sorgu zaman asimi gorurse boyutu yariya indirip
   tekrar dener (proje_items gibi gomulu foto/PDF tasiyan tablolar 100'luk sayfada
   Supabase'in statement timeout'una takiliyor). */
async function hamCek(t) {
  const rows = []; let from = 0, boy = 100, kucultme = 0;
  for (;;) {
    const { data, error } = await sb.from(t).select('id,data,created_at,updated_at')
      .range(from, from + boy - 1).order('created_at', { ascending: true });
    if (error) {
      if (/timeout|canceling statement/i.test(error.message) && boy > 2) {
        boy = Math.max(2, Math.floor(boy / 2)); kucultme++;
        process.stdout.write(' [sayfa->' + boy + '] '); await uyku(800); continue;
      }
      if (/schema cache|does not exist/i.test(error.message)) return { rows: null, yok: true };
      throw new Error(t + ': ' + error.message);
    }
    rows.push(...(data || []));
    process.stdout.write('.');
    if (!data || data.length < boy) break;
    from += data.length;
  }
  return { rows, kucultme };
}

async function anahtarDeger(t, k, v) {
  const { data, error } = await sb.from(t).select(k + ',' + v);
  if (error) return {};
  const m = {}; (data || []).forEach(r => { m[r[k]] = r[v]; }); return m;
}
async function liste(t, kolon, sirala) {
  const { data, error } = await sb.from(t).select(kolon).order(sirala, { ascending: true });
  if (error) return [];
  return (data || []).map(x => x[kolon]);
}

const TABLOLAR = ['companies', 'tutanaklar', 'alet_items', 'alet_lib', 'saha_panels', 'saha_lines', 'saha_sockets',
  'rapor_entries', 'gecici_lib', 'gecici_moves', 'gecici_orders', 'proje_sartnames', 'proje_materials',
  'proje_specs', 'proje_items', 'proje_orders', 'proje_alternatives', 'proje_bina_modelleri', 'proje_lokasyonlar',
  'gunluk_isler', 'ihtiyac_listeleri'];

console.log('== TAM YEDEK ==');
console.log('Kaynak:', env.VITE_SUPABASE_URL, '\n');

const ham = {}, ozet = [];
for (const t of TABLOLAR) {
  process.stdout.write(t.padEnd(24));
  const { n, err } = await sayi(t);
  if (err) { console.log('  TABLO YOK / erisilemez'); ham[t] = []; ozet.push({ tablo: t, canli: 0, yedek: 0, not: 'tablo yok' }); continue; }
  const t0 = Date.now();
  const { rows, yok, kucultme } = await hamCek(t);
  if (yok) { console.log('  TABLO YOK'); ham[t] = []; ozet.push({ tablo: t, canli: 0, yedek: 0, not: 'tablo yok' }); continue; }
  ham[t] = rows;
  const byte = Buffer.byteLength(JSON.stringify(rows), 'utf8');
  console.log('  ' + String(rows.length).padStart(5) + '/' + String(n).padStart(5) + ' satir  ' +
    mb(byte).padStart(9) + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 'sn' + (kucultme ? '  (sayfa kucultuldu)' : ''));
  ozet.push({ tablo: t, canli: n, yedek: rows.length, byte });
}

const settings = await anahtarDeger('app_settings', 'key', 'value');
const sahaSet = await anahtarDeger('saha_settings', 'key', 'value');
const ekipler = await liste('rapor_ekipler', 'name', 'created_at');
const buildings = await liste('proje_buildings', 'code', 'sort_order');
const sections = await liste('proje_sections', 'name', 'sort_order');
const { data: auditRows } = await sb.from('audit_log').select('data').order('created_at', { ascending: true });
const audit = (auditRows || []).map(r => r.data);
console.log('\nayarlar:', Object.keys(settings).length, '| saha ayarlari:', Object.keys(sahaSet).length,
  '| ekip:', ekipler.length, '| bina:', buildings.length, '| bolum:', sections.length, '| denetim kaydi:', audit.length);

const d = x => ham[x].map(r => r.data);
const DB = {
  companies: d('companies'), tutanaklar: d('tutanaklar'), gunlukIsler: d('gunluk_isler'),
  ihtiyaclar: d('ihtiyac_listeleri'),
  alet: { items: d('alet_items'), lib: d('alet_lib') },
  saha: { bg: sahaSet.bg || null, bgName: sahaSet.bgName || '', panels: d('saha_panels'), lines: d('saha_lines'), sockets: d('saha_sockets') },
  rapor: { entries: d('rapor_entries'), ekipler, meta: {} },
  gecici: { lib: d('gecici_lib'), moves: d('gecici_moves'), orders: d('gecici_orders') },
  proje: {
    buildings, sections, sartnames: d('proje_sartnames'), materials: d('proje_materials'),
    specs: d('proje_specs'), items: d('proje_items'), orders: d('proje_orders'),
    alternatives: d('proje_alternatives'), binaModelleri: d('proje_bina_modelleri'), lokasyonlar: d('proje_lokasyonlar')
  },
  meta: {
    ...settings, created: settings.created || Date.now(), updated: Date.now(), seeded: true,
    tavaSeed: settings.tavaSeed || false, tavaSeedV: settings.tavaSeedV != null ? settings.tavaSeedV : 4,
    specWipeV: settings.specWipeV != null ? settings.specWipeV : 1, matLibV: settings.matLibV != null ? settings.matLibV : 1,
    audit
  },
};

const p = DB.proje, g = DB.gecici, a = DB.alet, s = DB.saha, r = DB.rapor;
const counts = {
  'Bina': p.buildings.length, 'Bolum': p.sections.length, 'Proje malzemesi': p.items.length,
  'Spesifikasyon': p.specs.length, 'Siparis': p.orders.length, 'Malzeme kutuphanesi': p.materials.length,
  'Alternatif urun': p.alternatives.length, 'Sirket': DB.companies.length, 'Lokasyon (parcali giris)': p.lokasyonlar.length,
  'Sartname tanimi': p.sartnames.length, 'Gecici elektrik urunu': g.lib.length, 'Gecici elektrik hareketi': g.moves.length,
  'El aleti': a.items.length, 'Saha plani ogesi': s.panels.length + s.lines.length + s.sockets.length,
  'Gunluk rapor kaydi': r.entries.length, 'Tutanak': DB.tutanaklar.length,
  'Gunluk is (gorev)': DB.gunlukIsler.length, 'Ihtiyac listesi': DB.ihtiyaclar.length
};

const dt = new Date(), z = x => String(x).padStart(2, '0');
const ts = dt.getFullYear() + '-' + z(dt.getMonth() + 1) + '-' + z(dt.getDate()) + '_' + z(dt.getHours()) + '-' + z(dt.getMinutes());
const f1 = OUT + '/saha-yedek_' + ts + '_tam.json';
const f2 = OUT + '/ham-yedek_' + ts + '_tam.json';
const env1 = JSON.stringify({ app: 'saha-malzeme-takip', format: 2, createdAt: new Date().toISOString(), user: 'scripts/yedek.mjs', counts, data: DB });
const env2 = JSON.stringify({
  app: 'saha-malzeme-takip-ham', format: 1, createdAt: new Date().toISOString(),
  kaynak: env.VITE_SUPABASE_URL, not: 'tablo/satir ham kopya - cerrahi geri yukleme icin',
  tablolar: ham,
  ayarlar: { app_settings: settings, saha_settings: sahaSet, rapor_ekipler: ekipler, proje_buildings: buildings, proje_sections: sections },
  audit_log: audit
});
fs.writeFileSync(f1, env1); fs.writeFileSync(f2, env2);
const sha = x => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);

console.log('\n== YAZILAN DOSYALAR ==');
console.log(f1); console.log('    ' + mb(Buffer.byteLength(env1)) + '  sha256:' + sha(env1));
console.log(f2); console.log('    ' + mb(Buffer.byteLength(env2)) + '  sha256:' + sha(env2));

console.log('\n== SAYIM DOGRULAMA (canli -> yedek) ==');
let hata = 0;
ozet.forEach(o => {
  const ok = o.canli === o.yedek; if (!ok) hata++;
  console.log((ok ? '  OK  ' : '  !!  ') + o.tablo.padEnd(24) + String(o.canli).padStart(6) + ' -> ' + String(o.yedek).padStart(6) + (o.not ? '  ' + o.not : ''));
});
console.log(hata ? '\n' + hata + ' TABLODA FARK VAR - INCELE' : '\nTUM TABLOLAR BIREBIR ESLESTI');
