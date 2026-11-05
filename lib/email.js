// ─────────────────────────────────────────────────────────────────────────────
// E-POSTA GONDERIMI — Resend REST API (ek paket yok, duz fetch).
//
// RESEND_API_KEY tanimli DEGILSE sessizce atlanir ve {sent:false} doner - davet
// olusturma/yeniden gonderme YINE DE BASARILI olur, cagiran taraf donen linki
// admin'e gosterip elden ilettirir. Ayni tolerans lib/girisKoruma.js'teki
// "tablo yoksa koruma sessizce devre disi kalir" ilkesiyle tutarli: eksik
// altyapi, ana islevi (davet olusturma) kirmaz.
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY
const GONDEREN = process.env.RESEND_FROM || 'BYKARA <onboarding@resend.dev>'

export async function epostaGonder({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('email: RESEND_API_KEY tanimli degil, eposta gonderilmedi (link yine de donuluyor)')
    return { sent: false, reason: 'RESEND_API_KEY yok' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: GONDEREN, to: [to], subject, html }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      console.error('email: Resend basarisiz', res.status, body)
      return { sent: false, reason: body.message || ('Resend HTTP ' + res.status) }
    }
    return { sent: true }
  } catch (e) {
    console.error('email: gonderim hatasi', e)
    return { sent: false, reason: e.message || 'Sunucu hatasi' }
  }
}

export function davetEpostaHtml({ orgAd, rolAd, link, kod }) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin:0 0 12px">${orgAd || 'BYKARA'} sizi davet ediyor</h2>
    <p style="line-height:1.6">Saha Malzeme Takip sistemine <b>${rolAd || 'kullanici'}</b> yetkisiyle
    davet edildiniz. Hesabinizi acmak icin asagidaki linke tiklayin; adinizi, kullanici
    adinizi ve sifrenizi kendiniz belirleyin.</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#2563eb;color:#fff;
    padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
    Hesabimi Ac</a></p>
    ${kod ? `<p style="line-height:1.6">Ya da giris ekranindaki <b>Davet kodum var</b> baglantisina bu kodu yazin:</p>
    <p style="font-family:Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:3px;margin:8px 0 20px">${kod}</p>` : ''}
    <p style="font-size:12px;color:#666">Davet 7 gun gecerlidir. Bu daveti siz istemediyseniz bu e-postayi yok sayabilirsiniz.</p>
  </div>`
}

export function dogrulamaEpostaHtml({ orgAd, kod, dakika }) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin:0 0 12px">E-posta dogrulama kodunuz</h2>
    <p style="line-height:1.6">${orgAd || 'BYKARA'} - Saha Malzeme Takip hesabinizi acmak icin
    asagidaki kodu kayit ekranina yazin.</p>
    <p style="font-family:Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;margin:20px 0">${kod}</p>
    <p style="font-size:12px;color:#666">Kod ${dakika} dakika gecerlidir. Bu istegi siz yapmadiysaniz bu e-postayi yok sayabilirsiniz; kod girilmeden hesap acilmaz.</p>
  </div>`
}
