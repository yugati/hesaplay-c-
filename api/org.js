import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth, signSession, SESSION_TTL_DEFAULT, SESSION_TTL_REMEMBER } from '../lib/auth.js'
import { aktifOrg, orgIdGecerli, VARSAYILAN_ORG } from '../lib/org.js'
import { tasariIdGecerli, tasariCoz, TASIYAN_AYARLAR } from '../lib/tasari.js'
import { denetimYaz } from '../lib/denetim.js'

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZASYON UCU
//
// GET  /api/org                              -> { orgs, aktif, super, tasarilar, aktifTasari }
// POST /api/org  { op:'gecis', org }         -> { token, org, tasari, ttl }  (yalnizca super)
// POST /api/org  { op:'yeni', id, ad }       -> { org }                      (yalnizca super)
// POST /api/org  { op:'silOnizle', org }     -> { org, ad, tablolar, tasari, dosya } (yalnizca super)
// POST /api/org  { op:'sil', org, onay }     -> { ok, ...ozet }              (yalnizca super, GERI ALINAMAZ)
// POST /api/org  { op:'tasariGecis', tasari} -> { token, tasari, ad, ttl }   (HERKES)
// POST /api/org  { op:'tasariYeni', id, ad } -> { tasari }                   (yalnizca admin)
//
// NEDEN AYRI BIR UC: 'organizations' ve 'tasarilar' tablolari bilerek /api/veri
// beyaz listesinde degil. Oradan erisilebilseydi herhangi bir kullanici kendi
// kiraci kaydini duzenleyebilir, yeni kiraci uydurabilir ya da kendini baska
// bir projeye tasiyabilirdi.
//
// NEDEN TASARI DA BURADA (ayri bir api/tasari.js degil): Vercel Hobby planinda
// api/ altinda en fazla 12 fonksiyon calisabiliyor ve bugun 11 tanesi dolu.
// Ayri dosya son slotu yer, sonraki ozellik sessizce deploy hatasina duserdi
// (bkz. commit e99c02e - ayni sinir yuzunden uclar birlestirilmisti). Ikisi
// zaten ayni isi yapiyor: "hangi kapsamdayim" sorusunu yoneten tek kapi.
//
// GECIS TOKENI YENIDEN IMZALAR. Aktif organizasyonu/tasariyi istemcide bir
// degiskende tutup her istekte gondermek, o degiskeni degistiren herkese butun
// sirketlerin ve projelerin verisini acmak demekti. Imzali tokende duran bir
// iddiayi ise kullanici degistiremez - sunucu her istekte ayni tek kaynaga
// bakar (bkz. lib/org.js ve lib/tasari.js).
//
// KIM NE YAPABILIR:
//   Organizasyon degistir / olustur : yalnizca super yonetici (users.is_super)
//   Tasari degistir                 : organizasyondaki HERKES (alinan karar) -
//     tasari secimi bir yetki sinir degil, bir gezinti hareketidir. Modul
//     yetkileri her tasarida aynen uygulanir.
//   Tasari olustur                  : yalnizca YONETICI (role==='admin').
//     Gecis gezinti, ama YENI PROJE ACMAK yapisal bir karardir: her acilan
//     tasari kalici bir kapsamdir ve saha personelinin kazara "Yeni Tasari"ya
//     basip verisini bos bir projeye girmeye baslamasi, geri alinmasi en zor
//     hatalardan biri olurdu.
//
// YENI ORGANIZASYON BOMBOS DOGAR: hicbir tanim, sartname ya da kutuphane
// kopyalanmaz (alinan karar). Yeni sirket kendi verisini bastan girer.
//
// YENI TASARI ise KUTUPHANEYI HAZIR BULUR: malzeme kunyesi, sirketler ve alet
// kunyesi organizasyon genelinde ortaktir, tasariya bagli degildir (bkz.
// lib/tasari.js ORTAK_TABLOLAR). Yalnizca IS VERISI bos dogar: sartname,
// siparis, bina, bolum, rapor, saha, tutanak, fatura.
// ─────────────────────────────────────────────────────────────────────────────

