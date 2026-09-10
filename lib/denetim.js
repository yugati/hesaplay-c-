import { supabaseAdmin } from './supabaseAdmin.js'
import { VARSAYILAN_ORG } from './org.js'

// ─────────────────────────────────────────────────────────────────────────────
// DENETIM KAYDI - SUNUCU TARAFI
//
// Denetim kaydi bugune kadar YALNIZCA tarayicidan yaziliyordu (index.html
// logAction -> src/supabase.js sbInsertAuditLog). Bunun iki acigi vardi:
//   1. Konsolu acan biri logAction'i devre disi birakip iz birakmadan islem
//      yapabiliyordu - yani kayit "tum hareketler" degil, "gonullu bildirilen
//      hareketler" idi.
//   2. audit_log'a yazma herkese acik oldugu icin (lib/yetki.js SERBEST_YAZMA)
//      bir kullanici BASKASININ adina sahte kayit girebiliyordu.
//
// Burasi ikisini de kapatir: girisi/cikisi ve silmeleri sunucu kendi yazar,
// tarayicidan gelen kayitlarin kimlik alanlarini da sunucu damgalar
// (bkz. api/veri.js damgala).
//
// KAYIT BICIMI tarayicidakiyle AYNIDIR (index.html logAction) - ekran
// (renderAudit) iki kaynagi ayni tabloda gosterir:
//   { ts, user, role, action, detail }
// Sunucunun yazdiklarinda ek olarak kaynak:'sunucu' bulunur; denetim ekrani
// "Kaynak" suzgeciyle bunlari ayirabilir.
// ─────────────────────────────────────────────────────────────────────────────

/* Denetim kaydi ASLA asil islemi bozmaz: yazilamazsa yalnizca uyari basilir.
   Gerekce - giris/silme calisiyorsa, log tablosundaki gecici bir sorun yuzunden
   kullaniciyi disarida birakmak ya da silmeyi geri almak dogru degil. */
export async function denetimYaz(org, entry) {
  try {
    const satir = {
      ts: Date.now(),
      user: entry.user || '?',
      role: entry.role || '?',
      action: entry.action || 'sistem',
      detail: entry.detail || '',
      kaynak: 'sunucu',
    }
    if (entry.ip) satir.ip = entry.ip
    const { error } = await supabaseAdmin
      .from('audit_log').insert([{ data: satir, org_id: org || VARSAYILAN_ORG }])
    if (error) throw error
  } catch (e) {
    console.warn('denetim: kayit yazilamadi:', e && e.message)
  }
}
