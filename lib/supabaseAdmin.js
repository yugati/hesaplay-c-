import { createClient } from '@supabase/supabase-js'

// SADECE SUNUCU TARAFI (Vercel serverless functions). service_role anahtari
// Postgres RLS'i tamamen atlar - bu dosya asla tarayiciya (Vite bundle'ina)
// dahil edilmemeli. VITE_ ile baslamayan env degiskenleri Vite tarafindan
// client bundle'ina gomulmez, sadece Node fonksiyon calisma anida okunur.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
// APP_SUPABASE_SECRET_KEY (ozel isim) kullaniliyor - SUPABASE_SERVICE_ROLE_KEY adi
// Vercel'deki Supabase entegrasyonu tarafindan otomatik yonetiliyor ve YANLIS
// projenin (entegrasyon kurulurken otomatik olusan bos proje) anahtarini enjekte
// ediyordu. Farkli isim kullanmak entegrasyonun bu degeri ezmesini engelliyor.
const SERVICE_ROLE_KEY = process.env.APP_SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or APP_SUPABASE_SECRET_KEY in the server environment.')
}

export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
