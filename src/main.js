// ═══════════════════════════════════════════════════════════════════════
// Vite entry point
// Supabase fonksiyonlarını global (window) scope'a açar.
// HTML'deki inline onclick/kod bloklarının erişebilmesi için gerekli.
// ═══════════════════════════════════════════════════════════════════════
import * as XLSX from 'xlsx'
import { initBinaViewer } from './bina3d.js'
import {
  // Users
  sbLoginUser,
  sbGetUserByUsername,
  sbGetAllUsers,
  sbCreateUser,
  sbUpdateUser,
  sbDeleteUser,
  // Core
  sbLoadAllData,
  sbMigrateLocalDB,
  sbWipeAllData,
  sbWipeProjeData,
  sbWipeProjeBinaData,
  sbWipeProjeSartnameData,
  sbWipeProjeSpecData,
  sbWipeProjeMalzemeData,
  sbWipeProjeSiparisData,
  sbWipeCompaniesData,
  sbWipeAletData,
  sbWipeSahaData,
  sbWipeGeciciData,
  sbWipeRaporData,
  sbWipeTutanakData,
  // Settings & Audit
  sbOnbellekTemizle,
  sbGetSetting,
  sbSetSetting,
  sbInsertAuditLog,
  sbGetAuditLog,
  // Alet
  sbGetAletItems,
  sbInsertAletItem,
  sbInsertAletItems,
  sbUpdateAletItem,
  sbDeleteAletItem,
  // Saha
  sbGetSahaPanels,
  sbInsertSahaPanel,
  sbUpdateSahaPanel,
  sbDeleteSahaPanel,
  sbGetSahaLines,
  sbInsertSahaLine,
  sbDeleteSahaLine,
  sbGetSahaSockets,
  sbInsertSahaSocket,
  sbUpdateSahaSocket,
  sbDeleteSahaSocket,
  sbGetAllSahaSettings,
  sbSetSahaSetting,
  // Rapor
  sbGetRaporEntries,
  sbInsertRaporEntry,
  sbInsertRaporEntries,
  sbUpdateRaporEntry,
  sbDeleteRaporEntry,
  sbDeleteRaporEntriesByIds,
  sbGetRaporEkipler,
  sbInsertRaporEkip,
  sbInsertRaporEkipler,
  sbDeleteRaporEkip,
  // Tutanak
  sbGetTutanaklar,
  sbInsertTutanak,
  sbUpdateTutanak,
  sbDeleteTutanak,
  // Gecici
  sbGetGeciciLib,
  sbInsertGeciciLibItem,
  sbInsertGeciciLibItems,
  sbUpdateGeciciLibItem,
  sbDeleteGeciciLibItem,
  sbGetGeciciMoves,
  sbInsertGeciciMove,
  sbInsertGeciciMoves,
  sbDeleteGeciciMove,
  sbDeleteGeciciMovesByIds,
  sbGetGeciciOrders,
  sbInsertGeciciOrder,
  sbInsertGeciciOrders,
  sbDeleteGeciciOrder,
  // Proje
  sbGetProjeBuildings,
  sbInsertProjeBuilding,
  sbInsertProjeBuildings,
  sbDeleteProjeBuilding,
  sbRenameProjeBuilding,
  sbGetProjeSections,
  sbInsertProjeSection,
  sbInsertProjeSections,
  sbDeleteProjeSection,
  sbGetProjeSartnames,
  sbInsertProjeSartname,
  sbInsertProjeSartnames,
  sbUpdateProjeSartname,
  sbDeleteProjeSartname,
  sbGetProjeMaterials,
  sbInsertProjeMaterial,
  sbInsertProjeMaterials,
  sbUpdateProjeMaterial,
  sbDeleteProjeMaterial,
  sbDeleteProjeMaterials,
  sbGetProjeSpecs,
  sbInsertProjeSpec,
  sbInsertProjeSpecs,
  sbUpdateProjeSpec,
  sbDeleteProjeSpec,
  sbDeleteProjeSpecs,
  sbGetProjeItems,
  sbInsertProjeItem,
  sbInsertProjeItems,
  sbUpdateProjeItem,
  sbDeleteProjeItem,
  sbDeleteProjeItems,
  sbGetProjeOrders,
  sbInsertProjeOrder,
  sbInsertProjeOrders,
  sbUpdateProjeOrder,
  sbDeleteProjeOrder,
  sbUpsertProjeMaterials,
  sbUpsertProjeSpecs,
  sbUpsertProjeItems,
  sbGetProjeAlternatives,
  sbInsertProjeAlternative,
  sbUpdateProjeAlternative,
  sbDeleteProjeAlternative,
  // Bina 3D Modelleri
  sbGetProjeBinaModelleri,
  sbInsertProjeBinaModel,
  sbUpdateProjeBinaModel,
  sbDeleteProjeBinaModel,
  sbUploadBinaModelFile,
  sbDeleteBinaModelFile,
  sbBelgeUrl,
  sbBelgeYukle,
  sbBelgeSil,
  // Parcali giris: lokasyon kirilim agaci
  sbInsertProjeLokasyon,
  sbUpdateProjeLokasyon,
  sbDeleteProjeLokasyonlar,
  // Sirketler
  sbGetCompanies,
  sbInsertCompany,
  sbUpdateCompany,
  sbDeleteCompany,
} from './supabase.js'

