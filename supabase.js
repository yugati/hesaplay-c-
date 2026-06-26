// ═══════════════════════════════════════════════════════════════════════
// Supabase istemcisi ve kullanıcı yönetimi
// CDN: @supabase/supabase-js v2 (UMD global: window.supabase)
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://pkvcpoerpuskpxtkyjjn.supabase.co';
const SUPABASE_KEY = 'BURAYA_KENDİ_PUBLISHABLE_KEYİM';

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── LOGIN ────────────────────────────────────────────────────────────────
/**
 * Kullanıcı adı ve şifre ile giriş yapar.
 * Eşleşme yoksa null döner; hata varsa fırlatır.
 */
async function sbLoginUser(username, password) {
  try {
    const { data, error } = await _sb
      .from('users')
      .select('*')
      .ilike('username', username)
      .eq('password', password)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('[SB] sbLoginUser:', e);
    throw e;
  }
}

// ─── OTURUM YENİLEME ──────────────────────────────────────────────────────
/**
 * Kullanıcı adına göre tek kullanıcı getirir.
 * Bulunamazsa null döner.
 */
async function sbGetUserByUsername(username) {
  try {
    const { data, error } = await _sb
      .from('users')
      .select('*')
      .ilike('username', username)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('[SB] sbGetUserByUsername:', e);
    return null;
  }
}

// ─── LİSTELE ─────────────────────────────────────────────────────────────
/**
 * Tüm kullanıcıları oluşturma tarihine göre döner.
 */
async function sbGetAllUsers() {
  try {
    const { data, error } = await _sb
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[SB] sbGetAllUsers:', e);
    throw e;
  }
}

// ─── EKLE ─────────────────────────────────────────────────────────────────
/**
 * Yeni kullanıcı oluşturur. Başarıda oluşturulan kaydı döner.
 */
async function sbCreateUser({ username, password, role, sections, buildings }) {
  try {
    const { data, error } = await _sb
      .from('users')
      .insert([{ username, password, role, sections, buildings }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[SB] sbCreateUser:', e);
    throw e;
  }
}

// ─── GÜNCELLE ─────────────────────────────────────────────────────────────
/**
 * Mevcut kullanıcıyı günceller. Başarıda güncel kaydı döner.
 */
async function sbUpdateUser(id, { password, role, sections, buildings }) {
  try {
    const { data, error } = await _sb
      .from('users')
      .update({ password, role, sections, buildings })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[SB] sbUpdateUser:', e);
    throw e;
  }
}

// ─── SİL ──────────────────────────────────────────────────────────────────
/**
 * Kullanıcıyı kalıcı olarak siler.
 */
async function sbDeleteUser(id) {
  try {
    const { error } = await _sb
      .from('users')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[SB] sbDeleteUser:', e);
    throw e;
  }
}
