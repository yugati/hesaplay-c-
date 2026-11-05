import { supabaseAdmin } from './supabaseAdmin.js'

// ─────────────────────────────────────────────────────────────────────────────
// GIRIS KIMLIGI — kullanici adi VEYA e-posta
//
// Giris ekrani ikisini de kabul eder (api/login.js). Bunun guvenli olmasi icin
// bir e-posta EN FAZLA BIR hesaba ait olmalidir: e-postayi yazan her yer
// (api/davet.js kayit, api/profil.js, api/users.js) once epostaKullanimda ile
// bakar. Eski kayitlarda ayni adres birden fazla hesapta duruyorsa o adresle
// giris yapilamaz (kullaniciBul null doner), kullanici adiyla giris surer.
// ─────────────────────────────────────────────────────────────────────────────

export const EPOSTA_KURAL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/* KENDI KENDINE KAYITTA kullanici adi kurali (yoneticinin actigi eski hesaplara
   uygulanmaz). '@' YASAK: kullanici adi bir e-posta gibi gorunurse giriste
   hangi hesabin kastedildigi belirsizlesirdi. */
export const KULLANICI_ADI_KURAL = /^[\p{L}\p{N}._-]{3,30}$/u

// ilike deseninde % ve _ joker karakterdir; "a_b@x.com" yazan "axb@x.com" ile eslesmesin
export function likeKacis(metin) {
  return String(metin || '').replace(/[\\%_]/g, '\\$&')
}

// Bu e-posta (buyuk-kucuk harf ayirmadan) baska bir hesapta kayitli mi?
export async function epostaKullanimda(email, haricId) {
  const adres = String(email || '').trim()
  if (!adres) return false
  let sorgu = supabaseAdmin.from('users').select('id').ilike('email', likeKacis(adres)).limit(1)
  if (haricId) sorgu = sorgu.neq('id', haricId)
  const { data, error } = await sorgu
  if (error) throw error
  return !!(data && data.length)
}

/* Giriste yazilan degerden kullaniciyi bulur. ONCE kullanici adi denenir
   (eski hesaplarda '@' iceren kullanici adi olabilir), bulunamazsa ve deger
   e-postaya benziyorsa e-posta. E-posta tam olarak TEK hesapla eslesmeli. */
export async function kullaniciBul(girdi) {
  const deger = String(girdi || '').trim()
  const { data: adla, error } = await supabaseAdmin
    .from('users').select('*').ilike('username', likeKacis(deger)).maybeSingle()
  if (error) throw error
  if (adla || !deger.includes('@')) return adla
  const { data: postayla, error: e2 } = await supabaseAdmin
    .from('users').select('*').ilike('email', likeKacis(deger)).limit(2)
  if (e2) throw e2
  return postayla && postayla.length === 1 ? postayla[0] : null
}
