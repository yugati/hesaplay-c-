import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../lib/auth.js'
import { yetkiKontrol, denetimGorebilir } from '../lib/yetki.js'
import { denetimYaz } from '../lib/denetim.js'
import { VARSAYILAN_ORG } from '../lib/org.js'
import { VARSAYILAN_TASARI, tasariFiltrelenir, tasariDamgalanir } from '../lib/tasari.js'

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
//
// ORGANIZASYON: her sorgu tokendeki AKTIF ORGANIZASYONA daraltilir - okumada
// .eq('org_id', org), yazmada satirlara org_id ZORLA yazilir. Istemci org
// gonderemez; gonderirse ezilir (bkz. lib/org.js). Tek bir kiraci varken bu
// filtreler gorunur bir degisiklik yapmaz, cunku tum veri zaten 'bykara'dir.
//
// TASARI (PROJE KATMANI): organizasyonun ALTINDA ikinci bir daraltma. Is verisi
// tasiyan tablolarda her sorgu AKTIF TASARIYA da daraltilir - okumada
// .eq('tasari_id', tasari), yazmada satirlara tasari_id ZORLA yazilir. Org ile
// birebir ayni desen, tek farki hangi tablolara uygulandigi:
//   - TASARI_TABLOLARI  -> hem daraltilir hem damgalanir (bkz. lib/tasari.js)
//   - ORTAK_TABLOLAR    -> DOKUNULMAZ. companies / proje_materials / alet_lib /
//     gecici_lib KUTUPHANEDIR ve tum tasarilar ayni satirlari gorur (alinan
//     karar: "kutuphane ortak, is verisi tasariya ozel"). Bu tablolara tasari
//     filtresi eklemek, her projede 696 malzeme kunyesini yeniden girdirmek olurdu.
//   - audit_log         -> damgalanir ama FILTRELENMEZ. Denetim kaydi org
//     duzeyinde bir guvenlik defteridir; projeye gore bolunse, bir tasarida
//     silme yapanin izi digerine bakan yoneticiden gizlenirdi.
//
// 'organizations' ve 'tasarilar' tablolari BILEREK asagidaki beyaz listede
// YOKTUR: kiraci ya da proje listesini buradan duzenleyebilmek, herhangi bir
// kullanicinin kendini baska organizasyona/projeye tasiyabilmesi demek olurdu.
// Ikisi de yalnizca /api/org uzerinden yonetilir.
// ─────────────────────────────────────────────────────────────────────────────