/* ORGANIZASYON KALDIRMA - org_id tasiyan HER tablo. api/veri.js'teki TABLOLAR
   (28 veri tablosu) + yalnizca sunucunun yonettigi uc tablo. Yeni bir veri
   tablosu eklenince buraya da yazilmali; yazilmazsa kaldirilan organizasyonun
   o tablodaki satirlari sahipsiz kalir (zarari yok ama yer tutar).
   tasarilar ve organizations BU LISTEDE YOK: en son, ayri silinirler - yarida
   kalan bir kaldirmada organizasyon listede kalsin ve tekrar denenebilsin. */
const ORG_TABLOLARI = [
  'companies', 'tutanaklar', 'alet_items', 'alet_lib',
  'saha_panels', 'saha_lines', 'saha_sockets',
  'rapor_entries', 'gecici_lib', 'gecici_moves', 'gecici_orders',
  'proje_sartnames', 'proje_materials', 'proje_specs', 'proje_items',
  'proje_orders', 'proje_alternatives', 'proje_bina_modelleri', 'proje_lokasyonlar',
  'gunluk_isler', 'ihtiyac_listeleri', 'faturalar', 'katalog', 'audit_log',
  'app_settings', 'saha_settings', 'rapor_ekipler', 'proje_buildings', 'proje_sections',
  'invites', 'users',
]
// Dosyalar '<org>/...' onekiyle bu iki kovada durur (bkz. api/dosya.js)
const ORG_KOVALARI = ['belgeler', 'bina-modelleri']

/* Kovada '<org>/' altindaki butun dosya yollari. Storage listesi ozyinelemeli
   degil: klasorler (id'si null olan girdiler) tek tek acilir. */
async function kovaDosyalari(kova, onek) {
  const yollar = []
  const kuyruk = [onek]
  while (kuyruk.length) {
    const klasor = kuyruk.shift()
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin.storage.from(kova).list(klasor, { limit: 1000, offset })
      if (error) throw error
      for (const g of data || []) {
        const yol = klasor + '/' + g.name
        if (g.id) yollar.push(yol); else kuyruk.push(yol)
      }
      if (!data || data.length < 1000) break
    }
  }
  return yollar
}

/* Kaldirilacak organizasyonun dokumu: tablo basina satir sayisi + kova basina
   dosyalar. Onizleme ve silme AYNI dokumu kullanir - ekranda gorulen ile
   silinen birbirini tutsun diye. */
async function orgDokumu(hedef) {
  const tablolar = await Promise.all(ORG_TABLOLARI.map(async t => {
    const { count, error } = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true }).eq('org_id', hedef)
    // Tablo bu kurulumda yoksa (ör. migration'i hic calismamis) atlanir
    return { tablo: t, adet: error ? 0 : (count || 0), yok: !!error }
  }))
  const { count: tasariAdet } = await supabaseAdmin.from('tasarilar').select('*', { count: 'exact', head: true }).eq('org_id', hedef)
  const kovalar = await Promise.all(ORG_KOVALARI.map(async k => ({ kova: k, yollar: await kovaDosyalari(k, hedef) })))
  return { tablolar, tasariAdet: tasariAdet || 0, kovalar }
}

function orgSatiri(r) {
  return { id: r.id, ad: (r.data && r.data.ad) || r.id, aktif: r.aktif !== false }
}
// tasarilar tablosu organizations ile ayni desende (id + data{ad}) - ayni okuyucu.
const tasariSatiri = orgSatiri

/* Ad -> kimlik. Istemcideki orgKimlikOner'in (index.html) sunucu tarafi
   karsiligi: kullanici kimligi elle girmek zorunda kalmasin diye tasari adindan
   turetilir, ama son soz SUNUCUNUNDUR - kimlik tokende geciyor. */
