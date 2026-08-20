// ─────────────────────────────────────────────────────────────────────────────
// ASAMA 3 - TARAYICIDA ARTIK SUPABASE ISTEMCISI VE ANAHTARI YOK
//
// Eskiden burada anon ("publishable") anahtarla bir Supabase istemcisi kuruluyordu.
// O anahtar derlemede JS paketine gomuluyor, veritabaninin butun tablolari da
// "FOR ALL TO anon USING (true)" politikasiyla acik oldugu icin siteyi acan
// herkes GIRIS YAPMADAN tum proje verisini okuyabiliyor, yazabiliyor ve
// silebiliyordu.
//
// Artik her sey /api/* uzerinden gidiyor: veri /api/veri, dosyalar /api/dosya.
// Ikisi de oturum dogrular ve sunucuda service_role ile calisir. Dosya yukleme
// bile anahtarsiz: sunucudan imzali adres alinir, tarayici dogrudan oraya PUT eder.
//
// Bu dosyada BILEREK hicbir Supabase import'u yoktur; eklenirse anahtar yeniden
// pakete girer ve arka kapi geri acilir. Sunucu tarafi icin lib/supabaseAdmin.js.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Users — artik dogrudan Supabase'e degil, /api/* sunucu fonksiyonlarina gider.
// 'users' tablosu anon anahtarla erisilemez hale getirildi (bkz. supabase_schema.sql);
// sifre dogrulama ve kullanici yonetimi service_role anahtariyla sunucuda yapilir.
// ─────────────────────────────────────────────────────────────────────────────

async function authFetch(path, opts = {}) {
  const token = (typeof window !== 'undefined' && window.AUTH_TOKEN) || null
  const headers = { ...(opts.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  const res = await fetch(path, { ...opts, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // OTURUM DUSTU: token gonderdik ama sunucu reddetti - suresi dolmus ya da
    // gecersiz. Asama 1'den beri TUM veri bu yoldan gectigi icin bu durumda
    // uygulama calisir gorunup her islemde sessizce hata verirdi; kullaniciya
    // acikca haber verilir (index.html oturumDustu). /api/login'in 401'i buraya
    // dusmez - orada henuz token yoktur.
    if (res.status === 401 && token && typeof window !== 'undefined' && window.oturumDustu) {
      window.oturumDustu()
    }
    const err = new Error(body.error || `Istek basarisiz (${res.status})`)
    err.status = res.status
    err.code = body.code
    throw err
  }
  return body
}

// Basarili girişte donen kullanici nesnesine __token alani eklenir; cagiran
// taraf (index.html doLogin) bunu cikarip ayri saklar. Diger cagiranlar
// (sifre yeniden dogrulama akislari) bu alani yok sayar.
export async function sbLoginUser(username, password, rememberMe) {
  try {
    const { user, token } = await authFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, rememberMe: !!rememberMe }),
    })
    return { ...user, __token: token }
  } catch (e) {
    if (e.status === 401) return null
    throw e
  }
}

// Aktif oturum tokeniyle (window.AUTH_TOKEN) kendi kaydini tazeler (arka plan
// yenileme icin - cagirandan once token atanmis olmali).
// Kullaniciyi tazeler ve YENI bir oturum tokeni getirir: {user, token, ttl}
// (eski cagiranlar yalnizca .user kullaniyordu, uyumlu kalir).
export async function sbGetUserByUsername() {
  try {
    const { user, token, ttl } = await authFetch('/api/me')
    return user ? { ...user, __token: token, __ttl: ttl } : null
  } catch (e) {
    // Token gecersiz/suresi dolmus ya da kullanici silinmis: gercekten
    // cikis yaptirilmali. Diger tum hatalar (ag, 5xx) yukari firlatilir ki
    // cagiran taraf gecici sorunlarda onbellekten sessizce devam etsin.
    if (e.status === 401 || e.status === 404) return null
    throw e
  }
}

export async function sbGetAllUsers() {
  return authFetch('/api/users')
}

export async function sbCreateUser({ username, password, role, sections, buildings, permissions }) {
  return authFetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role, sections, buildings, permissions: permissions || {} }),
  })
}

export async function sbUpdateUser(id, { password, role, sections, buildings, permissions }) {
  return authFetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, role, sections, buildings, permissions }),
  })
}

export async function sbDeleteUser(id) {
  await authFetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic helpers – JSONB data tabloları için
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// VERI ERISIMI - tarayici Supabase'e DOGRUDAN gitmez (Asama 1)
//
// Her tablo islemi /api/veri'ye gider ve orada service_role anahtariyla calisir.
// Boylece anon anahtarin tarayiciya gomulu olmasi tek basina veriye erisim
// saglamaz. Uc, genel bir SQL kapisi degildir: tablo/sutun/siralama beyaz listeyle
// sinirlidir (bkz. api/veri.js).
//
// Postgres hata kodu sunucudan aynen geri gelir (authFetch onu err.code'a koyar) -
// sbFetchRange'in zaman asimi kurtarmasi bu koda bakiyor, kaybolursa calismaz.
// ─────────────────────────────────────────────────────────────────────────────
async function veri(govde) {
  return authFetch('/api/veri', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(govde),
  })
}
async function veriSelect(table, opts = {}) {
  const { rows } = await veri({ op: 'select', table, ...opts })
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// ONBELLEK (IndexedDB) - ARTIMLI YUKLEME icin
//
// Uygulama her acilista TUM veriyi bastan indiriyordu. Bu, Supabase'in aylik
// egress kotasini yakan sey oldu (19 Agu 2026'da proje kotadan kapandi).
// Artik sunucudan yalnizca KIMLIK LISTESI iner (id + updated_at, satir basina
// ~45 bayt); istemci bunu onbellegiyle karsilastirip SADECE degisen satirlarin
// verisini ister. Degismeyen satirlar bir daha inmez.
//
// Dogruluk: sonuc her zaman SUNUCUNUN kimlik listesinden kurulur. Silinen satir
// listede olmadigi icin sonuca giremez - onbellekte kalsa bile gorunmez.
// Herhangi bir aksilikte (IndexedDB yok, surum degisti, satir eksik) tam yukleme
// yapilir: en kotu ihtimalle eski davranisa doneriz, yanlis veri gosterilmez.
// ─────────────────────────────────────────────────────────────────────────────

const ONBELLEK_DB = 'saha-onbellek'
const ONBELLEK_DEPO = 'tablolar'
const ONBELLEK_SURUM = 1        // bicim degisirse artir - eski onbellek yok sayilir
let _idb = null

function idbAc() {
  if (_idb) return _idb
  _idb = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const istek = indexedDB.open(ONBELLEK_DB, ONBELLEK_SURUM)
      istek.onupgradeneeded = () => {
        const db = istek.result
        // surum atlayinca eski depo silinip yeniden kurulur (bicim degisikligi guvenligi)
        if (db.objectStoreNames.contains(ONBELLEK_DEPO)) db.deleteObjectStore(ONBELLEK_DEPO)
        db.createObjectStore(ONBELLEK_DEPO)
      }
      istek.onsuccess = () => resolve(istek.result)
      istek.onerror = () => resolve(null)
      istek.onblocked = () => resolve(null)
    } catch (e) { resolve(null) }
  })
  return _idb
}

