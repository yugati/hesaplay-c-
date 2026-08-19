// ─────────────────────────────────────────────────────────────────────────────
// YETKI KONTROLU - SUNUCU TARAFI (Asama 2)
//
// Bu dosya, tarayicidaki kuralin (index.html _getModulePerms / src/main.js
// _permCheck) BIREBIR karsiligidir. Amac davranisi degistirmek degil, kontrolu
// guvenilir yere tasimak: tarayicidaki kontrol kullanici tarafindan atlanabilir,
// buradaki atlanamaz. Tarayici kontrolu KALDIRILMADI - o artik hiz/UX icin var
// (aninda uyari, bosuna istek atilmaz), yetkinin son sozu burasi.
//
// KURAL DEGISIKLIGI YAPILMADI. Bugun tarayicida gecen bir islem burada da gecer,
// gecmeyen burada da gecmez. Bilinen tutarsizliklar (orn. yalnizca 'siparis'
// yetkisi olan kullanicinin siparis kaydinin 'proje' create istemesi) BILEREK
// oldugu gibi birakildi - onlar ayri bir karar konusu.
// ─────────────────────────────────────────────────────────────────────────────

// index.html _getModulePerms'in aynisi
export function modulIzinleri(user, mod) {
  if (!user) return { read: false, create: false, update: false, delete: false }
  if (user.role === 'admin') return { read: true, create: true, update: true, delete: true }
  if (user.role === 'saha_personeli') {
    const p = (user.permissions && user.permissions[mod]) || {}
    return { read: !!p.read, create: !!p.create, update: !!p.update, delete: !!p.delete }
  }
  // izleyici ve eski roller (sef, saha, viewer): yalnizca kendi bolumlerini OKUR
  const gorur = !!(user.sections && user.sections.includes(mod))
  return { read: gorur, create: false, update: false, delete: false }
}

// YAZMA modulu: src/main.js'teki guardedSafe(...) sarmalayicilarindan cikarildi.
const YAZMA_MODULU = {
  alet_items: 'alet',
  saha_panels: 'saha', saha_lines: 'saha', saha_sockets: 'saha', saha_settings: 'saha',
  rapor_entries: 'rapor', rapor_ekipler: 'rapor', tutanaklar: 'rapor',
  gecici_lib: 'gecici', gecici_moves: 'gecici', gecici_orders: 'gecici',
  proje_buildings: 'tanimlar', proje_sections: 'tanimlar', proje_sartnames: 'tanimlar',
  proje_bina_modelleri: 'tanimlar', proje_lokasyonlar: 'tanimlar', companies: 'tanimlar',
  proje_materials: 'kutuphane',
  proje_specs: 'proje', proje_items: 'proje', proje_orders: 'proje', proje_alternatives: 'proje',
}

// OKUMA modulu: src/supabase.js sbLoadAllData'daki need(...) kosullarinin aynisi.
// Bir tablo, onu yukleten modullerden HERHANGI BIRINI okuyabilen kullaniciya acilir -
// aksi halde bugun sorunsuz acilan bir kullanici (orn. yalnizca 'rapor' yetkilisi,
// sartname/malzeme verisini de cekiyor) acilista 403 alirdi.
const OKUMA_MODULLERI = {
  alet_items: ['alet'],
  saha_panels: ['saha'], saha_lines: ['saha'], saha_sockets: ['saha'], saha_settings: ['saha'],
  rapor_entries: ['rapor'], rapor_ekipler: ['rapor'], tutanaklar: ['rapor'],
  gecici_lib: ['gecici'], gecici_moves: ['gecici'], gecici_orders: ['gecici'],
  // needProjeCore
  proje_sartnames: ['proje', 'rapor', 'tanimlar', 'kutuphane'],
  proje_materials: ['proje', 'rapor', 'tanimlar', 'kutuphane'],
  proje_specs: ['proje', 'rapor', 'tanimlar', 'kutuphane'],
  proje_buildings: ['proje', 'rapor', 'tanimlar', 'kutuphane'],
  proje_sections: ['proje', 'rapor', 'tanimlar', 'kutuphane'],
  proje_lokasyonlar: ['proje', 'rapor', 'tanimlar', 'kutuphane'],
  // needProjeFull
  proje_items: ['proje', 'siparis'], proje_orders: ['proje', 'siparis'],
  proje_alternatives: ['proje', 'siparis'], proje_bina_modelleri: ['proje', 'siparis'],
  // needCompanies
  companies: ['proje', 'tanimlar', 'siparis'],
}

