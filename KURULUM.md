# Kurulum ve Bilgisayar Değiştirme Rehberi

## Canlı adres

Uygulamanın yayın adresi: **https://hesap.yugati.com.tr/**
(Vercel projesine bağlı özel alan adı; `main` dalına atılan her commit
otomatik olarak bu adrese dağıtılır.)

Uygulamayı yerelde çalıştırmak için artık **tek komut** yeterli — Vercel CLI,
`vercel login`, `vercel link` gerekmez:

```
npm run dev
```

Tarayıcıda `http://localhost:5173` açılır; giriş dahil her şey çalışır.
(`/api/login` gibi sunucu fonksiyonları artık Vite'ın içinde çalışıyor —
ayarı `vite.config.js` içindeki `localApiPlugin` yapıyor.)

## Yeni / diğer bilgisayara taşırken

1. **Proje klasörünün tamamını kopyalayın** (USB, ağ, sıkıştırılmış dosya fark etmez).
   ÖNEMLİ: `.env` dosyası gizli olduğu için GitHub'a gitmez — klasörü GitHub'dan
   indirdiyseniz `.env` dosyasını çalışan bilgisayardan **ayrıca** kopyalamanız gerekir.
2. O bilgisayarda bir kez: `npm install`
3. Sonra her seferinde: `npm run dev`

Hepsi bu.

## `.env` dosyasında ne var, kaybolursa ne yapılır?

| Değişken | Nereden alınır |
|---|---|
| `VITE_SUPABASE_URL` | `.env.example` içinde hazır yazılı |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.example` içinde hazır yazılı |
| `APP_SUPABASE_SECRET_KEY` | Supabase Dashboard → Project Settings → API Keys → Secret keys (`sb_secret_...`) |
| `SESSION_JWT_SECRET` | Rastgele uzun bir metin (yerel için herhangi bir uzun rastgele değer olur) |

`.env` eksik ya da boşsa giriş ekranı artık tahmin bıraktırmayan bir mesaj
gösterir: hangi değerin eksik olduğunu söyler ve bu dosyaya yönlendirir.

## Sık yaşanan sorun

- **"Bağlantı hatası" / giriş olmuyor:** Dev sunucusunu **yeniden başlatın**
  (eski açık kalan sunucu yeni ayarı bilmez). Terminalde Ctrl+C, sonra tekrar
  `npm run dev`.
- **Port 5173 dolu:** Eski bir sunucu hâlâ açık demektir; onu kapatın ya da
  Vite'ın önerdiği yeni portu (ör. 5174) kullanın.

## Neden "tek dosya" olamıyor?

Eski `malzeme-takip_17.html` gibi tek dosya sürümde şifre kontrolü tarayıcıda
yapılıyordu; bu, veritabanı anahtarının ve şifrelerin dosyayı açan herkese
görünmesi demekti. Güvenlik güncellemesiyle şifre doğrulama sunucu tarafına
(`api/` klasörü) taşındı ve `users` tablosuna tarayıcıdan erişim kapatıldı.
Bu yüzden en az "uygulama + api + .env" üçlüsü gerekiyor. `npm run dev` bu
üçünü tek komutta birleştirir — pratikte "tek dosya" rahatlığı budur.