// id + data (JSONB) seklindeki varlik tablolari
const VARLIK_TABLOLARI = new Set([
  'companies', 'tutanaklar', 'alet_items', 'alet_lib',
  'saha_panels', 'saha_lines', 'saha_sockets',
  'rapor_entries', 'gecici_lib', 'gecici_moves', 'gecici_orders',
  'proje_sartnames', 'proje_materials', 'proje_specs', 'proje_items',
  'proje_orders', 'proje_alternatives', 'proje_bina_modelleri', 'proje_lokasyonlar',
  'gunluk_isler', 'ihtiyac_listeleri', 'faturalar',
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

/* UPSERT CAKISMA HEDEFI ARTIK SUNUCUDA BELIRLENIR, istemciden gelmez.
   Sebep: hedef sutunlar artik org_id ve tasari_id iceriyor (migration_org_1.sql
   ve migration_tasari_1.sql'deki benzersiz indeksler). Istemcinin gonderdigi
   'id' ya da 'key' hedefi kullanilsaydi bir kiracinin upsert'i BASKA kiracinin -
   ya da ayni kiracinin BASKA PROJESININ - ayni anahtarli satirini gunceller,
   yani ezerdi.

   TASARI ozel tablolarda hedef tasari_id de tasir. Tasimasaydi: AKKUYU NGS'de
   '00UYB' binasi varken ikinci tasarida ayni kodu yazmak, yeni satir eklemek
   yerine AKKUYU NGS'nin binasini GUNCELLERDI - iki proje ayni satiri paylasir,
   birinde yapilan degisiklik digerinde gorunurdu. */
const CAKISMA_ANAHTAR = {
  app_settings: 'key',
  saha_settings: 'key',
  rapor_ekipler: 'name',
  proje_buildings: 'code',
  proje_sections: 'name',
}
function cakismaHedefi(table) {
  // Listede olmayan tablolar varlik tablolaridir: anahtar 'id'.
  const anahtar = CAKISMA_ANAHTAR[table] || 'id'
  return tasariFiltrelenir(table) ? `org_id,tasari_id,${anahtar}` : `org_id,${anahtar}`
}

/* SILME KAYDINDA gorunecek insan okunur tablo adlari. Denetim kaydini okuyan
   kisi 'proje_items' degil 'Siparis satiri' gormeli - listede bilmedigi bir tablo
   adi gorurse kaydi okumaz. Listede olmayan tablo kendi adiyla yazilir. */
const TABLO_ADI = {
  companies: 'Sirket', tutanaklar: 'Tutanak', alet_items: 'El aleti', alet_lib: 'Alet kunyesi',
  saha_panels: 'Saha panosu', saha_lines: 'Saha hatti', saha_sockets: 'Saha prizi',
  rapor_entries: 'Rapor kaydi', gecici_lib: 'Gecici elektrik kunyesi',
  gecici_moves: 'Gecici elektrik hareketi', gecici_orders: 'Gecici elektrik siparisi',
  proje_sartnames: 'Sartname', proje_materials: 'Malzeme', proje_specs: 'Spesifikasyon',
  proje_items: 'Siparis satiri', proje_orders: 'Siparis', proje_alternatives: 'Alternatif',
  proje_bina_modelleri: 'Bina modeli', proje_lokasyonlar: 'Lokasyon',
  gunluk_isler: 'Gunluk is', ihtiyac_listeleri: 'Ihtiyac listesi', faturalar: 'Fatura',
  app_settings: 'Ayar', saha_settings: 'Saha ayari', rapor_ekipler: 'Ekip',
  proje_buildings: 'Bina', proje_sections: 'Bolum',
}

/* TARAYICIDAN GELEN DENETIM KAYDININ KIMLIGI SUNUCUDA DAMGALANIR.
   audit_log'a yazma herkese aciktir (her kullanici kendi eylemini kaydeder) ve
   bu, istegi elle kuran birinin BASKASININ adina kayit girmesine acikti - denetim
   kaydinin tek isi kimin ne yaptigini soylemek oldugu icin bu, ozelligi bastan
   anlamsiz kilardi. Kullanici/rol/zaman artik istekten DEGIL tokenden yazilir;
   istemcinin gonderdigi degerler ezilir. Serbest metin olan 'detail' kalir. */
function damgala(rows, claims) {
  return rows.map(r => ({
    ...r,
    data: { ...(r && r.data), user: claims.username || '?', role: claims.role || '?', ts: Date.now() },
  }))
}

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
    //
    // ORGANIZASYON da ayni yerden gelir: tokende 'org' varsa O kullanilir (super
    // yonetici bir baska organizasyona GECMIS olabilir - kullanici satirindaki
    // org_id degil, tokendeki aktif org dogru cevaptir). Yoksa yine kullanici
    // satirindan okunur, boylece Asama 1 oncesi tokenler de calismaya devam eder.
    /* TASARI da ayni yerden gelir: tokende 'tas' varsa O kullanilir (kullanici
       baska bir tasariya GECMIS olabilir - kullanici satirindaki varsayilan
       tasari_id degil, tokendeki aktif tasari dogru cevaptir). Yoksa yine
       kullanici satirindan okunur, boylece tasari katmanindan ONCE imzalanmis
       tokenler de calismaya devam eder: o oturumlar AKKUYU NGS'de kalir ve
       token 20 dakikada bir tazelenirken alan kendiliginden yerine oturur. */
    let kullanici, org = null, tasari = null
    if (claims.perms || claims.sections) {
      kullanici = { role: claims.role, sections: claims.sections || [], permissions: claims.perms || {} }
    }
    if (typeof claims.org === 'string' && claims.org) org = claims.org
    if (typeof claims.tas === 'string' && claims.tas) tasari = claims.tas
    if (!kullanici || !org || !tasari) {
      const { data } = await supabaseAdmin.from('users').select('role, sections, permissions, org_id, tasari_id').eq('id', claims.sub).maybeSingle()
      if (!data) return hata(res, 401, 'Kullanici bulunamadi - yeniden giris yapin')
      kullanici = kullanici || { role: data.role, sections: data.sections || [], permissions: data.permissions || {} }
      org = org || data.org_id || VARSAYILAN_ORG
      tasari = tasari || data.tasari_id || VARSAYILAN_TASARI
    }
    const izin = yetkiKontrol(kullanici, table, op, !!g.all)
    if (!izin.ok) return hata(res, izin.kod, izin.mesaj)

    /* HER SORGUNUN KAPSAMI TEK YERDEN kurulur. Org filtresi HER tabloya, tasari
       filtresi YALNIZCA is verisi tablolarina uygulanir - kutuphane (companies,
       proje_materials, alet_lib, gecici_lib) ve denetim kaydi disarida kalir.
       Elle tekrarlansaydi, yeni bir dal eklendiginde filtrelerden biri unutulur
       ve o yol sessizce butun projelerin verisini gorurdu. */
    const kapsa = (sorgu) => {
      let x = sorgu.eq('org_id', org)
      if (tasariFiltrelenir(table)) x = x.eq('tasari_id', tasari)
      return x
    }

    let q = supabaseAdmin.from(table)

    if (op === 'count') {
      // '*' kullanilir, 'id' DEGIL: app_settings / saha_settings anahtar-deger
      // tablolaridir ve id sutunlari yok - 'id' ile sayim orada hata veriyordu.
      // head:true oldugu icin satir tasinmaz, yalnizca sayi doner.
      const { count, error } = await kapsa(q.select('*', { count: 'exact', head: true }))
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
        let s = kapsa(supabaseAdmin.from(table).select(kolon))
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
      /* YEDEKTEN GERI YUKLEME denetim kaydinda DAMGALANMAZ. Damgalansaydi geri
         yuklenen her tarihi kayit "bugun, geri yukleyen kisi" olarak yazilir,
         yani yedegin tasidigi gecmis yok olurdu. Bu kapi dar tutulur: yalnizca
         denetim kaydi yetkisi OLAN bir yonetici acabilir - o kisi zaten kaydin
         tamamini gorebiliyor ve silebiliyor, tarihli satir yazabilmesi yeni bir
         yetki vermez. Yetkisi olmayan icin istek reddedilir; sessizce damgalanip
         gecilseydi yedek bozuk geri yuklenirdi. */
      if (table === 'audit_log' && g.yedek && !denetimGorebilir(kullanici)) {
        return hata(res, 403, 'Denetim kaydini geri yuklemek icin denetim yetkisi gerekir')
      }
      /* org_id ve tasari_id her satira ZORLA yazilir: istemci gondermis olsa
         bile ezilir. tasari_id yalnizca damgalanan tablolara eklenir - ortak
         kutuphane tablolarinda o sutun YOKTUR, eklenirse yazma "column does not
         exist" ile patlardi. */
      const govde = (table === 'audit_log' && !g.yedek) ? damgala(rows, claims) : rows
      const damga = tasariDamgalanir(table) ? { org_id: org, tasari_id: tasari } : { org_id: org }
      const satirlar = govde.map(r => ({ ...r, ...damga }))
      const { error } = op === 'insert'
        ? await q.insert(satirlar)
        : await q.upsert(satirlar, { onConflict: cakismaHedefi(table) })
      if (error) throw error
      res.status(200).json({ ok: true, n: satirlar.length })
      return
    }

    if (op === 'update') {
      if (!g.eq || !ESLESME_SUTUNLARI.has(g.eq.col)) return hata(res, 400, 'Gecersiz eslesme')
      if (!g.patch || typeof g.patch !== 'object') return hata(res, 400, 'Gecersiz guncelleme')
      /* org_id ve tasari_id guncellenemez: bir kaydi baska organizasyona ya da
         baska projeye tasimak bu uctan yapilamaz. Yapilabilseydi, tek bir
         'update' istegiyle bir tasarinin butun siparisleri digerine gecirilebilir
         ve bu hicbir yerde silme/ekleme olarak gorunmezdi. */
      const yama = { ...g.patch }
      delete yama.org_id
      delete yama.tasari_id
      const { error } = await kapsa(q.update(yama).eq(g.eq.col, g.eq.val))
      if (error) throw error
      res.status(200).json({ ok: true })
      return
    }

    if (op === 'delete') {
      // ORG VE TASARI FILTRESI HER DALDA: 'all' dahil hicbir silme kendi
      // organizasyonunun - ve is verisi tablolarinda kendi PROJESININ - disina
      // cikamaz. Eskiden 'all' tabloyu komple bosaltiyordu; cok kiracili yapida
      // bu, bir sirketin yoneticisinin TUM sirketlerin verisini silmesi demek
      // olurdu. Tasari katmaniyla birlikte ayni koruma projeler arasinda da
      // gecerli: AKKUYU NGS'de "Tumunu Sil" diyen kisi ikinci projenin
      // siparislerine dokunamaz.
      // Bu filtreler tek basina gecerli bir silme kosuludur: 'all' bu haliyle
      // "bu projenin tum satirlari" demektir, tablonun tamami degil.
      let d = kapsa(q.delete())
      if (!g.all) {
        if (g.in) {
          if (!ESLESME_SUTUNLARI.has(g.in.col)) return hata(res, 400, 'Izin verilmeyen eslesme sutunu')
          if (!Array.isArray(g.in.vals) || !g.in.vals.length) return hata(res, 400, 'Deger listesi bos')
          if (g.in.vals.length > MAX_SATIR) return hata(res, 400, 'Tek istekte en fazla ' + MAX_SATIR + ' kayit')
          d = d.in(g.in.col, g.in.vals)
        } else if (g.eq) {
          if (!ESLESME_SUTUNLARI.has(g.eq.col)) return hata(res, 400, 'Izin verilmeyen eslesme sutunu')
          d = d.eq(g.eq.col, g.eq.val)
        } else {
          // eslesmesiz silme = tum organizasyonu silme; kazara olmasin diye acikca reddedilir
          return hata(res, 400, 'Silme kosulu belirtilmedi')
        }
      }
      const { error } = await d
      if (error) throw error
      /* SILME KAYDI SUNUCUDA TUTULUR. Tarayicidaki logAction atlanabilir (konsol)
         ve zaten yalnizca bir kisim silmenin yaninda cagriliyor; en yikici islemin
         izi gonulluluge birakilamaz. Kayit sonuca YAZILIR, denemeye degil: hata
         alan silme loga dusmez. audit_log'un kendi silinmesi disarida - o zaten
         'Denetim kaydi temizlendi' olarak ayrica kaydediliyor, cift yazilmasin. */
      if (table !== 'audit_log') {
        const ad = TABLO_ADI[table] || table
        const kac = g.all ? 'TUMU' : (g.in ? g.in.vals.length + ' kayit' : '1 kayit')
        const hedef = g.all ? '' : (g.in ? '' : ' (' + g.eq.col + ': ' + g.eq.val + ')')
        await denetimYaz(org, {
          user: claims.username, role: claims.role,
          action: g.all ? 'wipe' : 'delete',
          detail: ad + ' silindi - ' + kac + hedef,
          // Hangi projede silindigi kayda gecer: denetim kaydi tasariya gore
          // filtrelenmedigi icin, damga olmadan "hangi projenin binasi silindi"
          // sorusunun cevabi kaybolurdu.
          tasari: tasariFiltrelenir(table) ? tasari : '',
        })
      }
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
