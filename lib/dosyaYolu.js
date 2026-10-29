import { orgIdGecerli, VARSAYILAN_ORG } from './org.js'

// ─────────────────────────────────────────────────────────────────────────────
// DOSYA YOLU DOGRULAMA - api/dosya.js ile lib/belgeLink.js'in ORTAK parcasi
//
// Kova tanimlari ve "bu yol hangi organizasyonun?" kurali eskiden api/dosya.js'in
// icindeydi. Belge paylasim linki (lib/belgeLink.js) ayni kurali uygulamak zorunda:
// link uretirken yolun istegi yapanin organizasyonuna ait oldugu burada dogrulanir.
// Iki kopya olsaydi biri gevsetildiginde oteki sessizce acik kalirdi.
// ─────────────────────────────────────────────────────────────────────────────

/* Yol oneki beyaz listesi: bu kontrol olmadan istemci 'path' ile kovadaki baska
   bir dosyayi isteyebilirdi. */
export const KOVALAR = {
  belgeler: { onek: /^(siparis|hareket|tutanak|gorev|fatura|kks)\// },
  'bina-modelleri': { onek: /^model\// },
}

export function kovaSec(ad) {
  const k = ad || 'belgeler'
  return KOVALAR[k] ? k : null
}

/* ─── ORGANIZASYON VE DOSYA YOLU ───────────────────────────────────────────────
   Yeni yuklemeler org onekiyle yazilir:  bykara/siparis/<id>/<rastgele>.pdf
   ESKI dosyalar oneksiz duruyor:                siparis/<id>/<rastgele>.pdf

   Eski dosyalarin hicbiri TASINMADI - tasima, kayitlardaki pdf.path alanlarini
   toplu guncellemeyi gerektirirdi ve yarida kalirsa acilmayan fatura baglantilari
   birakirdi. Gerek de yok: onek siz her yol, tek kiraci donemine ait, yani
   tanimi geregi BYKARA'nindir. Kural bu kadar basit:
     - onekli yol  -> onek, istegi yapanin aktif organizasyonuna esit olmali
     - oneksiz yol -> yalnizca BYKARA acabilir
   Boylece ne dosya tasindi, ne de bir kiraci digerinin faturasina ulasabiliyor.

   Doner: yolun ait oldugu organizasyon, ya da gecersizse null. */
export function yolunOrgu(kova, p) {
  if (typeof p !== 'string' || !p || p.length > 300) return null
  if (p.includes('..') || p.startsWith('/') || p.includes('\\')) return null
  if (!/^[A-Za-z0-9/_.-]+$/.test(p)) return null

  const onek = KOVALAR[kova].onek
  if (onek.test(p)) return VARSAYILAN_ORG   // oneksiz = tek kiraci donemi

  const i = p.indexOf('/')
  if (i <= 0) return null
  const org = p.slice(0, i)
  // Org kimlikleri 'siparis'/'model' gibi tur adlariyla cakisamaz (lib/org.js
  // YASAKLI_ORG_ID) - bu yuzden iki yol bicimi birbirine karisamaz.
  if (!orgIdGecerli(org)) return null
  if (!onek.test(p.slice(i + 1))) return null
  return org
}
