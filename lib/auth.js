import jwt from 'jsonwebtoken'

// index.html'deki SESSION_TTL_DEFAULT / SESSION_TTL_REMEMBER ile ayni degerler
// (ms). Burada bagimsiz tutuluyor cunku sunucu fonksiyonlari index.html'i
// import edemez; degistirilirse iki yerde de guncellenmeli.
export const SESSION_TTL_DEFAULT = 3600000 // 1 saat
export const SESSION_TTL_REMEMBER = 2592000000 // 30 gun

const SESSION_SECRET = process.env.SESSION_JWT_SECRET
if (!SESSION_SECRET) {
  throw new Error('Missing SESSION_JWT_SECRET in the server environment.')
}

export function signSession(user, ttlMs) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    SESSION_SECRET,
    { expiresIn: Math.floor((ttlMs || SESSION_TTL_DEFAULT) / 1000) }
  )
}

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

// Gecerli bir oturum tokeni varsa iceriğini (sub/username/role) dondurur, yoksa null.
export function requireAuth(req) {
  const token = bearerToken(req)
  if (!token) return null
  try {
    return jwt.verify(token, SESSION_SECRET)
  } catch (e) {
    return null
  }
}

// requireAuth + rol admin olmali.
export function requireAdmin(req) {
  const claims = requireAuth(req)
  if (!claims || claims.role !== 'admin') return null
  return claims
}
