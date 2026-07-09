import { createClient } from '@supabase/supabase-js'

// SADECE SUNUCU TARAFI (Vercel serverless functions). service_role anahtari
// Postgres RLS'i tamamen atlar - bu dosya asla tarayiciya (Vite bundle'ina)
// dahil edilmemeli. VITE_ ile baslamayan env degiskenleri Vite tarafindan
// client bundle'ina gomulmez, sadece Node fonksiyon calisma anida okunur.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the server environment.')
}

export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
