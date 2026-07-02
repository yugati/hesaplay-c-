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
// Users (mevcut fonksiyonlar – değişmedi)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeUsersError(error) {
  if (!error) return null
  if (error.code === 'PGRST205') {
    return new Error(
      [
        "Supabase Data API cannot see 'public.users'.",
        'The client URL/key are reaching Supabase successfully, but PostgREST schema cache does not contain that table.',
        'This is a Supabase-side issue, not a frontend query bug.'
      ].join(' ')
    )
  }
  return error
}

async function usersQuery(builder) {
  const { data, error } = await builder
  const normalizedError = normalizeUsersError(error)
  if (normalizedError) throw normalizedError
  return data
}

export async function sbLoginUser(username, password) {
  return (
    (await usersQuery(
      supabase
        .from('users')
        .select('*')
        .ilike('username', username)
        .eq('password', password)
        .maybeSingle()
    )) || null
  )
}

export async function sbGetUserByUsername(username) {
  return (
    (await usersQuery(
      supabase
        .from('users')
        .select('*')
        .ilike('username', username)
        .maybeSingle()
    )) || null
  )
}

export async function sbGetAllUsers() {
  return (
    (await usersQuery(
      supabase.from('users').select('*').order('created_at', { ascending: true })
    )) || []
  )
}

export async function sbCreateUser({ username, password, role, sections, buildings, permissions }) {
  return usersQuery(
    supabase
      .from('users')
      .insert([{ username, password, role, sections, buildings, permissions: permissions || {} }])
      .select()
      .single()
  )
}

export async function sbUpdateUser(id, { password, role, sections, buildings, permissions }) {
  const update = { password, role, sections, buildings }
  if (permissions !== undefined) update.permissions = permissions
  return usersQuery(
    supabase
      .from('users')
      .update(update)
      .eq('id', id)
      .select()
      .single()
  )
}