// app_settings: migration bayraklari, taslaklar, kat listesi... HER kullanici okur ve
// yazar (bugun de oyle - sbSetSetting hicbir sarmalayiciya bagli degil). Taslak kaydetme
// gibi akislar buna bagli oldugu icin daraltilmadi; kalan is olarak not edildi.
// audit_log: yazma herkese acik (her kullanici kendi eylemini kaydeder), OKUMA admin'e
// ozel - denetim kaydi tum kullanicilarin eylemlerini gosterir.
const SERBEST_YAZMA = new Set(['app_settings', 'audit_log'])
const SERBEST_OKUMA = new Set(['app_settings'])
const ADMIN_OKUMA = new Set(['audit_log'])

const OP_EYLEM = { insert: 'create', update: 'update', delete: 'delete' }

/* Sonuc: {ok:true} veya {ok:false, kod:403, mesaj:'...'}
   op: count|select|insert|upsert|update|delete */
export function yetkiKontrol(user, table, op, tumTablo) {
  if (!user) return { ok: false, kod: 401, mesaj: 'Oturum gecersiz' }
  if (user.role === 'admin') return { ok: true }

  // TUM TABLOYU silme (wipe) yalnizca admin - en yikici islem
  if (op === 'delete' && tumTablo) {
    return { ok: false, kod: 403, mesaj: 'Bu islem icin yonetici yetkisi gerekir' }
  }

  if (op === 'count' || op === 'select') {
    if (SERBEST_OKUMA.has(table)) return { ok: true }
    if (ADMIN_OKUMA.has(table)) return { ok: false, kod: 403, mesaj: 'Bu kayitlari yalnizca yonetici gorebilir' }
    const moduller = OKUMA_MODULLERI[table]
    if (!moduller) return { ok: false, kod: 403, mesaj: 'Bu tabloya erisim yok' }
    const acik = moduller.some(m => modulIzinleri(user, m).read)
    return acik ? { ok: true } : { ok: false, kod: 403, mesaj: 'Bu bolumu goruntuleme yetkiniz yok' }
  }

  if (SERBEST_YAZMA.has(table)) return { ok: true }

  const mod = YAZMA_MODULU[table]
  if (!mod) return { ok: false, kod: 403, mesaj: 'Bu tabloya yazma yetkisi yok' }
  const izin = modulIzinleri(user, mod)

  // upsert "varsa guncelle, yoksa ekle" demek: create VEYA update yetkisi yeter.
  // (Tarayici tarafinda cagiran fonksiyona gore biri isteniyor - orn. ekip ekleme
  // create, malzeme toplu guncelleme update. Ikisinden birini istemek her iki
  // cagriyi da bugunku gibi gecirir, fazladan yetki vermez.)
  if (op === 'upsert') {
    return (izin.create || izin.update)
      ? { ok: true }
      : { ok: false, kod: 403, mesaj: mod + ' modulunde ekleme/duzenleme yetkiniz yok' }
  }

  const eylem = OP_EYLEM[op]
  if (!eylem) return { ok: false, kod: 400, mesaj: 'Bilinmeyen islem' }
  if (!izin[eylem]) {
    const etiket = { create: 'Ekleme', update: 'Duzenleme', delete: 'Silme' }[eylem]
    return { ok: false, kod: 403, mesaj: mod + ' modulunde ' + etiket + ' yetkiniz yok' }
  }
  return { ok: true }
}
