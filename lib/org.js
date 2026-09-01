import { supabaseAdmin } from './supabaseAdmin.js'

// ─────────────────────────────────────────────────────────────────────────────
// ORGANIZASYON (COK KIRACILI YAPI) - SUNUCU TARAFI ORTAK PARCALAR
//
// TEK KURAL: aktif organizasyon HER ZAMAN oturum tokeninden gelir, istek
// govdesinden ASLA. Istemci bir yerde org_id gonderirse yok sayilir/ezilir.
// Aksi halde herhangi bir kullanici govdeyi degistirip baska sirketin verisini
// okuyabilirdi - kiraci ayrimi kagit uzerinde kalirdi.
//
// Org degistirme (yalnizca super yonetici) tokeni YENIDEN IMZALAR (bkz. api/org.js);
// yani "hangi organizasyondayim" sorusunun tek cevabi imzali tokendir.
// ─────────────────────────────────────────────────────────────────────────────

// Bugunku tek kiraci. migration_org_1.sql tum mevcut veriyi bu kimlige atadi;
// org iddiasi tasimayan ESKI tokenler ve onek siz ESKI dosya yollari da buraya duser.
export const VARSAYILAN_ORG = 'bykara'

// Org kimligi kucuk harf/rakam/tire ile sinirli: hem JWT'de hem DOSYA YOLUNDA
// geciyor, dar tutulmasi ikisini de guvende tutar.
const ORG_ID_KALIP = /^[a-z0-9][a-z0-9_-]{1,30}$/

/* Dosya yolunun ILK parcasi org kimligidir ('bykara/siparis/...'). Bu adlar org
   kimligi olarak alinirsa, onek siz ESKI yollarla ('siparis/...') karisirlar ve
   bir kiraci digerinin faturasini isteyebilir. Bu yuzden rezerve. */
export const YASAKLI_ORG_ID = new Set([
  'siparis', 'hareket', 'tutanak', 'gorev', 'fatura', 'model', 'api', 'public', 'admin', 'org',
])

export function orgIdGecerli(id) {
  return typeof id === 'string' && ORG_ID_KALIP.test(id) && !YASAKLI_ORG_ID.has(id)
}

/* Tokendeki aktif org. AŞAMA 1 oncesi imzalanmis tokenlerde bu alan YOKTUR -
   o durumda null doner ve cagiran kullanici satirindan okur (asagidaki aktifOrg).
   Boylece yenilenmemis oturumlar cikis yemez; token 20 dakikada bir tazelenirken
   alan kendiliginden yerine oturur (bkz. api/me.js). */
export function tokenOrg(claims) {
  const o = claims && claims.org
  return typeof o === 'string' && o ? o : null
}

/* Istegin calisacagi organizasyon. Once token, olmazsa kullanici satiri.
   NOT: api/veri.js bunu KULLANMAZ - orada yetki icin zaten kullanici satiri
   okunuyor, org da ayni sorgudan gelir (fazladan gidis donus olmasin diye). */
export async function aktifOrg(claims) {
  const t = tokenOrg(claims)
  if (t) return t
  const { data } = await supabaseAdmin.from('users').select('org_id').eq('id', claims.sub).maybeSingle()
  return (data && data.org_id) || VARSAYILAN_ORG
}

/* Bir organizasyon var mi ve askiya alinmis mi? Super yoneticinin gectigi org
   sonradan silinirse/kapanirsa kendi organizasyonuna geri dusmesi icin. */
export async function orgKullanilabilir(id) {
  if (!orgIdGecerli(id)) return false
  const { data } = await supabaseAdmin.from('organizations').select('id, aktif').eq('id', id).maybeSingle()
  return !!(data && data.aktif !== false)
}