export async function sbDeleteUser(id) {
  await usersQuery(supabase.from('users').delete().eq('id', id))
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

// Tablodaki tüm satırları entity dizisi olarak döndürür
async function sbGetAll(table) {
  const rows = await sbRun(
    supabase.from(table).select('id, data').order('created_at', { ascending: true })
  )
  return (rows || []).map(r => ({ ...r.data, id: r.id }))
}

async function sbInsertEntity(table, entity) {
  await sbRun(supabase.from(table).insert([{ id: entity.id, data: entity }]))
}

async function sbInsertEntities(table, entities) {
  if (!entities || !entities.length) return
  const chunks = []
  for (let i = 0; i < entities.length; i += 500) chunks.push(entities.slice(i, i + 500))
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
export async function sbDeleteProjeOrder(id) { return sbDeleteEntity('proje_orders', id) }

// ─────────────────────────────────────────────────────────────────────────────
// Alternatif Ürün modülü
// ─────────────────────────────────────────────────────────────────────────────

export async function sbGetProjeAlternatives() { return sbGetAll('proje_alternatives') }
export async function sbInsertProjeAlternative(e) { return sbInsertEntity('proje_alternatives', e) }
export async function sbUpdateProjeAlternative(id, e) { return sbUpdateEntity('proje_alternatives', id, e) }
export async function sbDeleteProjeAlternative(id) { return sbDeleteEntity('proje_alternatives', id) }

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

export async function sbLoadAllData() {
  const [
    aletItems,
    sahaPanels, sahaLines, sahaSockets, sahaSettings,
    raporEntries, raporEkiplerRes,
    geciciLib, geciciMoves, geciciOrders,
    projeBuildingsRes, projeSectionsRes, projeSartnames,
    projeMaterials, projeSpecs, projeItems, projeOrders,
    projeAlternatives,
    auditRes, settingsRes,
  ] = await Promise.all([
    sbGetAll('alet_items'),
    sbGetAll('saha_panels'),
    sbGetAll('saha_lines'),
    sbGetAll('saha_sockets'),
    sbGetAllSahaSettings(),
    sbGetAll('rapor_entries'),
    supabase.from('rapor_ekipler').select('name').order('created_at', { ascending: true }),
    sbGetAll('gecici_lib'),
    sbGetAll('gecici_moves'),
    sbGetAll('gecici_orders'),
    supabase.from('proje_buildings').select('code').order('sort_order, created_at', { ascending: true }),
    supabase.from('proje_sections').select('name').order('sort_order, created_at', { ascending: true }),
    sbGetAll('proje_sartnames'),
    sbGetAll('proje_materials'),
    sbGetAll('proje_specs'),
    sbGetAll('proje_items'),
    sbGetAll('proje_orders'),
    sbGetAll('proje_alternatives'),
    supabase.from('audit_log').select('data').order('created_at', { ascending: true }).limit(2000),
    supabase.from('app_settings').select('key, value'),
  ])

  const ekipler = (raporEkiplerRes.data || []).map(r => r.name)
  const buildings = (projeBuildingsRes.data || []).map(r => r.code)
  const sections = (projeSectionsRes.data || []).map(r => r.name)
  const auditEntries = (auditRes.data || []).map(r => r.data)
  const settingsMap = {}
  ;(settingsRes.data || []).forEach(s => { settingsMap[s.key] = s.value })

  // Supabase boşsa null döndür → localStorage migration tetiklenecek
  const hasData = !!(
    aletItems.length || sahaPanels.length || geciciLib.length ||
    projeItems.length || projeSpecs.length || projeMaterials.length ||
    raporEntries.length || projeOrders.length
  )
  if (!hasData && !buildings.length && !sections.length) return null

  return {
    alet: { items: aletItems },
    saha: {
      bg: sahaSettings.bg || null,
      bgName: sahaSettings.bgName || '',
      panels: sahaPanels,
      lines: sahaLines,
      sockets: sahaSockets,
    },
    rapor: {
      entries: raporEntries,
      ekipler,
      meta: {},
    },
    gecici: {
      lib: geciciLib,
      moves: geciciMoves,
      orders: geciciOrders,
    },
    proje: {
      buildings,
      sections: sections.length ? sections : ['Tava', 'Aydinlatma', 'Topraklama', 'Pano', 'Kablolama'],
      sartnames: projeSartnames,
      materials: projeMaterials,
      specs: projeSpecs,
      items: projeItems,
      orders: projeOrders,
      alternatives: projeAlternatives,
    },
    meta: {
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
  const ops = []

  if (localDB.alet?.items?.length)
    ops.push(sbInsertEntities('alet_items', localDB.alet.items))
  if (localDB.saha?.panels?.length)
    ops.push(sbInsertEntities('saha_panels', localDB.saha.panels))
  if (localDB.saha?.lines?.length)
    ops.push(sbInsertEntities('saha_lines', localDB.saha.lines))
  if (localDB.saha?.sockets?.length)
    ops.push(sbInsertEntities('saha_sockets', localDB.saha.sockets))
  if (localDB.saha?.bg)
    ops.push(
      sbSetSahaSetting('bg', localDB.saha.bg),
      sbSetSahaSetting('bgName', localDB.saha.bgName || '')
    )
  if (localDB.rapor?.entries?.length)
    ops.push(sbInsertEntities('rapor_entries', localDB.rapor.entries))
  if (localDB.rapor?.ekipler?.length)
    ops.push(sbInsertRaporEkipler(localDB.rapor.ekipler))
  if (localDB.gecici?.lib?.length)
    ops.push(sbInsertEntities('gecici_lib', localDB.gecici.lib))
  if (localDB.gecici?.moves?.length)
    ops.push(sbInsertEntities('gecici_moves', localDB.gecici.moves))
  if (localDB.gecici?.orders?.length)
    ops.push(sbInsertEntities('gecici_orders', localDB.gecici.orders))
  if (localDB.proje?.buildings?.length)
    ops.push(sbInsertProjeBuildings(localDB.proje.buildings))
  if (localDB.proje?.sections?.length)
    ops.push(sbInsertProjeSections(localDB.proje.sections))
  if (localDB.proje?.sartnames?.length)
    ops.push(sbInsertEntities('proje_sartnames', localDB.proje.sartnames))
  if (localDB.proje?.materials?.length)
    ops.push(sbInsertEntities('proje_materials', localDB.proje.materials))
  if (localDB.proje?.specs?.length)
    ops.push(sbInsertEntities('proje_specs', localDB.proje.specs))
  if (localDB.proje?.items?.length)
    ops.push(sbInsertEntities('proje_items', localDB.proje.items))
  if (localDB.proje?.orders?.length)
    ops.push(sbInsertEntities('proje_orders', localDB.proje.orders))
  if (localDB.meta?.audit?.length)
    ops.push(
      supabase.from('audit_log').insert(
        localDB.meta.audit.map(entry => ({ data: entry }))
      ).then(() => {})
    )

  const meta = localDB.meta || {}
  ops.push(
    sbSetSetting('created', meta.created || Date.now()),
    sbSetSetting('tavaSeedV', meta.tavaSeedV || 4),
    sbSetSetting('specWipeV', meta.specWipeV || 1),
    sbSetSetting('matLibV', meta.matLibV || 1),
  )

  await Promise.allSettled(ops)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tüm veriyi sil (wipeAllData ve factoryImport için)
// ─────────────────────────────────────────────────────────────────────────────

export async function sbWipeAllData() {
  const textIdTables = [
    'proje_materials', 'proje_specs', 'proje_items', 'proje_orders', 'proje_sartnames',
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
    supabase.from('proje_buildings').delete().gte('created_at', '2000-01-01T00:00:00Z'),
    supabase.from('proje_sections').delete().gte('created_at', '2000-01-01T00:00:00Z'),
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
