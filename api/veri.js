import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'
import { yetkiKontrol } from '../lib/yetki.js'

// ─────────────────────────────────────────────────────────────────────────────
// VERI ERISIM UCU (Asama 1)
//
// Tarayici artik Supabase'e DOGRUDAN gitmez; her tablo islemi buradan gecer ve
// service_role anahtariyla sunucuda calisir. Amac: anon anahtarin tarayiciya
// gomulu olmasi ve tum tablolarin "TO anon USING (true)" politikasiyla acik
// olmasi (bkz. supabase_schema.sql) - siteyi acan herkes giris yapmadan tum
// veriyi okuyup silebiliyordu.
//
// Bu uc GENEL bir SQL kapisi DEGILDIR: tablo, sutun, siralama ve eslesme alanlari
// beyaz listeyle sinirlidir. Liste disindaki her sey reddedilir. 'users' tablosu
// hicbir kosulda buradan erisilemez - o zaten /api/users* ile yonetiliyor.
//
// Yetki (Asama 2): modul bazli okuma/ekleme/duzenleme/silme kontrolu artik BURADA
// yapiliyor (lib/yetki.js) - tarayicidaki kontrol atlanabilir, bu atlanamaz.
// Kurallar tarayicidakinin birebir kopyasidir, davranis degismedi.
// ─────────────────────────────────────────────────────────────────────────────

// id + data (JSONB) seklindeki varlik tablolari
const VARLIK_TABLOLARI = new Set([
  'companies', 'tutanaklar', 'alet_items',
  'saha_panels', 'saha_lines', 'saha_sockets',
  'rapor_entries', 'gecici_lib', 'gecici_moves', 'gecici_orders',
  'proje_sartnames', 'proje_materials', 'proje_specs', 'proje_items',
  'proje_orders', 'proje_alternatives', 'proje_bina_modelleri', 'proje_lokasyonlar',
  'audit_log',
])
// anahtar/deger ve basit liste tablolari
const DIGER_TABLOLAR = new Set(['app_settings', 'saha_settings', 'rapor_ekipler', 'proje_buildings', 'proje_sections'])

const TABLOLAR = new Set([...VARLIK_TABLOLARI, ...DIGER_TABLOLAR])

// select ile istenebilecek sutun kaliplari (serbest metin kabul edilmez)
// 'id, updated_at': ARTIMLI YUKLEME'nin kimlik listesi - satir basina ~45 bayt.
// Istemci bunu onbellegiyle karsilastirip yalnizca degisen satirlarin verisini ister.
const SUTUNLAR = new Set(['id, data', 'id', 'id, updated_at', 'data', 'key, value', 'key, updated_at', 'value', 'name', 'code'])
// siralama ve eslesme icin kullanilabilecek sutunlar
const SIRA_SUTUNLARI = new Set(['created_at', 'id', 'sort_order', 'name', 'code'])
const ESLESME_SUTUNLARI = new Set(['id', 'key', 'name', 'code'])

const MAX_SATIR = 3000   // tek istekte islenebilecek satir sayisi ust siniri
const PGRST_TAVAN = 1000 // PostgREST'in tek yanitta dondurdugu azami satir (db-max-rows)

function hata(res, kod, mesaj) { res.status(kod).json({ error: mesaj }); return null }

