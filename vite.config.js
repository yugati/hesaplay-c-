import { defineConfig, loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// YEREL /api SUNUCUSU — Vercel CLI GEREKTIRMEZ
// api/ klasorundeki serverless fonksiyonlar (login, me, users...) dogrudan
// Vite dev sunucusunun icinde calistirilir. Boylece yerelde giris icin
// `vercel dev`, `vercel login`, `vercel link` gerekmez; `npm run dev` yeterli.
// Gerekli gizli anahtarlar .env dosyasindan okunur (KURULUM.md'ye bakin).
// Not: api/ veya lib/ dosyalarini duzenlerseniz dev sunucusunu yeniden baslatin.
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_ENV_KEYS = ['VITE_SUPABASE_URL', 'APP_SUPABASE_SECRET_KEY', 'SESSION_JWT_SECRET']

function localApiPlugin() {
  const apiDir = path.resolve(import.meta.dirname, 'api')

  // /api/users/123 -> api/users/[id].js + { id: '123' } ; /api/login -> api/login.js
  function resolveApiFile(pathname) {
    const rel = pathname.replace(/^\/api\//, '').replace(/\/+$/, '')
    if (!rel || rel.includes('..')) return null
    const parts = rel.split('/')
    const exact = path.join(apiDir, ...parts) + '.js'
    if (fs.existsSync(exact)) return { file: exact, params: {} }
    if (parts.length >= 2) {
      const dyn = path.join(apiDir, ...parts.slice(0, -1), '[id].js')
      if (fs.existsSync(dyn)) return { file: dyn, params: { id: decodeURIComponent(parts.at(-1)) } }
    }
    return null
  }

  function sendJson(res, code, obj) {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
  }

  return {
    name: 'local-vercel-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        // Gizli anahtarlar eksikse net bir mesajla durdur (login ekraninda gorunur)
        const missing = SERVER_ENV_KEYS.filter((k) => !process.env[k])
        if (missing.length) {
          sendJson(res, 500, {
            error: `.env dosyasinda eksik deger var: ${missing.join(', ')}. ` +
              `.env dosyasini calisan bilgisayardan kopyalayin (bkz. KURULUM.md).`,
          })
          return
        }

        const match = resolveApiFile(url.pathname)
        if (!match) { sendJson(res, 404, { error: 'API bulunamadi: ' + url.pathname }); return }

        try {
          // Vercel'in handler'a sagladigi alanlari taklit et: req.query, req.body,
          // res.status().json()
          req.query = { ...Object.fromEntries(url.searchParams), ...match.params }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks = []
            for await (const c of req) chunks.push(c)
            const raw = Buffer.concat(chunks).toString('utf8')
            const ct = String(req.headers['content-type'] || '')
            req.body = ct.includes('application/json') && raw ? JSON.parse(raw) : raw
          }
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(obj))
          }

          // mtime ile cache kirilir: api/ dosyasi duzenlenince yeni hali yuklenir
          const mtime = fs.statSync(match.file).mtimeMs
          const mod = await import(pathToFileURL(match.file).href + '?t=' + mtime)
          await mod.default(req, res)
          if (!res.writableEnded) res.end()
        } catch (e) {
          console.error('[local-api]', url.pathname, e)
          sendJson(res, 500, { error: e.message || 'Sunucu hatasi' })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // .env icindeki TUM degerleri (VITE_ oneki olmayanlar dahil) process.env'e
  // yukle ki api/ ve lib/ fonksiyonlari yerelde de anahtarlara erisebilsin
  const env = loadEnv(mode, import.meta.dirname, '')
  for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

  return {
    plugins: [localApiPlugin()],
    server: {
      host: true,
      port: Number(process.env.PORT) || 5173,
    },
  }
})