function idbIslem(mod, fn) {
  return idbAc().then(db => {
    if (!db) return null
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(ONBELLEK_DEPO, mod)
        const depo = tx.objectStore(ONBELLEK_DEPO)
        const r = fn(depo)
        tx.oncomplete = () => resolve(r && r.result !== undefined ? r.result : null)
        tx.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch (e) { resolve(null) }
    })
  }).catch(() => null)
}

// Onbellekten oku: Map(id -> {u: updated_at, d: data})
async function onbellekOku(table) {
  const kayit = await idbIslem('readonly', depo => depo.get(table))
  if (!kayit || !Array.isArray(kayit.satirlar)) return null
  const m = new Map()
  for (const s of kayit.satirlar) m.set(s.id, s)
  return m
}
async function onbellekYaz(table, satirlar) {
  await idbIslem('readwrite', depo => depo.put({ satirlar, ts: Date.now() }, table))
}
// Yedekten geri yukleme / toplu temizlik sonrasi onbellek gecersizdir.
export async function sbOnbellekTemizle() {
  await idbIslem('readwrite', depo => depo.clear())
}

/* ANAHTAR-DEGER tablolari icin artimli okuma (app_settings).
   Ayni mantik, tek farki kimligin 'key' olmasi. app_settings acilistaki en buyuk
   ikinci kalemdi (0.31 MB): tutanak anteti, kat listesi ve birlestirme gruplari
   burada duruyor ve degismedikleri halde her acilista iniyorlardi. */
async function anahtarDegerGetir(table) {
  const kimlikler = await veriSelect(table, { columns: 'key, updated_at' }) || []
  const onbellek = (await onbellekOku(table)) || new Map()
  const eksik = []
  for (const k of kimlikler) {
    const c = onbellek.get(k.key)
    if (!c || c.u !== k.updated_at) eksik.push(k.key)
  }
  const yeni = new Map()
  if (eksik.length) {
    for (let i = 0; i < eksik.length; i += SB_VERI_GRUBU) {
      const grup = eksik.slice(i, i + SB_VERI_GRUBU)
      const satirlar = await veriSelect(table, { columns: 'key, value', in: { col: 'key', vals: grup } }) || []
      for (const r of satirlar) yeni.set(r.key, r.value)
    }
  }
  const cikti = [], saklanacak = []
  for (const k of kimlikler) {
    const v = yeni.has(k.key) ? yeni.get(k.key) : (onbellek.get(k.key) || {}).d
    if (v === undefined) return veriSelect(table, { columns: 'key, value' }) || []   // guvenli geri donus: tam oku
    cikti.push({ key: k.key, value: v })
    saklanacak.push({ id: k.key, u: k.updated_at, d: v })
  }
  await onbellekYaz(table, saklanacak)
  return cikti
}

// Tablodaki tüm satırları entity dizisi olarak döndürür.
// HIZ: once toplam satir sayisi ogrenilir (head istegi - veri tasimaz), sonra
// sayfalar PARALEL cekilir. Eski surum 25'lik sayfalari TEK TEK ardisik cekiyordu;
// buyuk tablolarda giris onlarca yavas tura donusuyordu (1000 kayit = 40 ardisik
// istek). Simdi ayni veri birkac es zamanli dalgada iner.
// DAYANIKLILIK: bazı satırlar (ör. PDF gömülü eski kayıtlar) çok büyük olabiliyor;
// bir sayfa Postgres statement_timeout'una takilirsa ("canceling statement due to
// statement timeout") o aralik 5 parcaya bolunup yeniden denenir (1 satira kadar) -
// toplam veri boyutundan bağımsız olarak yükleme tamamlanır.
// SIRALAMA: created_at esitliginde (toplu import) sayfa siniri belirsizlesip satir
// atlatabildigi icin id ile esitlik kirilir - sayfalama artik deterministiktir.
const SB_TIMEOUT_CODES = new Set(['57014', '54000'])
const SB_PAGE_SIZE = 100
const SB_PAGE_CONCURRENCY = 5
async function sbFetchRange(table, from, to) {
  try {
    return await veriSelect(table, {
      columns: 'id, data',
      order: [{ col: 'created_at', asc: true }, { col: 'id', asc: true }],
      range: [from, to],
    }) || []
  } catch (e) {
    if (!(e && SB_TIMEOUT_CODES.has(e.code)) || to <= from) throw e
    // zaman asimi: araligi kucuk parcalara bolerek ayni satirlari yeniden dene
    const step = Math.max(1, Math.ceil((to - from + 1) / 5))
    const out = []
    for (let f = from; f <= to; f += step) {
      out.push(...await sbFetchRange(table, f, Math.min(to, f + step - 1)))
    }
    return out
  }
}
// Kimlik listesi sayfa boyu: satirlar cok kucuk oldugu icin veri sayfalarindan
// buyuk tutulur (1022 satirlik tablo 2 istekte iner). Sunucunun tek istek siniri 3000.
const SB_KIMLIK_SAYFA = 1000
// Degisen satirlar 'in' ile grup grup istenir - URL uzunlugu makul kalsin diye 100'luk
const SB_VERI_GRUBU = 100

async function sbGetAll(table) {
  const { count } = await veri({ op: 'count', table })
  const total = count || 0
  if (!total) { await onbellekYaz(table, []); return [] }

  // 1) SUNUCUNUN kimlik listesi - sonucun tek dogruluk kaynagi
  const kimlikler = []
  for (let f = 0; f < total; f += SB_KIMLIK_SAYFA) {
    kimlikler.push(...(await veriSelect(table, {
      columns: 'id, updated_at',
      order: [{ col: 'created_at', asc: true }, { col: 'id', asc: true }],
      range: [f, Math.min(total - 1, f + SB_KIMLIK_SAYFA - 1)],
    }) || []))
  }

  // 2) onbellekte olmayan ya da degismis satirlari belirle
  const onbellek = (await onbellekOku(table)) || new Map()
  const eksikIds = []
  for (const k of kimlikler) {
    const c = onbellek.get(k.id)
    if (!c || c.u !== k.updated_at) eksikIds.push(k.id)
  }

  // 3) yalnizca onlarin verisini cek
  const yeni = new Map()
  if (eksikIds.length) {
    const gruplar = []
    for (let i = 0; i < eksikIds.length; i += SB_VERI_GRUBU) gruplar.push(eksikIds.slice(i, i + SB_VERI_GRUBU))
    const sonuclar = new Array(gruplar.length)
    let sira = 0
    const isci = async () => {
      while (sira < gruplar.length) {
        const i = sira++
        sonuclar[i] = await sbFetchIds(table, gruplar[i])
      }
    }
    await Promise.all(Array.from({ length: Math.min(SB_PAGE_CONCURRENCY, gruplar.length) }, isci))
    for (const r of sonuclar.flat()) yeni.set(r.id, r.data)
  }

  // 4) sonucu SUNUCUNUN sirasiyla kur; bir satir hicbir kaynakta yoksa onbellege
  //    guvenme, tam yuklemeye don (veri eksik gostermektense yeniden indir)
  const satirlar = []
  for (const k of kimlikler) {
    const d = yeni.has(k.id) ? yeni.get(k.id) : (onbellek.get(k.id) || {}).d
    if (d === undefined) return sbGetAllTam(table, total)
    satirlar.push({ id: k.id, u: k.updated_at, d })
  }
  await onbellekYaz(table, satirlar)
  return satirlar.map(s => ({ ...s.d, id: s.id }))
}