// xlsx global
window.XLSX = XLSX

// Supabase hataları için güvenli sarmalayıcı:
// fn hata fırlatsa bile çağıran kod devam eder (closeModal/render/toast çalışır).
// Hata görünür bir toast olarak gösterilir.
function safe(fn) {
  return async function (...args) {
    try {
      return await fn.apply(this, args)
    } catch (e) {
      const msg = e?.message || e?.code || 'Bağlantı sorunu'
      console.error('Supabase hatası:', msg, e)
      if (typeof window !== 'undefined' && window.toast) {
        window.toast('⚠ Supabase: ' + msg, 'err')
      }
    }
  }
}

// ─── Backend Yetki Kontrolü ───────────────────────────────────────────────────
// window.CURRENT_USER üzerinden çalışır; frontend izin sistemiyle senkron.
function _permCheck(module, action) {
  const user = window.CURRENT_USER
  if (!user) throw new Error('Oturum açılmamış')
  if (user.role === 'admin') return
  // izleyici ve eski roller (sef, saha, viewer) yalnızca okuyabilir
  if (user.role !== 'saha_personeli') {
    throw new Error(`${module} modülünde yazma yetkisi yok`)
  }
  // saha_personeli: permissions JSONB'den kontrol et
  const perms = (user.permissions && user.permissions[module]) || {}
  if (!perms[action]) {
    const actionLabel = { create: 'Ekleme', update: 'Düzenleme', delete: 'Silme' }[action] || action
    throw new Error(`${module} modülünde ${actionLabel} yetkisi yok`)
  }
}

