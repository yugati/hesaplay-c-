/* BIRIM SOZLUGU - sunucu kopyasi (Saha Linki hesapsiz sayfaya birimi basar).
   Istemci asli index.html'de (BRM_VARSAYILAN / birimTanim / birimAd); kurallar ayni:
   - kayitta anahtar ('adet') ya da eski serbest yazim ("шт. / pcs") olabilir,
   - yazim once tam, sonra "/" parcalariyla sozlukte aranir; Kiril benzeri harfler Latin'e katlanir,
   - sozlukte yoksa yazim oldugu gibi doner.
   Kullanici sozlugu app_settings 'birim_sozlugu' (tasari geneli ortak, lib/birim.js ORTAK_AYARLAR);
   bos/yoksa asagidaki varsayilan. Iki kopya birlikte degistirilmelidir. */
import { supabaseAdmin } from './supabaseAdmin.js'
import { ORTAK_BIRIM } from './birim.js'

export const BRM_AYAR = 'birim_sozlugu'
export const BRM_DILLER = ['TR', 'RU', 'EN']
export const BRM_VARSAYILAN = [
  { k: 'adet', TR: 'ad.', RU: 'шт.', EN: 'pcs.', es: ['adet', 'ad', 'adt', 'pc', 'pcs', 'piece', 'pieces', 'ea', 'each', 'шт', 'штука', 'штук'] },
  { k: 'metre', TR: 'm', RU: 'м', EN: 'm', es: ['mt', 'metre', 'meter', 'метр', 'м', 'пм', 'п.м', 'п/м', 'мп', 'mtul'] },
  { k: 'kg', TR: 'kg', RU: 'кг', EN: 'kg', es: ['kilogram', 'кг'] },
  { k: 'm2', TR: 'm²', RU: 'м²', EN: 'm²', es: ['m2', 'м2', 'metrekare', 'sqm', 'кв.м'] },
  { k: 'm3', TR: 'm³', RU: 'м³', EN: 'm³', es: ['m3', 'м3', 'metrekup', 'cbm', 'куб.м'] },
  { k: 'litre', TR: 'lt', RU: 'л', EN: 'l', es: ['litre', 'liter', 'л'] },
  { k: 'takim', TR: 'tk.', RU: 'компл.', EN: 'set', es: ['takim', 'set', 'kit', 'tk', 'компл', 'комплект', 'комп'] },
  { k: 'paket', TR: 'pk.', RU: 'уп.', EN: 'pack', es: ['paket', 'pk', 'pkt', 'pack', 'уп', 'упак', 'упаковка'] },
  { k: 'kutu', TR: 'kutu', RU: 'кор.', EN: 'box', es: ['box', 'кор', 'коробка'] },
  { k: 'rulo', TR: 'rulo', RU: 'рул.', EN: 'roll', es: ['roll', 'рул', 'рулон'] },
  { k: 'cift', TR: 'çift', RU: 'пар.', EN: 'pair', es: ['cift', 'pair', 'пар', 'пара'] },
  { k: 'ton', TR: 'ton', RU: 'т', EN: 't', es: ['тн'] },
]

const KIRIL = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x' }
function norm(s) {
  return String(s == null ? '' : s).toLocaleLowerCase('tr')
    .replace(/i̇/g, 'i').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/²/g, '2').replace(/³/g, '3').replace(/[аеорсух]/g, c => KIRIL[c]).replace(/[.\s]/g, '')
}
function indeks(liste) {
  const m = new Map()
  for (const t of liste) for (const x of [t.k, ...BRM_DILLER.map(d => t[d]), ...(t.es || [])]) { const n = norm(x); if (n && !m.has(n)) m.set(n, t) }
  return m
}
export function birimTanim(liste, s) {
  const t = String(s == null ? '' : s).trim(); if (!t) return null
  const idx = liste._idx || (liste._idx = indeks(liste))
  const n = norm(t); if (idx.has(n)) return idx.get(n)
  for (const p of t.split('/')) { const q = norm(p); if (q && idx.has(q)) return idx.get(q) }
  return null
}
// Saha Linki etiketi: "ad. / шт." (TR + RU yan yana; sayfa son parcayi kisa etiket yapar)
export function birimEtiket(liste, s, diller) {
  const t = birimTanim(liste, s); if (!t) return String(s == null ? '' : s).trim()
  return [...new Set((diller || ['TR', 'RU']).map(d => t[d]).filter(Boolean))].join(' / ') || t.k
}
export async function birimSozlukOku(org, tasari) {
  try {
    const { data, error } = await supabaseAdmin.from('app_settings').select('value')
      .eq('org_id', org).eq('tasari_id', tasari).eq('birim_id', ORTAK_BIRIM).eq('key', BRM_AYAR).maybeSingle()
    if (error) throw error
    let v = data && data.value
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
    if (Array.isArray(v) && v.length) return v.map(t => ({ ...t, es: Array.isArray(t.es) ? t.es : [] }))
  } catch (e) { console.error('birim sozlugu okunamadi', e) }
  return BRM_VARSAYILAN.map(t => ({ ...t }))
}