/* Verilen id'lerin verisini getirir (artimli yuklemenin 3. adimi).
   sbFetchRange'deki gibi zaman asimi kurtarmasi var: bir grup Postgres'in sorgu
   suresini asarsa ikiye bolunup yeniden denenir. */
async function sbFetchIds(table, ids) {
  try {
    return await veriSelect(table, { columns: 'id, data', in: { col: 'id', vals: ids } }) || []
  } catch (e) {
    if (!(e && SB_TIMEOUT_CODES.has(e.code)) || ids.length <= 1) throw e
    const orta = Math.ceil(ids.length / 2)
    const [a, b] = await Promise.all([sbFetchIds(table, ids.slice(0, orta)), sbFetchIds(table, ids.slice(orta))])
    return a.concat(b)
  }
}

/* TAM yukleme - artimli yol bir satiri hicbir kaynakta bulamazsa kullanilan guvenli
   geri donus. Onbellege YAZMAZ, tam tersine o tablonun kaydini siler: buradaki
   satirlarin updated_at damgasi elimizde olmadigi icin yazilsaydi bir sonraki
   acilis her satiri "degismis" sanip hepsini yeniden indirirdi. Bos onbellek zaten
   dogru davranisi verir - sonraki acilis her seyi bir kez cekip duzgun onbellekler. */
async function sbGetAllTam(table, total) {
  await onbellekYaz(table, [])
  const ranges = []
  for (let f = 0; f < total; f += SB_PAGE_SIZE) ranges.push([f, Math.min(total - 1, f + SB_PAGE_SIZE - 1)])
  const pages = new Array(ranges.length)
  let next = 0
  const worker = async () => {
    while (next < ranges.length) { const i = next++; pages[i] = await sbFetchRange(table, ranges[i][0], ranges[i][1]) }
  }
  await Promise.all(Array.from({ length: Math.min(SB_PAGE_CONCURRENCY, ranges.length) }, worker))
  return pages.flat().map(r => ({ ...r.data, id: r.id }))
}

async function sbInsertEntity(table, entity) {
  await veri({ op: 'insert', table, rows: [{ id: entity.id, data: entity }] })
}

