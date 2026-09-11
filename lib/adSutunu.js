// ─────────────────────────────────────────────────────────────────────────────
// GORUNEN AD SUTUNU ICIN GECIS KORUMASI
//
// users.ad sutununu migration_gorunen_ad.sql ekler. Canli site her push'ta
// otomatik guncellendigi icin kod, migration'dan ONCE yayina cikabilir; o
// aralikta 'ad' alanini iceren her yazma Postgres'te 42703 (undefined_column)
// ile duser - yani migration unutuldugu an KULLANICI YONETIMI BUTUNUYLE
// calismaz olurdu: ne yeni hesap acilir ne mevcut hesap duzenlenir.
//
// Burasi yalnizca O hatayi yakalar ve islemi 'ad' alani cikarilmis haliyle bir
// kez daha dener: gorunen ad kaydedilmez ama hesap kaydedilir. Baska her hata
// oldugu gibi geri doner - sessizce yutulan bir yol acilmaz.
//
// Migration calistirildiktan sonra bu dosya hic devreye girmez.
// ─────────────────────────────────────────────────────────────────────────────

export function adSutunuYok(error) {
  if (!error) return false
  if (error.code === '42703') return true
  return /column\s+.*\bad\b.*\s+does not exist/i.test(String(error.message || ''))
}

/* calistir(adDahil) -> Supabase sonucu ({ data, error }) donduren islev.
   Once ad dahil denenir; yalnizca "sutun yok" hatasinda adsiz tekrarlanir. */
export async function adUyumlu(calistir) {
  const sonuc = await calistir(true)
  if (!adSutunuYok(sonuc && sonuc.error)) return sonuc
  console.warn("users.ad sutunu bulunamadi - migration_gorunen_ad.sql calistirilmali. Bu islemde gorunen ad atlandi.")
  return calistir(false)
}
