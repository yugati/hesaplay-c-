import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in the Vite environment.'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

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
export async function sbGetUserByUsername() {
  try {
    const { user } = await authFetch('/api/me')
    return user || null
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

async function sbRun(builder) {
  const { data, error } = await builder
  if (error) throw error
  return data
}

// Tablodaki tüm satırları entity dizisi olarak döndürür.
// Sayfalı (chunked) okunur: bazı satırlar (ör. PDF gömülü eski kayıtlar) çok
// büyük olabiliyor; tek seferde SELECT * atmak Postgres statement_timeout'una
// takılıp TÜM girişi kilitleyebiliyordu ("canceling statement due to statement
// timeout"). Sayfa başına zaman aşımı olursa sayfa küçültülüp aynı aralık
// tekrar denenir - toplam veri boyutundan bağımsız olarak yükleme tamamlanır.
const SB_TIMEOUT_CODES = new Set(['57014', '54000'])
async function sbGetAll(table) {
  const all = []
  let from = 0
  let pageSize = 25
  while (true) {
    let rows
    try {
      rows = await sbRun(
        supabase.from(table).select('id, data').order('created_at', { ascending: true }).range(from, from + pageSize - 1)
      )
    } catch (e) {
      if (pageSize > 1 && e && SB_TIMEOUT_CODES.has(e.code)) {
        pageSize = Math.max(1, Math.floor(pageSize / 5))
        continue
      }
      throw e
    }
    if (!rows || !rows.length) break
    all.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return all.map(r => ({ ...r.data, id: r.id }))
}

async function sbInsertEntity(table, entity) {
  await sbRun(supabase.from(table).insert([{ id: entity.id, data: entity }]))
}

// Satir sayisinin yaninda TOPLAM BAYT boyutuna gore de parcalar: gomulu foto/PDF
// tasiyan kayitlar (ornegin proje_items) tek satirda birkac MB olabiliyor, 500
// satirlik sabit blok bu durumda tek istekte onlarca MB'a cikip sessizce
// basarisiz oluyordu (restore sirasinda hicbir hata gorunmeden kayit kaybi).
async function sbInsertEntities(table, entities) {
  if (!entities || !entities.length) return
  const MAX_ROWS = 500
  const MAX_BYTES = 3 * 1024 * 1024
  const chunks = []
  let cur = [], curBytes = 0
  for (const e of entities) {
    const size = JSON.stringify(e).length
    if (cur.length && (cur.length >= MAX_ROWS || curBytes + size > MAX_BYTES)) {
      chunks.push(cur); cur = []; curBytes = 0
    }
    cur.push(e); curBytes += size
  }
  if (cur.length) chunks.push(cur)
  for (const chunk of chunks) {
    await sbRun(supabase.from(table).insert(chunk.map(e => ({ id: e.id, data: e }))))
  }
}

async function sbUpdateEntity(table, id, entity) {
  await sbRun(supabase.from(table).update({ data: entity }).eq('id', id))
}

async function sbDeleteEntity(table, id) {
  await sbRun(supabase.from(table).delete().eq('id', id))
}

async function sbDeleteAll(table) {
  await sbRun(supabase.from(table).delete().gte('created_at', '2000-01-01T00:00:00Z'))
}

// ─────────────────────────────────────────────────────────────────────────────
// Uygulama ayarları (migration flags, meta)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetSetting(key) {
  const row = await sbRun(
    supabase.from('app_settings').select('value').eq('key', key).maybeSingle()
  )
  return row ? row.value : null
}

export async function sbSetSetting(key, value) {
  await sbRun(
    supabase.from('app_settings').upsert([{ key, value }], { onConflict: 'key' })
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Denetim kaydı (Audit log)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbInsertAuditLog(entry) {
  try {
    await sbRun(supabase.from('audit_log').insert([{ data: entry }]))
  } catch (e) {
    console.warn('Audit log yazılamadı:', e)
  }
}

export async function sbGetAuditLog() {
  const rows = await sbRun(
    supabase.from('audit_log').select('data').order('created_at', { ascending: false }).limit(2000)
  )
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
  const rows = await sbRun(supabase.from('saha_settings').select('key, value'))
  const map = {}
  ;(rows || []).forEach(r => { map[r.key] = r.value })
  return map
}

export async function sbSetSahaSetting(key, value) {
  await sbRun(
    supabase.from('saha_settings').upsert([{ key, value }], { onConflict: 'key' })
  )
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
  const rows = await sbRun(
    supabase.from('rapor_ekipler').select('name').order('created_at', { ascending: true })
  )
  return (rows || []).map(r => r.name)
}

export async function sbInsertRaporEkip(name) {
  const { error } = await supabase.from('rapor_ekipler').upsert([{ name }], { onConflict: 'name' })
  if (error) console.warn('Ekip eklenemedi:', error)
}

export async function sbInsertRaporEkipler(names) {
  for (const name of names) {
    const { error } = await supabase.from('rapor_ekipler').upsert([{ name }], { onConflict: 'name' })
    if (error) console.warn('Ekip eklenemedi:', name, error)
  }
}

export async function sbDeleteRaporEkip(name) {
  await sbRun(supabase.from('rapor_ekipler').delete().eq('name', name))
}

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

export async function sbGetProjeBuildings() {
  const rows = await sbRun(
    supabase.from('proje_buildings').select('code').order('sort_order, created_at', { ascending: true })
  )
  return (rows || []).map(r => r.code)
}

export async function sbInsertProjeBuilding(code) {
  const { error } = await supabase.from('proje_buildings').insert([{ code }])
  if (error && error.code !== '23505') throw error
}

export async function sbInsertProjeBuildings(codes) {
  if (!codes || !codes.length) return
  for (let i = 0; i < codes.length; i++) {
    const { error } = await supabase.from('proje_buildings').insert([{ code: codes[i], sort_order: i }])
    if (error && error.code !== '23505') console.warn('Bina eklenemedi:', codes[i])
  }
}

export async function sbDeleteProjeBuilding(code) {
  await sbRun(supabase.from('proje_buildings').delete().eq('code', code))
}

// code kolonu binanin kendisi (ayri id yok) - yeniden adlandirma satiri silmez, sort_order/created_at korunur
export async function sbRenameProjeBuilding(oldCode, newCode) {
  await sbRun(supabase.from('proje_buildings').update({ code: newCode }).eq('code', oldCode))
}

export async function sbGetProjeSections() {
  const rows = await sbRun(
    supabase.from('proje_sections').select('name').order('sort_order, created_at', { ascending: true })
  )
  return (rows || []).map(r => r.name)
}

export async function sbInsertProjeSection(name, sortOrder = 0) {
  const { error } = await supabase.from('proje_sections').insert([{ name, sort_order: sortOrder }])
  if (error && error.code !== '23505') throw error
}

export async function sbInsertProjeSections(names) {
  if (!names || !names.length) return
  for (let i = 0; i < names.length; i++) {
    const { error } = await supabase.from('proje_sections').insert([{ name: names[i], sort_order: i }])
    if (error && error.code !== '23505') console.warn('Bölüm eklenemedi:', names[i])
  }
}

export async function sbDeleteProjeSection(name) {
  await sbRun(supabase.from('proje_sections').delete().eq('name', name))
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
  await sbRun(supabase.from('proje_lokasyonlar').delete().in('id', ids))
}

// ─────────────────────────────────────────────────────────────────────────────
// Bina 3D Modelleri (glTF/.glb) - Supabase Storage + JSONB referans tablosu
// ─────────────────────────────────────────────────────────────────────────────

const BINA_MODEL_BUCKET = 'bina-modelleri'

export async function sbGetProjeBinaModelleri() { return sbGetAll('proje_bina_modelleri') }
export async function sbInsertProjeBinaModel(e) { return sbInsertEntity('proje_bina_modelleri', e) }
export async function sbUpdateProjeBinaModel(id, e) { return sbUpdateEntity('proje_bina_modelleri', id, e) }
export async function sbDeleteProjeBinaModel(id) { return sbDeleteEntity('proje_bina_modelleri', id) }

// Dosyayı bucket'a yükler ve genel-erişim URL'sini döndürür.
export async function sbUploadBinaModelFile(bina, file) {
  const ext = (file.name.split('.').pop() || 'glb').toLowerCase()
  const path = `${bina}/${Date.now()}_${uid8()}.${ext}`
  const { error } = await supabase.storage.from(BINA_MODEL_BUCKET).upload(path, file, {
    cacheControl: '31536000',
    upsert: false,
    contentType: file.type || 'model/gltf-binary',
  })
  if (error) throw error
  const { data } = supabase.storage.from(BINA_MODEL_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}

export async function sbDeleteBinaModelFile(path) {
  if (!path) return
  await supabase.storage.from(BINA_MODEL_BUCKET).remove([path])
}

function uid8() {
  return Math.random().toString(36).slice(2, 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert (import / sync sonrası toplu güncelleme)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbUpsertProjeMaterials(items) {
  if (!items || !items.length) return
  const chunks = []
  for (let i = 0; i < items.length; i += 500) chunks.push(items.slice(i, i + 500))
  for (const chunk of chunks) {
    await sbRun(
      supabase.from('proje_materials').upsert(chunk.map(m => ({ id: m.id, data: m })), { onConflict: 'id' })
    )
  }
}

export async function sbUpsertProjeSpecs(items) {
  if (!items || !items.length) return
  const chunks = []
  for (let i = 0; i < items.length; i += 500) chunks.push(items.slice(i, i + 500))
  for (const chunk of chunks) {
    await sbRun(
      supabase.from('proje_specs').upsert(chunk.map(s => ({ id: s.id, data: s })), { onConflict: 'id' })
    )
  }
}

export async function sbUpsertProjeItems(items) {
  if (!items || !items.length) return
  const chunks = []
  for (let i = 0; i < items.length; i += 500) chunks.push(items.slice(i, i + 500))
  for (const chunk of chunks) {
    await sbRun(
      supabase.from('proje_items').upsert(chunk.map(it => ({ id: it.id, data: it })), { onConflict: 'id' })
    )
  }
}

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
  const needProjeFull = need('proje')
  const needCompanies = need('proje') || need('tanimlar')

  const tasks = { settingsRes: supabase.from('app_settings').select('key, value') }
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
    tasks.raporEkiplerRes = supabase.from('rapor_ekipler').select('name').order('created_at', { ascending: true })
  }
  if (needProjeCore) {
    tasks.projeBuildingsRes = supabase.from('proje_buildings').select('code').order('sort_order, created_at', { ascending: true })
    tasks.projeSectionsRes = supabase.from('proje_sections').select('name').order('sort_order, created_at', { ascending: true })
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
  if (!scope) tasks.auditRes = supabase.from('audit_log').select('data').order('created_at', { ascending: true }).limit(2000)

  const keys = Object.keys(tasks)
  const results = await Promise.all(keys.map(k => tasks[k]))
  const r = {}
  keys.forEach((k, i) => { r[k] = results[i] })

  const ekipler = r.raporEkiplerRes ? (r.raporEkiplerRes.data || []).map(x => x.name) : []
  const buildings = r.projeBuildingsRes ? (r.projeBuildingsRes.data || []).map(x => x.code) : []
  const sections = r.projeSectionsRes ? (r.projeSectionsRes.data || []).map(x => x.name) : []
  const auditEntries = r.auditRes ? (r.auditRes.data || []).map(x => x.data) : []
  const settingsMap = {}
  ;(r.settingsRes.data || []).forEach(s => { settingsMap[s.key] = s.value })

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
    push('Denetim Kaydi', supabase.from('audit_log').insert(
      localDB.meta.audit.map(entry => ({ data: entry }))
    ).then(() => {}))

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
    'rapor_entries', 'gecici_lib', 'gecici_moves', 'gecici_orders',
  ]
  await Promise.allSettled([
    ...textIdTables.map(t => sbDeleteAll(t)),
    supabase.from('rapor_ekipler').delete().gte('created_at', '2000-01-01T00:00:00Z'),
    supabase.from('proje_buildings').delete().gte('created_at', '2000-01-01T00:00:00Z'),
    supabase.from('proje_sections').delete().gte('created_at', '2000-01-01T00:00:00Z'),
    supabase.from('saha_settings').delete().gte('created_at', '2000-01-01T00:00:00Z'),
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
    supabase.from('proje_buildings').delete().gte('created_at', '2000-01-01T00:00:00Z'),
    supabase.from('proje_sections').delete().gte('created_at', '2000-01-01T00:00:00Z'),
  ])
}

// Proje verisinin her basligini ayri ayri temizleyebilmek icin ince kirinim ─

// Bina ve bolum listesini TAMAMEN sil (3D modeller ve lokasyon kirilimi dahil).
// Bolumler de veridir: temizlik sonrasi liste bos kalir, varsayilan bolum geri gelmez.
export async function sbWipeProjeBinaData() {
  await Promise.allSettled([
    sbDeleteAll('proje_bina_modelleri'),
    sbDeleteAll('proje_lokasyonlar'),
    supabase.from('proje_buildings').delete().gte('created_at', '2000-01-01T00:00:00Z'),
    supabase.from('proje_sections').delete().gte('created_at', '2000-01-01T00:00:00Z'),
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
    supabase.from('saha_settings').delete().gte('created_at', '2000-01-01T00:00:00Z'),
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
    supabase.from('rapor_ekipler').delete().gte('created_at', '2000-01-01T00:00:00Z'),
  ])
}