// Satir sayisinin yaninda TOPLAM BAYT boyutuna gore de parcalar: gomulu foto/PDF
// tasiyan kayitlar tek satirda birkac MB olabiliyor; 500 satirlik SABIT blok bu
// durumda tek istekte onlarca MB'a cikip sessizce basarisiz oluyordu (restore
// sirasinda hicbir hata gorunmeden kayit kaybi). Istek artik Vercel fonksiyonundan
// da gectigi icin ayrica 4.5 MB'lik govde siniri var - 3 MB onun altinda kalir.
const MAX_SATIR = 500
const MAX_BAYT = 3 * 1024 * 1024
function bayaGoreParcala(entities) {
  const chunks = []
  let cur = [], curBytes = 0
  for (const e of entities) {
    const size = JSON.stringify(e).length
    if (cur.length && (cur.length >= MAX_SATIR || curBytes + size > MAX_BAYT)) {
      chunks.push(cur); cur = []; curBytes = 0
    }
    cur.push(e); curBytes += size
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

async function sbInsertEntities(table, entities) {
  if (!entities || !entities.length) return
  for (const chunk of bayaGoreParcala(entities)) {
    await veri({ op: 'insert', table, rows: chunk.map(e => ({ id: e.id, data: e })) })
  }
}

async function sbUpsertEntities(table, entities) {
  if (!entities || !entities.length) return
  for (const chunk of bayaGoreParcala(entities)) {
    await veri({ op: 'upsert', table, onConflict: 'id', rows: chunk.map(e => ({ id: e.id, data: e })) })
  }
}

async function sbUpdateEntity(table, id, entity) {
  await veri({ op: 'update', table, eq: { col: 'id', val: id }, patch: { data: entity } })
}

async function sbDeleteEntity(table, id) {
  await veri({ op: 'delete', table, eq: { col: 'id', val: id } })
}

async function sbDeleteAll(table) {
  await veri({ op: 'delete', table, all: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// Uygulama ayarları (migration flags, meta)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetSetting(key) {
  const row = await veriSelect('app_settings', { columns: 'value', eq: { col: 'key', val: key }, single: true })
  return row ? row.value : null
}

export async function sbSetSetting(key, value) {
  await veri({ op: 'upsert', table: 'app_settings', onConflict: 'key', rows: [{ key, value }] })
}

// ─────────────────────────────────────────────────────────────────────────────
// Denetim kaydı (Audit log)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbInsertAuditLog(entry) {
  try {
    await veri({ op: 'insert', table: 'audit_log', rows: [{ data: entry }] })
  } catch (e) {
    console.warn('Audit log yazılamadı:', e)
  }
}

export async function sbGetAuditLog() {
  const rows = await veriSelect('audit_log', {
    columns: 'data', order: [{ col: 'created_at', asc: false }], limit: 2000,
  })
  return (rows || []).map(r => r.data)
}

// ─────────────────────────────────────────────────────────────────────────────
// Alet modülü
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetAletItems() { return sbGetAll('alet_items') }
export async function sbInsertAletItem(e) { return sbInsertEntity('alet_items', e) }
export async function sbInsertAletItems(items) { return sbInsertEntities('alet_items', items) }
export async function sbUpdateAletItem(id, e) { return sbUpdateEntity('alet_items', id, e) }
export async function sbDeleteAletItem(id) { return sbDeleteEntity('alet_items', id) }

// ─────────────────────────────────────────────────────────────────────────────
// Saha modülü
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetSahaPanels() { return sbGetAll('saha_panels') }
export async function sbInsertSahaPanel(e) { return sbInsertEntity('saha_panels', e) }
export async function sbUpdateSahaPanel(id, e) { return sbUpdateEntity('saha_panels', id, e) }
export async function sbDeleteSahaPanel(id) { return sbDeleteEntity('saha_panels', id) }

export async function sbGetSahaLines() { return sbGetAll('saha_lines') }
export async function sbInsertSahaLine(e) { return sbInsertEntity('saha_lines', e) }
export async function sbDeleteSahaLine(id) { return sbDeleteEntity('saha_lines', id) }

export async function sbGetSahaSockets() { return sbGetAll('saha_sockets') }
export async function sbInsertSahaSocket(e) { return sbInsertEntity('saha_sockets', e) }
export async function sbUpdateSahaSocket(id, e) { return sbUpdateEntity('saha_sockets', id, e) }
export async function sbDeleteSahaSocket(id) { return sbDeleteEntity('saha_sockets', id) }

export async function sbGetAllSahaSettings() {
  const rows = await veriSelect('saha_settings', { columns: 'key, value' })
  const map = {}
  ;(rows || []).forEach(r => { map[r.key] = r.value })
  return map
}

export async function sbSetSahaSetting(key, value) {
  await veri({ op: 'upsert', table: 'saha_settings', onConflict: 'key', rows: [{ key, value }] })
}

// ─────────────────────────────────────────────────────────────────────────────
// Rapor modülü
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetRaporEntries() { return sbGetAll('rapor_entries') }
export async function sbInsertRaporEntry(e) { return sbInsertEntity('rapor_entries', e) }
export async function sbInsertRaporEntries(items) { return sbInsertEntities('rapor_entries', items) }
export async function sbUpdateRaporEntry(id, e) { return sbUpdateEntity('rapor_entries', id, e) }
export async function sbDeleteRaporEntry(id) { return sbDeleteEntity('rapor_entries', id) }
export async function sbDeleteRaporEntriesByIds(ids) {
  await Promise.all(ids.map(id => sbDeleteEntity('rapor_entries', id)))
}

export async function sbGetRaporEkipler() {
  const rows = await veriSelect('rapor_ekipler', { columns: 'name', order: [{ col: 'created_at', asc: true }] })
  return (rows || []).map(r => r.name)
}

export async function sbInsertRaporEkip(name) {
  try { await veri({ op: 'upsert', table: 'rapor_ekipler', onConflict: 'name', rows: [{ name }] }) }
  catch (e) { console.warn('Ekip eklenemedi:', e) }
}

export async function sbInsertRaporEkipler(names) {
  if (!names || !names.length) return
  try { await veri({ op: 'upsert', table: 'rapor_ekipler', onConflict: 'name', rows: names.map(name => ({ name })) }) }
  catch (e) { console.warn('Ekipler eklenemedi:', e) }
}

export async function sbDeleteRaporEkip(name) {
  await veri({ op: 'delete', table: 'rapor_ekipler', eq: { col: 'name', val: name } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutanak (malzeme teslim tutanağı — TR/RU)
// Rapor modülünün yetkisiyle çalışır; kayıtlar 'tutanaklar' tablosunda durur.
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetTutanaklar() { return sbGetAll('tutanaklar') }
export async function sbInsertTutanak(e) { return sbInsertEntity('tutanaklar', e) }
export async function sbUpdateTutanak(id, e) { return sbUpdateEntity('tutanaklar', id, e) }
export async function sbDeleteTutanak(id) { return sbDeleteEntity('tutanaklar', id) }
export async function sbWipeTutanakData() { await sbDeleteAll('tutanaklar') }

// ─────────────────────────────────────────────────────────────────────────────
// Geçici modülü
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetGeciciLib() { return sbGetAll('gecici_lib') }
export async function sbInsertGeciciLibItem(e) { return sbInsertEntity('gecici_lib', e) }
export async function sbInsertGeciciLibItems(items) { return sbInsertEntities('gecici_lib', items) }
export async function sbUpdateGeciciLibItem(id, e) { return sbUpdateEntity('gecici_lib', id, e) }
export async function sbDeleteGeciciLibItem(id) { return sbDeleteEntity('gecici_lib', id) }

export async function sbGetGeciciMoves() { return sbGetAll('gecici_moves') }
export async function sbInsertGeciciMove(e) { return sbInsertEntity('gecici_moves', e) }
export async function sbInsertGeciciMoves(items) { return sbInsertEntities('gecici_moves', items) }
export async function sbDeleteGeciciMove(id) { return sbDeleteEntity('gecici_moves', id) }
export async function sbDeleteGeciciMovesByIds(ids) {
  await Promise.all(ids.map(id => sbDeleteEntity('gecici_moves', id)))
}

export async function sbGetGeciciOrders() { return sbGetAll('gecici_orders') }
export async function sbInsertGeciciOrder(e) { return sbInsertEntity('gecici_orders', e) }
export async function sbInsertGeciciOrders(items) { return sbInsertEntities('gecici_orders', items) }
export async function sbDeleteGeciciOrder(id) { return sbDeleteEntity('gecici_orders', id) }

// ─────────────────────────────────────────────────────────────────────────────
// Proje modülü
// ─────────────────────────────────────────────────────────────────────────────

const SIRA_BINA = [{ col: 'sort_order', asc: true }, { col: 'created_at', asc: true }]

export async function sbGetProjeBuildings() {
  const rows = await veriSelect('proje_buildings', { columns: 'code', order: SIRA_BINA })
  return (rows || []).map(r => r.code)
}

// 23505 = benzersizlik ihlali: ayni bina zaten var demek, hata degil (yutulur)
export async function sbInsertProjeBuilding(code) {
  try { await veri({ op: 'insert', table: 'proje_buildings', rows: [{ code }] }) }
  catch (e) { if (e.code !== '23505') throw e }
}

export async function sbInsertProjeBuildings(codes) {
  if (!codes || !codes.length) return
  for (let i = 0; i < codes.length; i++) {
    try { await veri({ op: 'insert', table: 'proje_buildings', rows: [{ code: codes[i], sort_order: i }] }) }
    catch (e) { if (e.code !== '23505') console.warn('Bina eklenemedi:', codes[i], e.message) }
  }
}

export async function sbDeleteProjeBuilding(code) {
  await veri({ op: 'delete', table: 'proje_buildings', eq: { col: 'code', val: code } })
}

// code kolonu binanin kendisi (ayri id yok) - yeniden adlandirma satiri silmez, sort_order/created_at korunur
export async function sbRenameProjeBuilding(oldCode, newCode) {
  await veri({ op: 'update', table: 'proje_buildings', eq: { col: 'code', val: oldCode }, patch: { code: newCode } })
}

export async function sbGetProjeSections() {
  const rows = await veriSelect('proje_sections', { columns: 'name', order: SIRA_BINA })
  return (rows || []).map(r => r.name)
}

export async function sbInsertProjeSection(name, sortOrder = 0) {
  try { await veri({ op: 'insert', table: 'proje_sections', rows: [{ name, sort_order: sortOrder }] }) }
  catch (e) { if (e.code !== '23505') throw e }
}

export async function sbInsertProjeSections(names) {
  if (!names || !names.length) return
  for (let i = 0; i < names.length; i++) {
    try { await veri({ op: 'insert', table: 'proje_sections', rows: [{ name: names[i], sort_order: i }] }) }
    catch (e) { if (e.code !== '23505') console.warn('Bölüm eklenemedi:', names[i], e.message) }
  }
}

export async function sbDeleteProjeSection(name) {
  await veri({ op: 'delete', table: 'proje_sections', eq: { col: 'name', val: name } })
}

export async function sbGetProjeSartnames() { return sbGetAll('proje_sartnames') }
export async function sbInsertProjeSartname(e) { return sbInsertEntity('proje_sartnames', e) }
export async function sbInsertProjeSartnames(items) { return sbInsertEntities('proje_sartnames', items) }
export async function sbUpdateProjeSartname(id, e) { return sbUpdateEntity('proje_sartnames', id, e) }
export async function sbDeleteProjeSartname(id) { return sbDeleteEntity('proje_sartnames', id) }

export async function sbGetProjeMaterials() { return sbGetAll('proje_materials') }
export async function sbInsertProjeMaterial(e) { return sbInsertEntity('proje_materials', e) }
export async function sbInsertProjeMaterials(items) { return sbInsertEntities('proje_materials', items) }
export async function sbUpdateProjeMaterial(id, e) { return sbUpdateEntity('proje_materials', id, e) }
export async function sbDeleteProjeMaterial(id) { return sbDeleteEntity('proje_materials', id) }
export async function sbDeleteProjeMaterials(ids) {
  await Promise.all(ids.map(id => sbDeleteEntity('proje_materials', id)))
}

export async function sbGetProjeSpecs() { return sbGetAll('proje_specs') }
export async function sbInsertProjeSpec(e) { return sbInsertEntity('proje_specs', e) }
export async function sbInsertProjeSpecs(items) { return sbInsertEntities('proje_specs', items) }
export async function sbUpdateProjeSpec(id, e) { return sbUpdateEntity('proje_specs', id, e) }
export async function sbDeleteProjeSpec(id) { return sbDeleteEntity('proje_specs', id) }
export async function sbDeleteProjeSpecs(ids) {
  await Promise.all(ids.map(id => sbDeleteEntity('proje_specs', id)))
}

export async function sbGetProjeItems() { return sbGetAll('proje_items') }
export async function sbInsertProjeItem(e) { return sbInsertEntity('proje_items', e) }
export async function sbInsertProjeItems(items) { return sbInsertEntities('proje_items', items) }
export async function sbUpdateProjeItem(id, e) { return sbUpdateEntity('proje_items', id, e) }
export async function sbDeleteProjeItem(id) { return sbDeleteEntity('proje_items', id) }
export async function sbDeleteProjeItems(ids) {
  await Promise.all(ids.map(id => sbDeleteEntity('proje_items', id)))
}

export async function sbGetProjeOrders() { return sbGetAll('proje_orders') }
export async function sbInsertProjeOrder(e) { return sbInsertEntity('proje_orders', e) }
export async function sbInsertProjeOrders(items) { return sbInsertEntities('proje_orders', items) }
export async function sbUpdateProjeOrder(id, e) { return sbUpdateEntity('proje_orders', id, e) }
export async function sbDeleteProjeOrder(id) { return sbDeleteEntity('proje_orders', id) }

// ─────────────────────────────────────────────────────────────────────────────
// Şirketler (sipariş/fatura girişinde seçilen firma listesi)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetCompanies() { return sbGetAll('companies') }
export async function sbInsertCompany(e) { return sbInsertEntity('companies', e) }
export async function sbUpdateCompany(id, e) { return sbUpdateEntity('companies', id, e) }
export async function sbDeleteCompany(id) { return sbDeleteEntity('companies', id) }

// ─────────────────────────────────────────────────────────────────────────────
// Alternatif Ürün modülü
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetProjeAlternatives() { return sbGetAll('proje_alternatives') }
export async function sbInsertProjeAlternative(e) { return sbInsertEntity('proje_alternatives', e) }
export async function sbUpdateProjeAlternative(id, e) { return sbUpdateEntity('proje_alternatives', id, e) }
export async function sbDeleteProjeAlternative(id) { return sbDeleteEntity('proje_alternatives', id) }

// Parçalı giriş: bina lokasyon kırılım ağacı (Kat / Fragment / Oda)
export async function sbInsertProjeLokasyon(e) { return sbInsertEntity('proje_lokasyonlar', e) }
export async function sbUpdateProjeLokasyon(id, e) { return sbUpdateEntity('proje_lokasyonlar', id, e) }
export async function sbDeleteProjeLokasyonlar(ids) {
  if (!ids || !ids.length) return
  await veri({ op: 'delete', table: 'proje_lokasyonlar', in: { col: 'id', vals: ids } })
}

// ─────────────────────────────────────────────────────────────────────────────
// Bina 3D Modelleri (glTF/.glb) - Supabase Storage + JSONB referans tablosu
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetProjeBinaModelleri() { return sbGetAll('proje_bina_modelleri') }
export async function sbInsertProjeBinaModel(e) { return sbInsertEntity('proje_bina_modelleri', e) }
export async function sbUpdateProjeBinaModel(id, e) { return sbUpdateEntity('proje_bina_modelleri', id, e) }
export async function sbDeleteProjeBinaModel(id) { return sbDeleteEntity('proje_bina_modelleri', id) }

/* 3D model dosyasi: eskiden tarayici anon anahtarla DOGRUDAN public kovaya yukluyor
   ve kalici bir public URL uretiyordu - o adresi bilen herkes dosyayi indirebilirdi.
   Artik kova PRIVATE; yukleme sunucudan alinan imzali adresle, okuma da kisa omurlu
   imzali adresle yapiliyor. Kayitta URL degil yalnizca 'path' saklanir. */
export async function sbModelYukle(bina, file) {
  return dosyaYukle('model', bina.replace(/[^A-Za-z0-9_-]/g, '') || 'bina', file)
}
export async function sbModelUrl(path) {
  return dosyaUrl(path, 'bina-modelleri')
}
export async function sbDeleteBinaModelFile(path) {
  return dosyaSil(path, 'bina-modelleri')
}

// ─────────────────────────────────────────────────────────────────────────────
// BELGELER (fatura PDF) - 'belgeler' kovasi PRIVATE. Tarayici oraya anon anahtarla
// erisemez; her islem /api/dosya uzerinden imzali adresle yapilir (bkz. api/dosya.js).
//
// Eskiden PDF, siparis kaydinin icinde base64 durdugu icin uygulama HER acilista
// tum faturalari indiriyordu (33 MB). Artik kayitta yalnizca 'path' var: dosya
// sadece kullanici PDF'e tikladiginda iner.
// ─────────────────────────────────────────────────────────────────────────────

/* Kisa omurlu (5 dk) imzali okuma adresi. */
async function dosyaUrl(path, kova) {
  const q = '/api/dosya?path=' + encodeURIComponent(path) + (kova ? '&kova=' + encodeURIComponent(kova) : '')
  const { url } = await authFetch(q)
  return url
}

/* Dosyayi Storage'a yukler, kayda yazilacak kunyeyi dondurur: {name, path, size}.
   Dosyanin KENDISI sunucudan gecmez: sunucudan imzali yukleme adresi alinir, dosya
   dogrudan Storage'a PUT edilir. Iki kazanc: Vercel'in 4.5 MB govde siniri yola
   girmez ve tarayicinin hicbir Supabase anahtarina ihtiyaci kalmaz (imza adresin
   icinde tasinir - Asama 3'te anon anahtar paketten tamamen kaldirildi). */
async function dosyaYukle(kind, id, file) {
  const { path, signedUrl } = await authFetch('/api/dosya', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id, name: file.name }),
  })
  if (!signedUrl) throw new Error('Yukleme adresi alinamadi')
  const r = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!r.ok) throw new Error('Dosya yuklenemedi (' + r.status + ')')
  return { name: file.name, path, size: file.size }
}

/* Kayittan cikarilan dosyayi kovadan da siler. Hata firlatmaz: kayit zaten
   guncellenmisse, kovada kalan yetim dosya isleyisi bozmaz. */
async function dosyaSil(path, kova) {
  if (!path) return
  try {
    const q = '/api/dosya?path=' + encodeURIComponent(path) + (kova ? '&kova=' + encodeURIComponent(kova) : '')
    await authFetch(q, { method: 'DELETE' })
  } catch (e) {
    console.warn('Dosya silinemedi (kovada kaldi):', path, e.message)
  }
}

export async function sbBelgeUrl(path) { return dosyaUrl(path) }
export async function sbBelgeYukle(kind, id, file) { return dosyaYukle(kind, id, file) }
export async function sbBelgeSil(path) { return dosyaSil(path) }

// ─────────────────────────────────────────────────────────────────────────────
// Upsert (import / sync sonrası toplu güncelleme)
// ─────────────────────────────────────────────────────────────────────────────

// Uc upsert de sbUpsertEntities'e baglandi: eskiden 500 satirlik SABIT bloklar
// halinde gidiyorlardi, bayt siniri yoktu. Gomulu foto/PDF tasiyan kayitlarda bu
// blok onlarca MB'a cikabiliyor; istek artik Vercel fonksiyonundan gectigi icin
// 4.5 MB govde sinirini asar ve sessizce basarisiz olurdu.
export async function sbUpsertProjeMaterials(items) { return sbUpsertEntities('proje_materials', items) }
export async function sbUpsertProjeSpecs(items) { return sbUpsertEntities('proje_specs', items) }
export async function sbUpsertProjeItems(items) { return sbUpsertEntities('proje_items', items) }

// ─────────────────────────────────────────────────────────────────────────────
// Tüm veriyi Supabase'den yükle (loadDB yerine)
// ─────────────────────────────────────────────────────────────────────────────

// scope: kullanicinin gorebildigi modul listesi (CURRENT_USER.sections), ornegin ['rapor'].
// Verilirse yalnizca o modullerin (+ onlarin bagimli olduğu proje temel verisinin) sorgulari
// atilir - digerleri (el aletleri, santiye sahasi, gecici elektrik, siparis/hareket, denetim
// kaydi vb.) atlanir. scope verilmezse (admin / eski cagirim) tum veri onceki gibi yuklenir.
export async function sbLoadAllData(scope) {
  const need = name => !scope || scope.includes(name)
  // rapor/tanimlar/kutuphane ekranlari da proje temel verisine (bina, bolum, sartname,
  // sartname kalemi, malzeme kutuphanesi) ihtiyac duyar - bunlar 'proje' modulunden ayrı sayılır.
  const needProjeCore = need('proje') || need('rapor') || need('tanimlar') || need('kutuphane')
  // 'siparis' bagimsiz bir modul haline geldi: yalnizca siparis yetkisi olan kullanici
  // (orn. ambarci) siparisleri, siparise bagli stok girislerini ve alternatif urunleri de
  // gormeli - yoksa "Tum Siparisler" ekrani bos acilir. Sirketler de siparis formunda secilir.
  const needProjeFull = need('proje') || need('siparis')
  const needCompanies = need('proje') || need('tanimlar') || need('siparis')

  const tasks = { settingsRes: anahtarDegerGetir('app_settings') }
  if (need('alet')) tasks.aletItems = sbGetAll('alet_items')
  if (need('saha')) {
    tasks.sahaPanels = sbGetAll('saha_panels')
    tasks.sahaLines = sbGetAll('saha_lines')
    tasks.sahaSockets = sbGetAll('saha_sockets')
    tasks.sahaSettings = sbGetAllSahaSettings()
  }
  if (need('gecici')) {
    tasks.geciciLib = sbGetAll('gecici_lib')
    tasks.geciciMoves = sbGetAll('gecici_moves')
    tasks.geciciOrders = sbGetAll('gecici_orders')
  }
  if (need('rapor')) {
    tasks.raporEntries = sbGetAll('rapor_entries')
    tasks.raporEkiplerRes = veriSelect('rapor_ekipler', { columns: 'name', order: [{ col: 'created_at', asc: true }] })
    // tutanaklar tablosu supabase_schema.sql'in yeni bölümüyle oluşturulur; migration
    // henüz çalıştırılmamışsa TÜM yüklemeyi kilitlememesi için hataya toleranslı.
    // Eksikse uygulamaya haber verilir: Tutanak ekrani "once SQL'i calistirin" uyarisi gosterir.
    tasks.tutanaklar = sbGetAll('tutanaklar').catch(() => {
      if (typeof window !== 'undefined') window.__tutanakTableMissing = true
      return []
    })
  }
  if (needProjeCore) {
    tasks.projeBuildingsRes = veriSelect('proje_buildings', { columns: 'code', order: SIRA_BINA })
    tasks.projeSectionsRes = veriSelect('proje_sections', { columns: 'name', order: SIRA_BINA })
    tasks.projeSartnames = sbGetAll('proje_sartnames')
    tasks.projeMaterials = sbGetAll('proje_materials')
    tasks.projeSpecs = sbGetAll('proje_specs')
    // proje_lokasyonlar tablosu supabase_schema.sql'in yeni bölümüyle oluşturulur;
    // migration henüz çalıştırılmamışsa yüklemeyi kilitlememesi için hataya toleranslı.
    tasks.projeLokasyonlar = sbGetAll('proje_lokasyonlar').catch(() => [])
  }
  if (needProjeFull) {
    tasks.projeItems = sbGetAll('proje_items')
    tasks.projeOrders = sbGetAll('proje_orders')
    tasks.projeAlternatives = sbGetAll('proje_alternatives')
    // proje_bina_modelleri tablosu supabase_schema.sql'in yeni eklenen kısmıyla oluşturulur;
    // migration henüz çalıştırılmamışsa tüm veri yüklemesini kilitlememesi için hataya toleranslı.
    tasks.projeBinaModelleri = sbGetAll('proje_bina_modelleri').catch(() => [])
  }
  if (needCompanies) tasks.companies = sbGetAll('companies').catch(() => [])
  // Denetim kaydini yalnizca YONETICI okuyabilir (Asama 2 - sunucu tarafi kontrol).
  // Hataya toleransli: bolumu tanimlanmamis bir kullanici tam yukleme yapsa bile
  // 403 yuzunden acilis kirilmasin, denetim listesi bos gelsin yeter.
  if (!scope) tasks.auditRes = veriSelect('audit_log', { columns: 'data', order: [{ col: 'created_at', asc: true }], limit: 2000 }).catch(() => [])

  const keys = Object.keys(tasks)
  // Yukleme ekranina GERCEK ilerleme bildirilir: her tablo tamamlandiginda hangi tablonun
  // indigi ve kacinci oldugu haber verilir (window.__sbLoadProgress varsa). Sorgular paralel
  // gittigi icin sira degisebilir - bildirilen ad her zaman O AN biten tablodur.
  const report = typeof window !== 'undefined' ? window.__sbLoadProgress : null
  if (report) { try { report({ phase: 'start', done: 0, total: keys.length }) } catch (_) {} }
  let done = 0
  const results = await Promise.all(keys.map(k => Promise.resolve(tasks[k]).then(v => {
    done++
    if (report) { try { report({ phase: 'task', key: k, done, total: keys.length }) } catch (_) {} }
    return v
  })))
  const r = {}
  keys.forEach((k, i) => { r[k] = results[i] })

  const ekipler = (r.raporEkiplerRes || []).map(x => x.name)
  const buildings = (r.projeBuildingsRes || []).map(x => x.code)
  const sections = (r.projeSectionsRes || []).map(x => x.name)
  const auditEntries = (r.auditRes || []).map(x => x.data)
  const settingsMap = {}
  ;(r.settingsRes || []).forEach(s => { settingsMap[s.key] = s.value })

  if (!scope) {
    // Supabase boşsa null döndür → localStorage migration tetiklenecek. Kismi (scope'lu)
    // yuklemede bu kontrol atlanir - o kullanicilar zaten migration'dan sorumlu degil.
    const hasData = !!(
      (r.aletItems || []).length || (r.sahaPanels || []).length || (r.geciciLib || []).length ||
      (r.projeItems || []).length || (r.projeSpecs || []).length || (r.projeMaterials || []).length ||
      (r.raporEntries || []).length || (r.projeOrders || []).length
    )
    if (!hasData && !buildings.length && !sections.length) return null
  }

  return {
    companies: r.companies || [],
    tutanaklar: r.tutanaklar || [],
    alet: { items: r.aletItems || [] },
    saha: {
      bg: (r.sahaSettings && r.sahaSettings.bg) || null,
      bgName: (r.sahaSettings && r.sahaSettings.bgName) || '',
      panels: r.sahaPanels || [],
      lines: r.sahaLines || [],
      sockets: r.sahaSockets || [],
    },
    rapor: {
      entries: r.raporEntries || [],
      ekipler,
      meta: {},
    },
    gecici: {
      lib: r.geciciLib || [],
      moves: r.geciciMoves || [],
      orders: r.geciciOrders || [],
    },
    proje: {
      buildings,
      // bolumler VERIDIR: bos liste bos kalir, varsayilan bolum dayatilmaz
      // (kullanici "Bolum Ekle" ile veya Excel iceri aktarimiyla doldurur)
      sections,
      sartnames: r.projeSartnames || [],
      materials: r.projeMaterials || [],
      specs: r.projeSpecs || [],
      items: r.projeItems || [],
      orders: r.projeOrders || [],
      alternatives: r.projeAlternatives || [],
      binaModelleri: r.projeBinaModelleri || [],
      lokasyonlar: r.projeLokasyonlar || [],
    },
    meta: {
      ...settingsMap,
      created: settingsMap.created || Date.now(),
      updated: Date.now(),
      seeded: true,
      tavaSeed: settingsMap.tavaSeed || false,
      tavaSeedV: settingsMap.tavaSeedV != null ? settingsMap.tavaSeedV : 4,
      specWipeV: settingsMap.specWipeV != null ? settingsMap.specWipeV : 1,
      matLibV: settingsMap.matLibV != null ? settingsMap.matLibV : 1,
      audit: auditEntries,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage'dan Supabase'e tek seferlik migrasyon
// ─────────────────────────────────────────────────────────────────────────────

export async function sbMigrateLocalDB(localDB) {
  // her op bir {label, promise} - hangi tablonun basarisiz oldugunu gorebilmek icin.
  // Eskiden Promise.allSettled sonucu hic kontrol edilmiyordu: buyuk payload'lu
  // (ornegin gomulu PDF/foto tasiyan proje_items) bir tablo sessizce basarisiz
  // olsa bile fonksiyon "basarili" donuyor, restore ekrani hata gostermiyordu.
  const ops = []
  const push = (label, promise) => ops.push({ label, promise })

  if (localDB.alet?.items?.length)
    push('El Aletleri', sbInsertEntities('alet_items', localDB.alet.items))
  if (localDB.saha?.panels?.length)
    push('Saha Panolari', sbInsertEntities('saha_panels', localDB.saha.panels))
  if (localDB.saha?.lines?.length)
    push('Saha Hatlari', sbInsertEntities('saha_lines', localDB.saha.lines))
  if (localDB.saha?.sockets?.length)
    push('Saha Prizleri', sbInsertEntities('saha_sockets', localDB.saha.sockets))
  if (localDB.saha?.bg) {
    push('Saha Plani Arka Plani', sbSetSahaSetting('bg', localDB.saha.bg))
    push('Saha Plani Dosya Adi', sbSetSahaSetting('bgName', localDB.saha.bgName || ''))
  }
  if (localDB.rapor?.entries?.length)
    push('Saha Raporu Kayitlari', sbInsertEntities('rapor_entries', localDB.rapor.entries))
  if (localDB.rapor?.ekipler?.length)
    push('Ekipler', sbInsertRaporEkipler(localDB.rapor.ekipler))
  if (localDB.tutanaklar?.length)
    push('Tutanaklar', sbInsertEntities('tutanaklar', localDB.tutanaklar))
  if (localDB.gecici?.lib?.length)
    push('Gecici Elektrik Kutuphanesi', sbInsertEntities('gecici_lib', localDB.gecici.lib))
  if (localDB.gecici?.moves?.length)
    push('Gecici Elektrik Hareketleri', sbInsertEntities('gecici_moves', localDB.gecici.moves))
  if (localDB.gecici?.orders?.length)
    push('Gecici Elektrik Siparisleri', sbInsertEntities('gecici_orders', localDB.gecici.orders))
  if (localDB.proje?.buildings?.length)
    push('Binalar', sbInsertProjeBuildings(localDB.proje.buildings))
  if (localDB.proje?.sections?.length)
    push('Bolumler', sbInsertProjeSections(localDB.proje.sections))
  if (localDB.proje?.sartnames?.length)
    push('Sartname Tanimlari', sbInsertEntities('proje_sartnames', localDB.proje.sartnames))
  if (localDB.proje?.materials?.length)
    push('Malzeme Kutuphanesi', sbInsertEntities('proje_materials', localDB.proje.materials))
  if (localDB.proje?.specs?.length)
    push('Spesifikasyon Kalemleri', sbInsertEntities('proje_specs', localDB.proje.specs))
  if (localDB.proje?.items?.length)
    push('Alim/Hareket Kayitlari', sbInsertEntities('proje_items', localDB.proje.items))
  if (localDB.proje?.orders?.length)
    push('Siparisler', sbInsertEntities('proje_orders', localDB.proje.orders))
  if (localDB.proje?.binaModelleri?.length)
    push('3D Bina Modelleri', sbInsertEntities('proje_bina_modelleri', localDB.proje.binaModelleri))
  if (localDB.proje?.alternatives?.length)
    push('Alternatif Urunler', sbInsertEntities('proje_alternatives', localDB.proje.alternatives))
  if (localDB.proje?.lokasyonlar?.length)
    push('Lokasyonlar', sbInsertEntities('proje_lokasyonlar', localDB.proje.lokasyonlar))
  if (localDB.companies?.length)
    push('Sirketler', sbInsertEntities('companies', localDB.companies))
  if (localDB.meta?.audit?.length)
    push('Denetim Kaydi', (async () => {
      // audit girdileri id tasimaz; bayt/satir sinirina gore parcalanarak yazilir
      for (const chunk of bayaGoreParcala(localDB.meta.audit)) {
        await veri({ op: 'insert', table: 'audit_log', rows: chunk.map(entry => ({ data: entry })) })
      }
    })())

  // meta ayarlarinin TAMAMI geri yazilir (binaGiris, migration flag'leri vb.) -
  // audit ayri tabloya gider, updated/seeded/_partial calisma-ani degerleridir
  const meta = localDB.meta || {}
  const SKIP_META = new Set(['audit', 'updated', 'seeded', '_partial'])
  Object.keys(meta).forEach(k => {
    if (!SKIP_META.has(k) && meta[k] !== undefined) push('Ayar: ' + k, sbSetSetting(k, meta[k]))
  })
  push('Ayar: created', sbSetSetting('created', meta.created || Date.now()))
  push('Ayar: tavaSeedV', sbSetSetting('tavaSeedV', meta.tavaSeedV != null ? meta.tavaSeedV : 4))
  push('Ayar: specWipeV', sbSetSetting('specWipeV', meta.specWipeV != null ? meta.specWipeV : 1))
  push('Ayar: matLibV', sbSetSetting('matLibV', meta.matLibV != null ? meta.matLibV : 1))

  const results = await Promise.allSettled(ops.map(o => o.promise))
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? { label: ops[i].label, error: r.reason?.message || String(r.reason) } : null))
    .filter(Boolean)
  if (failed.length) {
    const err = new Error(failed.map(f => f.label + ': ' + f.error).join(' · '))
    err.failedTables = failed
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tüm veriyi sil (wipeAllData ve factoryImport için)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbWipeAllData() {
  const textIdTables = [
    'proje_materials', 'proje_specs', 'proje_items', 'proje_orders', 'proje_sartnames',
    'proje_bina_modelleri', 'proje_lokasyonlar', 'proje_alternatives', 'companies',
    'alet_items', 'saha_panels', 'saha_lines', 'saha_sockets',
    'rapor_entries', 'tutanaklar', 'gecici_lib', 'gecici_moves', 'gecici_orders',
  ]
  await Promise.allSettled([
    ...textIdTables.map(t => sbDeleteAll(t)),
    sbDeleteAll('rapor_ekipler'),
    sbDeleteAll('proje_buildings'),
    sbDeleteAll('proje_sections'),
    sbDeleteAll('saha_settings'),
    // audit_log ve app_settings silinmez
  ])
}

// Sadece proje tablolarını sil (wipe işlemi audit log'u korur)
export async function sbWipeProjeData() {
  await Promise.allSettled([
    sbDeleteAll('proje_materials'),
    sbDeleteAll('proje_specs'),
    sbDeleteAll('proje_items'),
    sbDeleteAll('proje_orders'),
    sbDeleteAll('proje_sartnames'),
    sbDeleteAll('proje_bina_modelleri'),
    sbDeleteAll('proje_lokasyonlar'),
    sbDeleteAll('proje_buildings'),
    sbDeleteAll('proje_sections'),
  ])
}

// Proje verisinin her basligini ayri ayri temizleyebilmek icin ince kirinim ─

// Bina ve bolum listesini TAMAMEN sil (3D modeller ve lokasyon kirilimi dahil).
// Bolumler de veridir: temizlik sonrasi liste bos kalir, varsayilan bolum geri gelmez.
export async function sbWipeProjeBinaData() {
  await Promise.allSettled([
    sbDeleteAll('proje_bina_modelleri'),
    sbDeleteAll('proje_lokasyonlar'),
    sbDeleteAll('proje_buildings'),
    sbDeleteAll('proje_sections'),
  ])
}

// Sadece sirket listesini sil
export async function sbWipeCompaniesData() {
  await sbDeleteAll('companies')
}

// Sadece sartname (Bolum & Sartname) tanimlarini sil
export async function sbWipeProjeSartnameData() {
  await sbDeleteAll('proje_sartnames')
}

// Sadece spesifikasyon kalemlerini sil
export async function sbWipeProjeSpecData() {
  await sbDeleteAll('proje_specs')
}

// Sadece malzeme kutuphanesini sil
export async function sbWipeProjeMalzemeData() {
  await sbDeleteAll('proje_materials')
}

// Sadece siparis ve hareket (stok giris/cikis) kayitlarini sil
export async function sbWipeProjeSiparisData() {
  await Promise.allSettled([
    sbDeleteAll('proje_items'),
    sbDeleteAll('proje_orders'),
  ])
}

// Sadece el aletleri verisini sil
export async function sbWipeAletData() {
  await sbDeleteAll('alet_items')
}

// Sadece santiye sahasi verisini sil
export async function sbWipeSahaData() {
  await Promise.allSettled([
    sbDeleteAll('saha_panels'),
    sbDeleteAll('saha_lines'),
    sbDeleteAll('saha_sockets'),
    sbDeleteAll('saha_settings'),
  ])
}

// Sadece gecici elektrik ambari verisini sil
export async function sbWipeGeciciData() {
  await Promise.allSettled([
    sbDeleteAll('gecici_lib'),
    sbDeleteAll('gecici_moves'),
    sbDeleteAll('gecici_orders'),
  ])
}

// Sadece saha raporu verisini sil
export async function sbWipeRaporData() {
  await Promise.allSettled([
    sbDeleteAll('rapor_entries'),
    sbDeleteAll('rapor_ekipler'),
  ])
}
