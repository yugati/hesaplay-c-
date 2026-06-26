// ═══════════════════════════════════════════════════════════════════════
// Supabase istemcisi — ES module, npm paketi kullanır
// Kimlik bilgileri .env dosyasından gelir (VITE_ prefix zorunlu)
// ═══════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('[SB] .env dosyasında VITE_SUPABASE_URL ve VITE_SUPABASE_KEY tanımlanmalıdır.')
}

export const _sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── LOGIN ────────────────────────────────────────────────────────────────
export async function sbLoginUser(username, password) {
  try {
    const { data, error } = await _sb
      .from('users')
      .select('*')
      .ilike('username', username)
      .eq('password', password)
      .maybeSingle()

    if (error) throw error
    return data || null
  } catch (e) {
    console.error('[SB] sbLoginUser:', e)
    throw e
  }
}

// ─── OTURUM YENİLEME ──────────────────────────────────────────────────────
export async function sbGetUserByUsername(username) {
  try {
    const { data, error } = await _sb
      .from('users')
      .select('*')
      .ilike('username', username)
      .maybeSingle()

    if (error) throw error
    return data || null
  } catch (e) {
    console.error('[SB] sbGetUserByUsername:', e)
    return null
  }
}

// ─── LİSTELE ─────────────────────────────────────────────────────────────
export async function sbGetAllUsers() {
  try {
    const { data, error } = await _sb
      .from('users')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) throw error
    return data || []
  } catch (e) {
    console.error('[SB] sbGetAllUsers:', e)
    throw e
  }
}

// ─── EKLE ─────────────────────────────────────────────────────────────────
export async function sbCreateUser({ username, password, role, sections, buildings }) {
  try {
    const { data, error } = await _sb
      .from('users')
      .insert([{ username, password, role, sections, buildings }])
      .select()
      .single()

    if (error) throw error
    return data
  } catch (e) {
    console.error('[SB] sbCreateUser:', e)
    throw e
  }
}

// ─── GÜNCELLE ─────────────────────────────────────────────────────────────
export async function sbUpdateUser(id, { password, role, sections, buildings }) {
  try {
    const { data, error } = await _sb
      .from('users')
      .update({ password, role, sections, buildings })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  } catch (e) {
    console.error('[SB] sbUpdateUser:', e)
    throw e
  }
}

// ─── SİL ──────────────────────────────────────────────────────────────────
export async function sbDeleteUser(id) {
  try {
    const { error } = await _sb
      .from('users')
      .delete()
      .eq('id', id)

    if (error) throw error
    return true
  } catch (e) {
    console.error('[SB] sbDeleteUser:', e)
    throw e
  }
}
