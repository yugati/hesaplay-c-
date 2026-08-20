import { supabaseAdmin } from './supabaseAdmin.js'

// ─────────────────────────────────────────────────────────────────────────────
// GIRIS KORUMASI - kaba kuvvet engeli (Asama 4)
//
// Asama 3'ten sonra veriye tek yol /api/*; yani TEK KAPI giris ekrani. Onceden
// /api/login'de hicbir deneme siniri yoktu - kullanici adini bilen biri sinirsiz
// sifre deneyebiliyordu. Burasi basarisiz denemeleri sayip gecici kilit uygular.
//
// IKI ANAHTAR birlikte sayilir:
//   u:<kullanici> - belli bir hesabi hedefleyen saldiri
//   ip:<adres>    - farkli kullanici adlari deneyerek dolasan saldiri
// Hangisi once dolarsa kilit o zaman baslar.
//
// KULLANICI ADI SIZDIRMAZ: sayac, kullanici var olsun olmasin ayni sekilde artar
// ve mesaj ayni kalir. Aksi halde "kilitlendi" cevabi gecerli kullanici adlarini
// ele verirdi.
//
// Durum Postgres'te tutulur (Vercel fonksiyonlari durumsuzdur; bellekteki sayac
// her cagrida sifirlanir ve olceklenince hic calismaz).
// ─────────────────────────────────────────────────────────────────────────────

const TABLO = 'giris_denemeleri'
// Kademeli kilit: ilk hatalar insan hatasi olabilir, israr eden yavaslar.
const KADEMELER = [
  { hata: 5, saniye: 60 },
  { hata: 8, saniye: 300 },
  { hata: 12, saniye: 1800 },
  { hata: 20, saniye: 7200 },
]
// Son hatadan bu kadar sonra sayac sifirlanir (durust kullanici cezali kalmasin)
const PENCERE_MS = 15 * 60 * 1000

export function istekIp(req) {
  const h = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || ''
  const ilk = String(h).split(',')[0].trim()
  return ilk || 'bilinmeyen'
}

function kilitSuresi(sayac) {
  let s = 0
  for (const k of KADEMELER) if (sayac >= k.hata) s = k.saniye
  return s
}

async function kayitOku(anahtarlar) {
  const { data, error } = await supabaseAdmin
    .from(TABLO).select('anahtar, sayac, son_hata, kilit_bitis').in('anahtar', anahtarlar)
  if (error) throw error
  return data || []
}

/* Kilitli mi? Kilitliyse {kilitli:true, kalanSn}. Tablo yoksa (SQL henuz
   calistirilmamis) koruma SESSIZCE devre disi kalir - giris kirilmasin. */
export async function girisKilitli(kullanici, ip) {
  try {
    const kayitlar = await kayitOku(['u:' + String(kullanici || '').toLowerCase(), 'ip:' + ip])
    const simdi = Date.now()
    let kalan = 0
    for (const k of kayitlar) {
      if (k.kilit_bitis) {
        const bitis = new Date(k.kilit_bitis).getTime()
        if (bitis > simdi) kalan = Math.max(kalan, Math.ceil((bitis - simdi) / 1000))
      }
    }
    return kalan > 0 ? { kilitli: true, kalanSn: kalan } : { kilitli: false }
  } catch (e) {
    console.warn('girisKoruma: kilit okunamadi (koruma atlandi):', e.message)
    return { kilitli: false }
  }
}

/* Basarisiz deneme kaydeder; gerekiyorsa kilit koyar.
   Donen: {sayac, kilitSn} - kilitSn>0 ise bu denemeyle kilit basladi. */
export async function hataliDeneme(kullanici, ip) {
  try {
    const anahtarlar = ['u:' + String(kullanici || '').toLowerCase(), 'ip:' + ip]
    const mevcut = await kayitOku(anahtarlar)
    const simdi = Date.now()
    const satirlar = []
    let enUzun = 0, enYuksek = 0
    for (const a of anahtarlar) {
      const k = mevcut.find(x => x.anahtar === a)
      // pencere disinda kalmis eski sayac sifirlanir
      const eski = (k && (simdi - new Date(k.son_hata).getTime()) < PENCERE_MS) ? k.sayac : 0
      const sayac = eski + 1
      const sn = kilitSuresi(sayac)
      enUzun = Math.max(enUzun, sn); enYuksek = Math.max(enYuksek, sayac)
      satirlar.push({
        anahtar: a, sayac,
        son_hata: new Date(simdi).toISOString(),
        kilit_bitis: sn ? new Date(simdi + sn * 1000).toISOString() : null,
      })
    }
    const { error } = await supabaseAdmin.from(TABLO).upsert(satirlar, { onConflict: 'anahtar' })
    if (error) throw error
    return { sayac: enYuksek, kilitSn: enUzun }
  } catch (e) {
    console.warn('girisKoruma: deneme kaydedilemedi:', e.message)
    return { sayac: 0, kilitSn: 0 }
  }
}

// Basarili giriste sayaclar temizlenir
export async function basariliGiris(kullanici, ip) {
  try {
    await supabaseAdmin.from(TABLO).delete()
      .in('anahtar', ['u:' + String(kullanici || '').toLowerCase(), 'ip:' + ip])
  } catch (e) {
    console.warn('girisKoruma: sayac temizlenemedi:', e.message)
  }
}
