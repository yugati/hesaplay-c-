import { supabaseAdmin } from './supabaseAdmin.js'

// ─────────────────────────────────────────────────────────────────────────────
// OTURUM SURUMU - "diger tum oturumlari kapat"in sunucu tarafi
//
// Token durumsuz bir JWT: sunucuda iptal edilecek bir kayit yok. Iptal, kullanici
// satirindaki 'oturum_surumu' sayacinin artmasiyla yapilir; her token imzalandigi
// andaki sayaci 'sv' olarak tasir, sayactan KUCUK sv'li token reddedilir
// (bkz. migration_oturum_surumu.sql).
//
// NEDEN ONBELLEK: /api/veri acilista ~60 istek alir ve bugune kadar hicbirinde
// kullanici tablosuna gidilmiyordu (bkz. lib/auth.js - yetkiler tokende). Her
// istekte sorgu atmak bu kazanci silerdi. Sayac kullanici basina ~30 sn
// onbellekte durur ve ayni anda gelen istekler TEK sorguyu paylasir. Bedeli:
// baska bir sunucu ornegindeki kapatma en gec 30 sn sonra etkili olur; kapatmayi
// yapan ornek kendi onbellegini hemen gunceller (surumBelirle).
//
// HATADA ACIK KALIR: sorgu basarisiz olursa (sutun henuz eklenmemis, Supabase'e
// ulasilamiyor) ya da kullanici satiri yoksa oturum GECERLI sayilir. Aksi halde
// gecici bir veritabani sorunu herkesi disari atardi - koruma ek bir katmandir,
// tek kapi degil (giris zaten sifreyle korunuyor; bkz. lib/girisKoruma.js ayni durus).
// ─────────────────────────────────────────────────────────────────────────────

const ONBELLEK_MS = 30 * 1000
const onbellek = new Map() // kullaniciId -> { p: Promise<number|null>, bitis }

// Guncel sayac; bilinmiyorsa null (sutun yok / sorgu hatasi / kullanici yok)
export function guncelSurum(kullaniciId) {
  const k = onbellek.get(kullaniciId)
  if (k && k.bitis > Date.now()) return k.p
  const p = (async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('users').select('oturum_surumu').eq('id', kullaniciId).maybeSingle()
      if (error) throw error
      return data ? (Number(data.oturum_surumu) || 0) : null
    } catch (e) {
      console.warn('oturum: sayac okunamadi (kontrol atlandi):', e && e.message)
      return null
    }
  })()
  onbellek.set(kullaniciId, { p, bitis: Date.now() + ONBELLEK_MS })
  return p
}

// Kapatmayi yapan ornek yeni sayaci hemen bilsin - kendi istegini reddetmesin
export function surumBelirle(kullaniciId, surum) {
  onbellek.set(kullaniciId, { p: Promise.resolve(surum), bitis: Date.now() + ONBELLEK_MS })
}

/* Bir kullanicinin TUM acik oturumlarini kapatir (sayaci 1 arttirir). Yeni sayaci
   dondurur; sutun henuz yoksa ya da islem basarisiz olursa null - cagiran islemi
   (orn. sifre sifirlama) bu yuzden ASLA basarisiz saymaz. Yalnizca sayac-sonrasi
   adim gereken yerler icin; sifrenin kendisiyle ayni guncellemede artirilabilen
   yerde (api/profil.js) sayac dogrudan o guncellemeye yazilir. */
export async function oturumlariKapat(kullaniciId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('users').select('oturum_surumu').eq('id', kullaniciId).maybeSingle()
    if (error) throw error
    if (!data) return null
    const yeni = (Number(data.oturum_surumu) || 0) + 1
    const { error: uErr } = await supabaseAdmin.from('users').update({ oturum_surumu: yeni }).eq('id', kullaniciId)
    if (uErr) throw uErr
    surumBelirle(kullaniciId, yeni)
    return yeni
  } catch (e) {
    console.warn('oturum: oturumlar kapatilamadi (migration_oturum_surumu.sql calistirilmamis olabilir):', e && e.message)
    return null
  }
}

// sv tasimayan (sutundan ONCE imzalanmis) tokenler 0 sayilir - sayac de 0'dan baslar
export async function oturumAcikMi(claims) {
  const sv = Number(claims && claims.sv) || 0
  const guncel = await guncelSurum(claims.sub)
  return guncel === null || sv >= guncel
}