export default async function handler(req, res) {
  if (req.method !== 'POST') return hata(res, 405, 'Method not allowed')

  const claims = requireAuth(req)
  if (!claims) return hata(res, 401, 'Oturum gecersiz')

  const g = req.body || {}
  const { op, table } = g

  if (!TABLOLAR.has(table)) return hata(res, 400, 'Bilinmeyen tablo: ' + table)

  try {
    // YETKI. Kullanici bilgisi oncelikle tokenden okunur (acilistaki ~60 istek icin
    // her seferinde users tablosuna gitmemek adina). ESKI tokenlerde (Asama 2'den once
    // imzalanmis) bu alanlar yoktur - o durumda kullanici satirindan okunur, boylece
    // yenilenmemis oturumlar da calismaya devam eder.
    let kullanici
    if (claims.perms || claims.sections) {
      kullanici = { role: claims.role, sections: claims.sections || [], permissions: claims.perms || {} }
    } else {
      const { data } = await supabaseAdmin.from('users').select('role, sections, permissions').eq('id', claims.sub).maybeSingle()
      if (!data) return hata(res, 401, 'Kullanici bulunamadi - yeniden giris yapin')
      kullanici = data
    }
    const izin = yetkiKontrol(kullanici, table, op, !!g.all)
    if (!izin.ok) return hata(res, izin.kod, izin.mesaj)

    let q = supabaseAdmin.from(table)

    if (op === 'count') {
      // '*' kullanilir, 'id' DEGIL: app_settings / saha_settings anahtar-deger
      // tablolaridir ve id sutunlari yok - 'id' ile sayim orada hata veriyordu.
      // head:true oldugu icin satir tasinmaz, yalnizca sayi doner.
      const { count, error } = await q.select('*', { count: 'exact', head: true })
      if (error) throw error
      res.status(200).json({ count: count || 0 })
      return
    }

    if (op === 'select') {
      const kolon = g.columns || 'id, data'
      if (!SUTUNLAR.has(kolon)) return hata(res, 400, 'Izin verilmeyen sutun secimi')
      for (const s of (g.order || [])) {
        if (!SIRA_SUTUNLARI.has(s.col)) return hata(res, 400, 'Izin verilmeyen siralama sutunu')
      }
      if (g.eq && !ESLESME_SUTUNLARI.has(g.eq.col)) return hata(res, 400, 'Izin verilmeyen eslesme sutunu')
      // in: artimli yuklemede YALNIZCA degisen satirlarin verisini istemek icin
      if (g.in) {
        if (!ESLESME_SUTUNLARI.has(g.in.col)) return hata(res, 400, 'Izin verilmeyen eslesme sutunu')
        if (!Array.isArray(g.in.vals) || !g.in.vals.length) return hata(res, 400, 'Deger listesi bos')
        if (g.in.vals.length > MAX_SATIR) return hata(res, 400, 'Tek istekte en fazla ' + MAX_SATIR + ' kayit')
      }
      if (Array.isArray(g.range)) {
        const [f, t] = g.range
        if (!Number.isInteger(f) || !Number.isInteger(t) || f < 0 || t < f || t - f >= MAX_SATIR) {
          return hata(res, 400, 'Gecersiz aralik')
        }
      }
      if (g.limit != null && (!Number.isInteger(g.limit) || g.limit < 1 || g.limit > MAX_SATIR)) {
        return hata(res, 400, 'Gecersiz limit')
      }

      // Sorgu her seferinde YENIDEN kurulur: PostgREST builder'i tek kullanimliktir,
      // sayfalama dongusunde ayni nesne tekrar kullanilamaz.
      const kur = () => {
        let s = supabaseAdmin.from(table).select(kolon)
        for (const o of (g.order || [])) s = s.order(o.col, { ascending: o.asc !== false })
        if (g.eq) s = s.eq(g.eq.col, g.eq.val)
        if (g.in) s = s.in(g.in.col, g.in.vals)
        return s
      }

      if (g.single) {
        const { data, error } = await kur().maybeSingle()
        if (error) throw error
        res.status(200).json({ rows: data })
        return
      }
      if (Array.isArray(g.range)) {
        const { data, error } = await kur().range(g.range[0], g.range[1])
        if (error) throw error
        res.status(200).json({ rows: data })
        return
      }
      // LIMIT ve PostgREST'in 1000 satirlik TAVANI: sunucu tek yanitta en fazla 1000 satir
      // dondurur, .limit(2000) sessizce 1000'e kirpiliyordu - denetim kaydi ekrani istediginin
      // yarisini goruyordu. Limit tavani asiyorsa burada sayfalanip tamamlanir.
      if (g.limit != null && g.limit > PGRST_TAVAN) {
        const hepsi = []
        for (let f = 0; f < g.limit; f += PGRST_TAVAN) {
          const { data, error } = await kur().range(f, Math.min(g.limit, f + PGRST_TAVAN) - 1)
          if (error) throw error
          hepsi.push(...(data || []))
          if (!data || data.length < PGRST_TAVAN) break
        }
        res.status(200).json({ rows: hepsi })
        return
      }
      const { data, error } = g.limit != null ? await kur().limit(g.limit) : await kur()
      if (error) throw error
      res.status(200).json({ rows: data })
      return
    }

    if (op === 'insert' || op === 'upsert') {
      const rows = g.rows
      if (!Array.isArray(rows) || !rows.length) return hata(res, 400, 'Satir yok')
      if (rows.length > MAX_SATIR) return hata(res, 400, 'Tek istekte en fazla ' + MAX_SATIR + ' satir')
      const { error } = op === 'insert'
        ? await q.insert(rows)
        : await q.upsert(rows, { onConflict: g.onConflict || 'id' })
      if (error) throw error
      res.status(200).json({ ok: true, n: rows.length })
      return
    }

    if (op === 'update') {
      if (!g.eq || !ESLESME_SUTUNLARI.has(g.eq.col)) return hata(res, 400, 'Gecersiz eslesme')
      if (!g.patch || typeof g.patch !== 'object') return hata(res, 400, 'Gecersiz guncelleme')
      const { error } = await q.update(g.patch).eq(g.eq.col, g.eq.val)
      if (error) throw error
      res.status(200).json({ ok: true })
      return
    }

    if (op === 'delete') {
      let d = q.delete()
      if (g.all) {
        // TUM TABLOYU bosaltir - yetki kontrolunde yalnizca admin'e aciktir
        d = d.gte('created_at', '2000-01-01T00:00:00Z')
      } else if (g.in) {
        if (!ESLESME_SUTUNLARI.has(g.in.col)) return hata(res, 400, 'Izin verilmeyen eslesme sutunu')
        if (!Array.isArray(g.in.vals) || !g.in.vals.length) return hata(res, 400, 'Deger listesi bos')
        if (g.in.vals.length > MAX_SATIR) return hata(res, 400, 'Tek istekte en fazla ' + MAX_SATIR + ' kayit')
        d = d.in(g.in.col, g.in.vals)
      } else if (g.eq) {
        if (!ESLESME_SUTUNLARI.has(g.eq.col)) return hata(res, 400, 'Izin verilmeyen eslesme sutunu')
        d = d.eq(g.eq.col, g.eq.val)
      } else {
        // eslesmesiz silme = tum tabloyu silme; kazara olmasin diye acikca reddedilir
        return hata(res, 400, 'Silme kosulu belirtilmedi')
      }
      const { error } = await d
      if (error) throw error
      res.status(200).json({ ok: true })
      return
    }

    return hata(res, 400, 'Bilinmeyen islem: ' + op)
  } catch (e) {
    // Postgres hata kodu istemciye GECIRILIR: sbFetchRange zaman asimi kodunu (57014)
    // gorup araligi kucultup yeniden deniyor - kod kaybolursa o kurtarma calismaz.
    console.error('veri:', op, table, e && e.code, e && e.message)
    res.status(500).json({ error: e.message || 'Veritabani hatasi', code: e.code })
  }
}
