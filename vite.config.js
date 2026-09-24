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

  /* ───────────────────────────────────────────────────────────────────────
     VERCEL YONLENDIRMESININ YEREL KARSILIGI — CANLIYLA BIREBIR AYNI KURALLAR

     BU TAKLIT VERCEL'DEN HOSGORULU OLAMAZ. 14 Eylul 2026'da (e99c02e) uclar
     Next.js tarzi optional catch-all dosyalara ([[...id]].js) birlestirildi.
     Bu dosyadaki taklit o deseni Next.js gibi cozdugu icin yerelde her sey
     calisti; oysa Next.js OLMAYAN bir Vercel projesinde bu desen YOK:
     Vercel'in rota ureticisi (@vercel/fs-detectors createRouteFromPath +
     getSegmentName) koseli parantezli her adi TEK segment sayar ve parametre
     adini dis parantezleri soyarak verir - [[...id]] -> '[...id]'. Sonuc:
       /api/users           rota yok -> 404  ("Kullanicilar yuklenemedi (404)")
       /api/users/abc       calisir ama req.query.id bos -> PUT/DELETE 405
       /api/davet/:t/kabul  req.query.action bos -> davet kabulu calismaz
     Canli gunlerce bozuk kaldi, yerelde kimse goremedi.

     O yuzden burada YALNIZCA Vercel'in gercekten yaptigi uygulanir:
       1) api/<yol>.js birebir dosya (once dosya sistemi - Vercel sirasi)
       2) Koseli parantezli klasor/dosya adi TEK segment eslesir; parametre adi
          dis parantezlerin ici olur ([id] -> 'id'). Catch-all destegi yok,
          cunku canlida da yok.
       3) Dosya bulunamazsa vercel.json "rewrites" icindeki /api/ kurallari
          (":ad" tek segment; hedefteki ?sorgu req.query'ye eklenir)
     Tek fonksiyonda birden cok URL gerekiyorsa yol: duz dosya (api/users.js)
     + vercel.json rewrite (/api/users/:id -> /api/users?id=:id).
     ─────────────────────────────────────────────────────────────────────── */
  const kokDizin = import.meta.dirname

  function dizin(d) {
    try { return fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return [] }
  }

  // Vercel getSegmentName: '[id]' -> 'id', '[[...id]]' -> '[...id]', 'users' -> null
  const parantezAdi = (ad) => (ad.startsWith('[') && ad.endsWith(']') ? ad.slice(1, -1) : null)

  function ara(d, parca, params) {
    const [bas, ...kalan] = parca
    const girdiler = dizin(d)
    if (kalan.length === 0) {
      if (girdiler.some(e => e.isFile() && e.name === bas + '.js')) {
        return { file: path.join(d, bas + '.js'), params }
      }
      for (const e of girdiler) {
        const ad = e.isFile() && e.name.endsWith('.js') ? parantezAdi(e.name.slice(0, -3)) : null
        if (ad !== null) return { file: path.join(d, e.name), params: { ...params, [ad]: bas } }
      }
      return null
    }
    if (girdiler.some(e => e.isDirectory() && e.name === bas)) {
      const r = ara(path.join(d, bas), kalan, params)
      if (r) return r
    }
    for (const e of girdiler) {
      const ad = e.isDirectory() ? parantezAdi(e.name) : null
      if (ad !== null) {
        const r = ara(path.join(d, e.name), kalan, { ...params, [ad]: bas })
        if (r) return r
      }
    }
    return null
  }

  // /api/users -> api/users.js ; /api/me -> api/me.js
  function resolveApiFile(pathname) {
    const rel = pathname.replace(/^\/api\//, '').replace(/\/+$/, '')
    if (!rel) return null
    const parts = rel.split('/').map(decodeURIComponent)
    if (parts.some(x => !x || x === '.' || x === '..')) return null
    return ara(apiDir, parts, {})
  }

  // /api/users/abc -> URL('/api/users?id=abc') ; eslesme yoksa null.
  // vercel.json her istekte okunur: kural eklenince sunucuyu yeniden baslatmak gerekmez.
  function yenidenYaz(pathname) {
    let kurallar = []
    try {
      kurallar = JSON.parse(fs.readFileSync(path.join(kokDizin, 'vercel.json'), 'utf8')).rewrites || []
    } catch (e) { return null }
    for (const r of kurallar) {
      if (!String(r.source).startsWith('/api/') || typeof r.destination !== 'string') continue
      const adlar = []
      const kalip = r.source.replace(/:(\w+)/g, (_, ad) => { adlar.push(ad); return '([^/]+)' })
      const m = pathname.match(new RegExp('^' + kalip + '/?$'))
      if (!m) continue
      const hedef = r.destination.replace(/:(\w+)/g, (_, ad) => {
        const i = adlar.indexOf(ad)
        return i < 0 ? '' : m[i + 1]
      })
      return new URL(hedef, 'http://localhost')
    }
    return null
  }

  // /s/abc -> '/saha-link.html' ; eslesme yoksa null. Yalnizca .html'e giden, index.html
  // DISINDAKI ve /api/ ile baslamayan kurallar - ":ad" tek segment (Vercel gibi).
  function sayfaYenidenYaz(pathname) {
    let kurallar = []
    try {
      kurallar = JSON.parse(fs.readFileSync(path.join(kokDizin, 'vercel.json'), 'utf8')).rewrites || []
    } catch (e) { return null }
    for (const r of kurallar) {
      const s = String(r.source), d = String(r.destination || '')
      if (s.startsWith('/api/') || !d.endsWith('.html') || d === '/index.html' || /[()]/.test(s)) continue
      if (new RegExp('^' + s.replace(/:(\w+)/g, '[^/]+') + '/?$').test(pathname)) return d
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
        if (!url.pathname.startsWith('/api/')) {
          // Sayfa rewrite'lari (orn. /s/:token -> /saha-link.html): canlida Vercel yapar,
          // yerelde Vite'in SPA yedegi index.html'i verirdi. index.html'e giden
          // catch-all kurali Vite'in kendi davranisiyla ayni, o yuzden atlanir.
          const sayfa = sayfaYenidenYaz(url.pathname)
          if (sayfa) req.url = sayfa + url.search
          return next()
        }

        // Gizli anahtarlar eksikse net bir mesajla durdur (login ekraninda gorunur)
        const missing = SERVER_ENV_KEYS.filter((k) => !process.env[k])
        if (missing.length) {
          sendJson(res, 500, {
            error: `.env dosyasinda eksik deger var: ${missing.join(', ')}. ` +
              `.env dosyasini calisan bilgisayardan kopyalayin (bkz. KURULUM.md).`,
          })
          return
        }

        // Vercel sirasi: once dosya sistemi, bulunamazsa vercel.json rewrite'lari
        let hedef = url
        let match = resolveApiFile(url.pathname)
        if (!match) {
          const yeni = yenidenYaz(url.pathname)
          if (yeni) { hedef = yeni; match = resolveApiFile(yeni.pathname) }
        }
        if (!match) { sendJson(res, 404, { error: 'API bulunamadi: ' + url.pathname }); return }

        try {
          // Vercel'in handler'a sagladigi alanlari taklit et: req.query, req.body,
          // res.status().json(). Istegin kendi sorgusu + rewrite hedefinin sorgusu
          // (?id=...) + koseli parantezli yol parametreleri.
          req.query = {
            ...Object.fromEntries(url.searchParams),
            ...(hedef !== url ? Object.fromEntries(hedef.searchParams) : {}),
            ...match.params,
          }
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