/* Turkce harfler ONCE karsiliklarina cevrilir, sonra daraltma yapilir. Sira
   onemli: once daraltilsaydi 'SINOP NGS' -> 's-nop-ngs' olurdu (I noktasi ayri
   bir karakter). Istemcideki orgKimlikOner ile AYNI tablo - iki taraf ayni
   kimligi uretmeli, yoksa kullanicinin ekranda gordugu oneri ile sunucunun
   kaydettigi kimlik birbirini tutmaz. */
function kimlikTuret(ad) {
  const tr = {
    '\u00E7': 'c', '\u00C7': 'c', '\u011F': 'g', '\u011E': 'g',
    '\u0131': 'i', '\u0049': 'i', '\u0130': 'i', '\u00F6': 'o', '\u00D6': 'o',
    '\u015F': 's', '\u015E': 's', '\u00FC': 'u', '\u00DC': 'u',
  }
  return String(ad || '')
    .replace(/[\u00E7\u00C7\u011F\u011E\u0131\u0049\u0130\u00F6\u00D6\u015F\u015E\u00FC\u00DC]/g, c => tr[c])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31)
}

export default async function handler(req, res) {
  const claims = await requireAuth(req)
  if (!claims) { res.status(401).json({ error: 'Oturum gecersiz' }); return }

  const org = await aktifOrg(claims)

  if (req.method === 'GET') {
    try {
      /* TASARI LISTESI HERKESE ACIKTIR - organizasyon listesinin aksine.
         Gerekce: kullanici zaten hepsinin arasinda gecebiliyor (alinan karar),
         gorebildigi bir listeyi gizlemek yalnizca secici dugmeyi bozardi.
         Liste KENDI organizasyonuyla sinirli: baska sirketin proje adlari
         sizmaz. */
      const { data: tData, error: tErr } = await supabaseAdmin
        .from('tasarilar').select('id, data, aktif').eq('org_id', org)
        .order('created_at', { ascending: true })
      if (tErr) throw tErr
      const tasarilar = (tData || []).filter(r => r.aktif !== false).map(tasariSatiri)
      // user parametresi yok: tokendeki tasari zaten 'aday' olarak veriliyor,
      // gecersizse dogru cevap organizasyonun ilk tasarisidir.
      const aktifTasari = await tasariCoz(org, claims.tas, null)

      /* Super olmayan kullanici YALNIZCA kendi organizasyonunu gorur. Tam listeyi
         donmek, degistirici dugmeyi gizlesek bile sirket adlarini sizdirirdi. */
      let sorgu = supabaseAdmin.from('organizations').select('id, data, aktif')
      if (!claims.sup) sorgu = sorgu.eq('id', org)
      const { data, error } = await sorgu.order('id', { ascending: true })
      if (error) throw error
      const orgs = (data || []).filter(r => claims.sup ? r.aktif !== false : true).map(orgSatiri)
      res.status(200).json({
        orgs, aktif: org, super: !!claims.sup,
        tasarilar, aktifTasari,
        // Yeni tasari acma dugmesi yalnizca yoneticide gorunur; sunucu da oyle
        // davranir (asagidaki op:'tasariYeni'). Istemci bunu gizlemek icin okur.
        tasariYonetici: claims.role === 'admin',
      })
    } catch (e) {
      console.error('org GET basarisiz', e)
      res.status(500).json({ error: 'Sunucu hatasi' })
    }
    return
  }

  if (req.method === 'POST') {
    const { op } = req.body || {}
    const GECERLI = ['gecis', 'yeni', 'silOnizle', 'sil', 'tasariGecis', 'tasariYeni']
    if (!GECERLI.includes(op)) { res.status(400).json({ error: 'Bilinmeyen islem' }); return }

    /* YETKI KAPISI ISLEME GORE AYRILIR - hepsi super istemez:
         gecis / yeni    -> organizasyon islemleri, super yoneticiye ozel
         tasariGecis     -> herkes (yalnizca oturum gerekir)
         tasariYeni      -> yonetici
       Eskiden burada tek bir 'if (!claims.sup)' vardi; tasari islemleri o
       kapinin ardinda kalsaydi organizasyondaki hicbir normal kullanici proje
       degistiremezdi. */
    if ((op === 'gecis' || op === 'yeni' || op === 'silOnizle' || op === 'sil') && !claims.sup) {
      res.status(403).json({ error: 'Yetkiniz yok' }); return
    }
    if (op === 'tasariYeni' && claims.role !== 'admin') {
      res.status(403).json({ error: 'Yeni tasari acmak icin yonetici olmalisiniz' }); return
    }

    /* ─────────────────────────────────────────────────────────────────────
       TASARI GECISI - organizasyondaki herkese acik.
       Token yeniden imzalanir; org gecisiyle ayni desen. Hedef tasarinin KENDI
       organizasyonunda oldugu sunucuda dogrulanir (sorgu org_id suzuyor) -
       aksi halde kullanici baska sirketin proje kimligini gonderip oraya
       gecebilirdi.
       ───────────────────────────────────────────────────────────────────── */
    if (op === 'tasariGecis') {
      const hedef = (req.body || {}).tasari
      if (!tasariIdGecerli(hedef)) { res.status(400).json({ error: 'Gecersiz tasari' }); return }
      try {
        const { data: user, error: uErr } = await supabaseAdmin
          .from('users').select('*').eq('id', claims.sub).maybeSingle()
        if (uErr) throw uErr
        if (!user) { res.status(401).json({ error: 'Kullanici bulunamadi' }); return }

        const { data: t, error: tErr } = await supabaseAdmin
          .from('tasarilar').select('id, data, aktif').eq('org_id', org).eq('id', hedef).maybeSingle()
        if (tErr) throw tErr
        if (!t || t.aktif === false) { res.status(404).json({ error: 'Tasari bulunamadi' }); return }

        // Kalan omur korunur: tasari degistirmek "Beni Hatirla" ile acilmis uzun
        // oturumu 1 saate dusurmesin (api/me.js ve org gecisiyle ayni olcut).
        const kalanMs = claims.exp ? (claims.exp * 1000 - Date.now()) : 0
        const ttl = kalanMs > SESSION_TTL_DEFAULT ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT

        res.status(200).json({
          token: signSession(user, ttl, org, t.id),
          tasari: t.id, ad: tasariSatiri(t).ad, ttl,
        })
      } catch (e) {
        console.error('tasari gecis basarisiz', e)
        res.status(500).json({ error: 'Sunucu hatasi' })
      }
      return
    }

    /* ─────────────────────────────────────────────────────────────────────
       YENI TASARI - yalnizca yonetici.
       Tasari AKTIF ORGANIZASYONDA acilir; istemci org gonderemez.
       ───────────────────────────────────────────────────────────────────── */
    if (op === 'tasariYeni') {
      const isim = String((req.body || {}).ad || '').trim()
      if (!isim || isim.length > 60) { res.status(400).json({ error: 'Tasari adi gerekli (en fazla 60 karakter)' }); return }
      const id = String((req.body || {}).id || '').trim() || kimlikTuret(isim)
      if (!tasariIdGecerli(id)) {
        res.status(400).json({ error: 'Kimlik yalnizca kucuk harf, rakam ve tire icerebilir (ornek: sinop-ngs)' }); return
      }

      try {
        const { error } = await supabaseAdmin
          .from('tasarilar').insert([{ org_id: org, id, data: { ad: isim } }])
        if (error) {
          if (error.code === '23505') { res.status(409).json({ error: 'Bu kimlikte bir tasari zaten var' }); return }
          throw error
        }

        /* MIGRATION BAYRAKLARI VE MARKA LISTESI YENI TASARIYA KOPYALANIR.
           app_settings tasari ozeldir, yani yeni tasari BOS bir ayar tablosuyla
           dogar. Bu, iki sorun uretirdi:
             1) Istemcinin "eski veriyi tasima" rutinleri bayragi gormeyip
                YENIDEN calisir; bazilari ORTAK kutuphaneye (proje_materials)
                dokundugu icin diger tasarinin kunyesini bozabilirdi.
             2) Marka listesi malzeme kunyesinin parcasidir ve kunye ortak kaldi -
                markasiz dogan tasari, ortak kutuphanedeki malzemelerin markasini
                cozemezdi.
           Kopyalama YALNIZCA kurulusta bir kez yapilir; sonrasinda iki tasarinin
           listeleri bagimsizdir. Basarisiz olursa tasari yine de acilir (uyari
           basilir): yarim kalan bir ayar kopyasi, acilmayan bir projeden iyidir. */
        try {
          const kaynakTasari = await tasariCoz(org, claims.tas, null)
          const { data: ayarlar } = await supabaseAdmin
            .from('app_settings').select('key, value').eq('org_id', org).eq('tasari_id', kaynakTasari)
          const kopya = (ayarlar || [])
            .filter(a => TASIYAN_AYARLAR.has(a.key))
            .map(a => ({ org_id: org, tasari_id: id, key: a.key, value: a.value }))
          if (kopya.length) await supabaseAdmin.from('app_settings').insert(kopya)
        } catch (e) {
          console.warn('tasari: ayar kopyalanamadi:', e && e.message)
        }

        res.status(201).json({ tasari: { id, ad: isim, aktif: true } })
      } catch (e) {
        console.error('tasari yeni basarisiz', e)
        res.status(500).json({ error: 'Sunucu hatasi' })
      }
      return
    }

    if (op === 'yeni') {
      const { id, ad } = req.body || {}
      /* Kimlik kurallari lib/org.js'te: kucuk harf/rakam/tire, 'siparis' gibi
         DOSYA YOLU parcalariyla cakisamaz. Bu dar liste kazara degil - org kimligi
         hem imzali tokende hem depolama yolunda geciyor. */
      if (!orgIdGecerli(id)) {
        res.status(400).json({ error: 'Kimlik yalnizca kucuk harf, rakam ve tire icerebilir (ornek: yuem)' }); return
      }
      const isim = String(ad || '').trim()
      if (!isim || isim.length > 60) { res.status(400).json({ error: 'Organizasyon adi gerekli (en fazla 60 karakter)' }); return }

      try {
        const { error } = await supabaseAdmin.from('organizations').insert([{ id, data: { ad: isim } }])
        if (error) {
          if (error.code === '23505') { res.status(409).json({ error: 'Bu kimlikte bir organizasyon zaten var' }); return }
          throw error
        }
        /* HER ORGANIZASYON EN AZ BIR TASARIYLA DOGAR. Tasarisiz bir organizasyona
           gecildiginde aktif tasari cozulemez ve VARSAYILAN_TASARI'ya ('akkuyu-ngs')
           duserdi - yani BASKA bir organizasyonun proje kimligine. O kimlikle
           yazilan her satir hicbir yerde gorunmeyen bir kapsamda kalirdi.
           Ilk tasari organizasyonla ayni adi tasir; yonetici sonradan kendi
           projelerini acar. Bu insert basarisiz olursa organizasyon da geri
           alinir: tasarisiz bir organizasyon kullanilamaz durumdadir. */
        const ilkTasariId = kimlikTuret(isim) || 'proje-1'
        const { error: tErr } = await supabaseAdmin
          .from('tasarilar').insert([{ org_id: id, id: ilkTasariId, data: { ad: isim } }])
        if (tErr) {
          await supabaseAdmin.from('organizations').delete().eq('id', id)
          console.error('org yeni: ilk tasari acilamadi, organizasyon geri alindi', tErr)
          res.status(500).json({ error: 'Organizasyon olusturulamadi (tasari acilamadi)' }); return
        }

        // Denetim kaydi ACAN organizasyona yazilir: yeni organizasyonun kaydini
        // okuyacak kimse yok, "bunu kim acti" sorusu buradan sorulur.
        await denetimYaz(org, { user: claims.username, role: claims.role, action: 'org',
          detail: `Organizasyon olusturuldu: ${isim} (${id})` })

        // Organizasyon BOS dogar; ilk kullanicisi Kullanicilar ekranindan, o
        // organizasyona GECILDIKTEN sonra acilir (api/users.js aktif org'a yazar).
        res.status(201).json({ org: { id, ad: isim, aktif: true }, tasari: { id: ilkTasariId, ad: isim, aktif: true } })
      } catch (e) {
        console.error('org yeni basarisiz', e)
        res.status(500).json({ error: 'Sunucu hatasi' })
      }
      return
    }

    /* ─────────────────────────────────────────────────────────────────────
       ORGANIZASYON KALDIRMA - yalnizca super yonetici, iki adim:
         silOnizle -> neyin silinecegini sayar, HICBIR SEY SILMEZ
         sil       -> govdede onay: '<kimlik>' ister (ekranda elle yazilir)
       GERI ALINAMAZ: organizasyonun butun satirlari, kullanicilari, davetleri,
       tasarilari ve kovadaki dosyalari silinir.
       KALDIRILAMAYANLAR:
         - su an ICINDE bulunulan organizasyon (once baska birine gecilir)
         - kullanicinin KENDI organizasyonu (kendini disarida birakirdi)
         - VARSAYILAN_ORG: oneksiz eski dosyalar ve org iddiasi tasimayan eski
           tokenler tanimi geregi ona duser (bkz. lib/org.js, api/dosya.js)
       ───────────────────────────────────────────────────────────────────── */
    if (op === 'silOnizle' || op === 'sil') {
      const hedef = (req.body || {}).org
      if (!orgIdGecerli(hedef)) { res.status(400).json({ error: 'Gecersiz organizasyon' }); return }
      try {
        // Bayrak kayittan da dogrulanir - gecis ile ayni gerekce (asagida)
        const { data: user, error: uErr } = await supabaseAdmin
          .from('users').select('id, username, role, org_id, is_super').eq('id', claims.sub).maybeSingle()
        if (uErr) throw uErr
        if (!user || !user.is_super) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

        if (hedef === VARSAYILAN_ORG) { res.status(400).json({ error: 'Ana organizasyon kaldirilamaz' }); return }
        if (hedef === org) { res.status(400).json({ error: 'Icinde bulundugunuz organizasyon kaldirilamaz - once baska bir organizasyona gecin' }); return }
        if (hedef === user.org_id) { res.status(400).json({ error: 'Kendi hesabinizin bagli oldugu organizasyon kaldirilamaz' }); return }

        const { data: o, error: oErr } = await supabaseAdmin
          .from('organizations').select('id, data').eq('id', hedef).maybeSingle()
        if (oErr) throw oErr
        if (!o) { res.status(404).json({ error: 'Organizasyon bulunamadi' }); return }
        const ad = orgSatiri(o).ad

        const dokum = await orgDokumu(hedef)
        const ozet = {
          org: hedef, ad,
          tablolar: dokum.tablolar.filter(t => t.adet > 0).map(t => ({ tablo: t.tablo, adet: t.adet })),
          tasari: dokum.tasariAdet,
          dosya: dokum.kovalar.reduce((s, k) => s + k.yollar.length, 0),
        }
        if (op === 'silOnizle') { res.status(200).json(ozet); return }

        if ((req.body || {}).onay !== hedef) {
          res.status(400).json({ error: 'Onay icin organizasyon kimligini aynen yazin' }); return
        }

        // 1) Dosyalar - once, cunku satirlar silinince yollarini veren kayit kalmaz
        for (const k of dokum.kovalar) {
          for (let i = 0; i < k.yollar.length; i += 100) {
            const { error } = await supabaseAdmin.storage.from(k.kova).remove(k.yollar.slice(i, i + 100))
            if (error) throw error
          }
        }
        // 2) Veri tablolari, kullanicilar, davetler
        const sonuc = await Promise.all(dokum.tablolar.filter(t => !t.yok).map(async t => {
          const { error } = await supabaseAdmin.from(t.tablo).delete().eq('org_id', hedef)
          return error ? t.tablo + ': ' + error.message : null
        }))
        const hatalar = sonuc.filter(Boolean)
        if (hatalar.length) {
          // Organizasyon kaydi SILINMEDI: listede kalir, islem tekrar denenebilir
          console.error('org sil: yarida kaldi', hatalar)
          res.status(500).json({ error: 'Bazi tablolar silinemedi, organizasyon yerinde birakildi: ' + hatalar.join('; ') }); return
        }
        // 3) En son tasarilar ve organizasyonun kendisi
        const { error: tErr } = await supabaseAdmin.from('tasarilar').delete().eq('org_id', hedef)
        if (tErr) throw tErr
        const { error: dErr } = await supabaseAdmin.from('organizations').delete().eq('id', hedef)
        if (dErr) throw dErr

        const satir = ozet.tablolar.reduce((s, t) => s + t.adet, 0)
        await denetimYaz(org, { user: user.username, role: user.role, action: 'org',
          detail: `Organizasyon kaldirildi: ${ad} (${hedef}) - ${satir} satir, ${ozet.tasari} tasari, ${ozet.dosya} dosya silindi` })
        res.status(200).json({ ok: true, ...ozet })
      } catch (e) {
        console.error('org sil basarisiz', e)
        res.status(500).json({ error: 'Sunucu hatasi' })
      }
      return
    }

    const hedef = (req.body || {}).org
    if (!orgIdGecerli(hedef)) { res.status(400).json({ error: 'Gecersiz organizasyon' }); return }

    try {
      /* Bayrak TOKENDEN degil KAYITTAN da dogrulanir: super yetkisi geri alinmis
         bir kullanicinin elinde eski tokeni 20 dakikaya kadar gecerli kalabilir -
         bu sure boyunca organizasyon degistirebilmesi dogru olmazdi. */
      const { data: user, error: uErr } = await supabaseAdmin
        .from('users').select('*').eq('id', claims.sub).maybeSingle()
      if (uErr) throw uErr
      if (!user) { res.status(401).json({ error: 'Kullanici bulunamadi' }); return }
      if (!user.is_super) { res.status(403).json({ error: 'Yetkiniz yok' }); return }

      const { data: o, error: oErr } = await supabaseAdmin
        .from('organizations').select('id, data, aktif').eq('id', hedef).maybeSingle()
      if (oErr) throw oErr
      if (!o || o.aktif === false) { res.status(404).json({ error: 'Organizasyon bulunamadi' }); return }

      // Kalan omur korunur: gecis yapmak "Beni Hatirla" ile acilmis uzun oturumu
      // 1 saate dusurmesin (api/me.js ile ayni olcut).
      const kalanMs = claims.exp ? (claims.exp * 1000 - Date.now()) : 0
      const ttl = kalanMs > SESSION_TTL_DEFAULT ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT

      /* HEDEF ORGANIZASYONUN TASARISI DA COZULUR. Kullanicinin elindeki tasari
         kimligi ESKI organizasyonun projesidir; tasari kimlikleri organizasyon
         icinde benzersiz oldugu icin yeni organizasyonda karsiligi yoktur.
         Eski kimlikle imzalanmis bir token, hicbir satirin eslesmedigi BOMBOS
         bir uygulama demek olurdu - kullanici organizasyonu degistirdiginde
         "veri kayboldu" diye bakardi. */
      const hedefTasari = await tasariCoz(o.id, null, user)
      res.status(200).json({
        token: signSession(user, ttl, o.id, hedefTasari),
        org: o.id, ad: orgSatiri(o).ad, tasari: hedefTasari, ttl,
      })
    } catch (e) {
      console.error('org gecis basarisiz', e)
      res.status(500).json({ error: 'Sunucu hatasi' })
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