function guardedSafe(module, action, fn) {
  return async function (...args) {
    try {
      _permCheck(module, action)
      return await fn.apply(this, args)
    } catch (e) {
      const msg = e?.message || e?.code || 'Yetki/bağlantı sorunu'
      console.error('Yetki/Supabase hatası:', msg, e)
      if (typeof window !== 'undefined' && window.toast) {
        window.toast('⚠ ' + msg, 'err')
      }
    }
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────
window.sbLoginUser         = sbLoginUser
window.sbGetUserByUsername = sbGetUserByUsername
window.sbGetAllUsers       = sbGetAllUsers
window.sbCreateUser        = sbCreateUser
window.sbUpdateUser        = sbUpdateUser
window.sbDeleteUser        = sbDeleteUser

// ─── Core ────────────────────────────────────────────────────────────────────
window.sbLoadAllData       = sbLoadAllData
window.sbMigrateLocalDB    = sbMigrateLocalDB
window.sbWipeAllData       = sbWipeAllData
window.sbWipeProjeData     = sbWipeProjeData
window.sbWipeProjeBinaData      = sbWipeProjeBinaData
window.sbWipeProjeSartnameData  = sbWipeProjeSartnameData
window.sbWipeProjeSpecData      = sbWipeProjeSpecData
window.sbWipeProjeMalzemeData   = sbWipeProjeMalzemeData
window.sbWipeProjeSiparisData   = sbWipeProjeSiparisData
window.sbWipeCompaniesData      = sbWipeCompaniesData
window.sbWipeAletData      = sbWipeAletData
window.sbWipeSahaData      = sbWipeSahaData
window.sbWipeGeciciData    = sbWipeGeciciData
window.sbWipeRaporData     = sbWipeRaporData
window.sbWipeTutanakData   = sbWipeTutanakData

// ─── Settings & Audit ────────────────────────────────────────────────────────
window.sbOnbellekTemizle   = sbOnbellekTemizle
window.sbGetSetting        = sbGetSetting
window.sbSetSetting        = sbSetSetting
window.sbInsertAuditLog    = sbInsertAuditLog
window.sbGetAuditLog       = sbGetAuditLog

// ─── Alet ────────────────────────────────────────────────────────────────────
window.sbGetAletItems      = sbGetAletItems
window.sbInsertAletItem    = guardedSafe('alet', 'create', sbInsertAletItem)
window.sbInsertAletItems   = guardedSafe('alet', 'create', sbInsertAletItems)
window.sbUpdateAletItem    = guardedSafe('alet', 'update', sbUpdateAletItem)
window.sbDeleteAletItem    = guardedSafe('alet', 'delete', sbDeleteAletItem)

// ─── Saha ────────────────────────────────────────────────────────────────────
window.sbGetSahaPanels     = sbGetSahaPanels
window.sbInsertSahaPanel   = guardedSafe('saha', 'create', sbInsertSahaPanel)
window.sbUpdateSahaPanel   = guardedSafe('saha', 'update', sbUpdateSahaPanel)
window.sbDeleteSahaPanel   = guardedSafe('saha', 'delete', sbDeleteSahaPanel)
window.sbGetSahaLines      = sbGetSahaLines
window.sbInsertSahaLine    = guardedSafe('saha', 'create', sbInsertSahaLine)
window.sbDeleteSahaLine    = guardedSafe('saha', 'delete', sbDeleteSahaLine)
window.sbGetSahaSockets    = sbGetSahaSockets
window.sbInsertSahaSocket  = guardedSafe('saha', 'create', sbInsertSahaSocket)
window.sbUpdateSahaSocket  = guardedSafe('saha', 'update', sbUpdateSahaSocket)
window.sbDeleteSahaSocket  = guardedSafe('saha', 'delete', sbDeleteSahaSocket)
window.sbGetAllSahaSettings = sbGetAllSahaSettings
window.sbSetSahaSetting    = guardedSafe('saha', 'update', sbSetSahaSetting)

// ─── Rapor ───────────────────────────────────────────────────────────────────
window.sbGetRaporEntries          = sbGetRaporEntries
window.sbInsertRaporEntry         = guardedSafe('rapor', 'create', sbInsertRaporEntry)
window.sbInsertRaporEntries       = guardedSafe('rapor', 'create', sbInsertRaporEntries)
window.sbUpdateRaporEntry         = guardedSafe('rapor', 'update', sbUpdateRaporEntry)
window.sbDeleteRaporEntry         = guardedSafe('rapor', 'delete', sbDeleteRaporEntry)
window.sbDeleteRaporEntriesByIds  = guardedSafe('rapor', 'delete', sbDeleteRaporEntriesByIds)
window.sbGetRaporEkipler          = sbGetRaporEkipler
window.sbInsertRaporEkip          = guardedSafe('rapor', 'create', sbInsertRaporEkip)
window.sbInsertRaporEkipler       = guardedSafe('rapor', 'create', sbInsertRaporEkipler)
window.sbDeleteRaporEkip          = guardedSafe('rapor', 'delete', sbDeleteRaporEkip)

// ─── Tutanak (malzeme teslim tutanagi) ───────────────────────────────────────
// Rapor modulunun yetkisini kullanir: Rapor'u gorebilen tutanagi gorur,
// Rapor'a yazabilen tutanak acar.
window.sbGetTutanaklar     = sbGetTutanaklar
window.sbInsertTutanak     = guardedSafe('rapor', 'create', sbInsertTutanak)
window.sbUpdateTutanak     = guardedSafe('rapor', 'update', sbUpdateTutanak)
window.sbDeleteTutanak     = guardedSafe('rapor', 'delete', sbDeleteTutanak)

// ─── Gecici ──────────────────────────────────────────────────────────────────
window.sbGetGeciciLib          = sbGetGeciciLib
window.sbInsertGeciciLibItem   = guardedSafe('gecici', 'create', sbInsertGeciciLibItem)
window.sbInsertGeciciLibItems  = guardedSafe('gecici', 'create', sbInsertGeciciLibItems)
window.sbUpdateGeciciLibItem   = guardedSafe('gecici', 'update', sbUpdateGeciciLibItem)
window.sbDeleteGeciciLibItem   = guardedSafe('gecici', 'delete', sbDeleteGeciciLibItem)
window.sbGetGeciciMoves        = sbGetGeciciMoves
window.sbInsertGeciciMove      = guardedSafe('gecici', 'create', sbInsertGeciciMove)
window.sbInsertGeciciMoves     = guardedSafe('gecici', 'create', sbInsertGeciciMoves)
window.sbDeleteGeciciMove      = guardedSafe('gecici', 'delete', sbDeleteGeciciMove)
window.sbDeleteGeciciMovesByIds = guardedSafe('gecici', 'delete', sbDeleteGeciciMovesByIds)
window.sbGetGeciciOrders       = sbGetGeciciOrders
window.sbInsertGeciciOrder     = guardedSafe('gecici', 'create', sbInsertGeciciOrder)
window.sbInsertGeciciOrders    = guardedSafe('gecici', 'create', sbInsertGeciciOrders)
window.sbDeleteGeciciOrder     = guardedSafe('gecici', 'delete', sbDeleteGeciciOrder)

// ─── Proje ───────────────────────────────────────────────────────────────────
window.sbGetProjeBuildings     = sbGetProjeBuildings
window.sbInsertProjeBuilding   = guardedSafe('tanimlar', 'create', sbInsertProjeBuilding)
window.sbInsertProjeBuildings  = guardedSafe('tanimlar', 'create', sbInsertProjeBuildings)
window.sbDeleteProjeBuilding   = guardedSafe('tanimlar', 'delete', sbDeleteProjeBuilding)
window.sbRenameProjeBuilding   = guardedSafe('tanimlar', 'update', sbRenameProjeBuilding)
window.sbGetProjeSections      = sbGetProjeSections
window.sbInsertProjeSection    = guardedSafe('tanimlar', 'create', sbInsertProjeSection)
window.sbInsertProjeSections   = guardedSafe('tanimlar', 'create', sbInsertProjeSections)
window.sbDeleteProjeSection    = guardedSafe('tanimlar', 'delete', sbDeleteProjeSection)
window.sbGetProjeSartnames     = sbGetProjeSartnames
window.sbInsertProjeSartname   = guardedSafe('tanimlar', 'create', sbInsertProjeSartname)
window.sbInsertProjeSartnames  = guardedSafe('tanimlar', 'create', sbInsertProjeSartnames)
window.sbUpdateProjeSartname   = guardedSafe('tanimlar', 'update', sbUpdateProjeSartname)
window.sbDeleteProjeSartname   = guardedSafe('tanimlar', 'delete', sbDeleteProjeSartname)
window.sbGetProjeMaterials     = sbGetProjeMaterials
window.sbInsertProjeMaterial   = guardedSafe('kutuphane', 'create', sbInsertProjeMaterial)
window.sbInsertProjeMaterials  = guardedSafe('kutuphane', 'create', sbInsertProjeMaterials)
window.sbUpdateProjeMaterial   = guardedSafe('kutuphane', 'update', sbUpdateProjeMaterial)
window.sbDeleteProjeMaterial   = guardedSafe('kutuphane', 'delete', sbDeleteProjeMaterial)
window.sbDeleteProjeMaterials  = guardedSafe('kutuphane', 'delete', sbDeleteProjeMaterials)
window.sbGetProjeSpecs         = sbGetProjeSpecs
window.sbInsertProjeSpec       = guardedSafe('proje', 'create', sbInsertProjeSpec)
window.sbInsertProjeSpecs      = guardedSafe('proje', 'create', sbInsertProjeSpecs)
window.sbUpdateProjeSpec       = guardedSafe('proje', 'update', sbUpdateProjeSpec)
window.sbDeleteProjeSpec       = guardedSafe('proje', 'delete', sbDeleteProjeSpec)
window.sbDeleteProjeSpecs      = guardedSafe('proje', 'delete', sbDeleteProjeSpecs)
window.sbGetProjeItems         = sbGetProjeItems
window.sbInsertProjeItem       = guardedSafe('proje', 'create', sbInsertProjeItem)
window.sbInsertProjeItems      = guardedSafe('proje', 'create', sbInsertProjeItems)
window.sbUpdateProjeItem       = guardedSafe('proje', 'update', sbUpdateProjeItem)
window.sbDeleteProjeItem       = guardedSafe('proje', 'delete', sbDeleteProjeItem)
window.sbDeleteProjeItems      = guardedSafe('proje', 'delete', sbDeleteProjeItems)
window.sbGetProjeOrders        = sbGetProjeOrders
window.sbInsertProjeOrder      = guardedSafe('proje', 'create', sbInsertProjeOrder)
window.sbInsertProjeOrders     = guardedSafe('proje', 'create', sbInsertProjeOrders)
window.sbUpdateProjeOrder      = guardedSafe('proje', 'update', sbUpdateProjeOrder)
window.sbDeleteProjeOrder      = guardedSafe('proje', 'delete', sbDeleteProjeOrder)
window.sbUpsertProjeMaterials  = guardedSafe('kutuphane', 'update', sbUpsertProjeMaterials)
window.sbUpsertProjeSpecs      = guardedSafe('proje', 'update', sbUpsertProjeSpecs)
window.sbUpsertProjeItems      = guardedSafe('proje', 'update', sbUpsertProjeItems)

// ─── Alternatif Ürün ─────────────────────────────────────────────────────────
window.sbGetProjeAlternatives    = sbGetProjeAlternatives
window.sbInsertProjeAlternative  = guardedSafe('proje', 'create', sbInsertProjeAlternative)
window.sbUpdateProjeAlternative  = guardedSafe('proje', 'update', sbUpdateProjeAlternative)
window.sbDeleteProjeAlternative  = guardedSafe('proje', 'delete', sbDeleteProjeAlternative)

// ─── Bina 3D Modelleri ────────────────────────────────────────────────────────
window.sbGetProjeBinaModelleri  = sbGetProjeBinaModelleri
window.sbInsertProjeBinaModel   = guardedSafe('tanimlar', 'create', sbInsertProjeBinaModel)
window.sbUpdateProjeBinaModel   = guardedSafe('tanimlar', 'update', sbUpdateProjeBinaModel)
window.sbDeleteProjeBinaModel   = guardedSafe('tanimlar', 'delete', sbDeleteProjeBinaModel)
window.sbUploadBinaModelFile    = guardedSafe('tanimlar', 'create', sbUploadBinaModelFile)
window.sbDeleteBinaModelFile    = guardedSafe('tanimlar', 'delete', sbDeleteBinaModelFile)

// ─── Belgeler (fatura PDF) ───────────────────────────────────────────────────
// Bunlar guardedSafe'e SARILMAZ: guardedSafe hatada undefined dondurup toast basiyor,
// oysa buradaki cagiranlar donen degeri kullaniyor (yukleme kunyesi / imzali adres) ve
// hatayi kendileri yonetiyor - sessiz undefined "yuklendi" sanilirdi.
// Yukleme icin yetki yine kontrol edilir, ama hata YUTULMAZ, yukari firlatilir.
function guardedThrow(module, action, fn) {
  return async function (...args) { _permCheck(module, action); return fn.apply(this, args) }
}
window.sbBelgeUrl               = sbBelgeUrl                                   // okuma: oturum yeter
window.sbBelgeYukle             = guardedThrow('proje', 'create', sbBelgeYukle) // siparis olusturmayla ayni yetki
window.sbBelgeSil               = sbBelgeSil                                   // govdesi hatayi zaten yutuyor
window.initBinaViewer           = initBinaViewer

// ─── Parcali giris: lokasyon kirilim agaci (Kat / Fragment / Oda) ────────────
window.sbInsertProjeLokasyon    = guardedSafe('tanimlar', 'create', sbInsertProjeLokasyon)
window.sbUpdateProjeLokasyon    = guardedSafe('tanimlar', 'update', sbUpdateProjeLokasyon)
window.sbDeleteProjeLokasyonlar = guardedSafe('tanimlar', 'delete', sbDeleteProjeLokasyonlar)

// ─── Sirketler ───────────────────────────────────────────────────────────────
window.sbGetCompanies      = sbGetCompanies
window.sbInsertCompany     = guardedSafe('tanimlar', 'create', sbInsertCompany)
window.sbUpdateCompany     = guardedSafe('tanimlar', 'update', sbUpdateCompany)
window.sbDeleteCompany     = guardedSafe('tanimlar', 'delete', sbDeleteCompany)
