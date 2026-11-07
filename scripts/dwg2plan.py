# -*- coding: utf-8 -*-
"""
DWG/DXF kat planini uygulamanin Kat Plani sekmesi icin JSON'a cevirir.

Kullanim:
  1) DWG ise once DXF'e cevir (AutoCAD core console):
       accoreconsole.exe /i plan.dwg /s conv.scr      (conv.scr icerigi: _.DXFOUT / <cikti.dxf> / 16 / bos satir)
  2) python scripts/dwg2plan.py <plan.dxf> <bina> <katNo> <cikti.json>
       orn. python scripts/dwg2plan.py arsiv/Drawing3.dxf 00UYB 1 public/plan/00UYB-k1.json

Cizimdeki butun cizgiler (duvar, kapi, mobilya...) "cizgi" olarak; oda etiketleri (00UYB10R001 gibi
KKS kodlari) "oda" olarak cikar. Oda kutusu, etiket noktasindan dort yone isin atip ilk carpilan
cizgiye kadar olculur (dikdortgen yaklasimi). Birim: desimetre (0.1 m). Y ekseni ekrana gore
(asagi) cevrilmistir. Gerekirse ezdxf: pip install ezdxf
"""
import sys, re, math, json
from collections import deque
import numpy as np
import ezdxf

HUC = 0.5   # taşırma dolgusu ızgara adımı (dm)

def rasterle(segler, x0, y0, W, H):
    """Cizgileri HUC adimli izgaraya isler (4-komsuluklu dolgu bu cizgilerden sizamaz)."""
    nx, ny = int(W/HUC)+3, int(H/HUC)+3
    g = np.zeros((ny, nx), dtype=np.uint8)
    for ax, ay, bx, by in segler:
        n = max(1, int(math.hypot(bx-ax, by-ay)/(HUC/2)))
        for i in range(n+1):
            t = i/n; x = ax+(bx-ax)*t; y = ay+(by-ay)*t
            j, k = int((x-x0)/HUC), int((y-y0)/HUC)
            if 0 <= k < ny and 0 <= j < nx: g[k, j] = 1
    return g

def kapi_kapat(segler, enb=16.0):
    """Ayni dogru uzerindeki (yatay/dikey) duvar parcalari arasindaki kisa bosluklari (kapi acikliklari,
    <= enb dm) kapatan ek parcalar uretir - tasirma dolgusu kapidan komsu odaya sizmasin."""
    yat, dik = {}, {}
    for ax, ay, bx, by in segler:
        if abs(ay-by) < .05: yat.setdefault(round(ay, 1), []).append((min(ax, bx), max(ax, bx)))
        elif abs(ax-bx) < .05: dik.setdefault(round(ax, 1), []).append((min(ay, by), max(ay, by)))
    ek = []
    for grup, yatay in ((yat, True), (dik, False)):
        for sabit, arr in grup.items():
            arr.sort(); son = arr[0][1]
            for a, b in arr[1:]:
                if 0.8 <= a-son <= enb: ek.append((son, sabit, a, sabit) if yatay else (sabit, son, sabit, a))
                son = max(son, b)
    return ek

def bolge_ata(g, tohumlar):
    """Yarismali tasirma dolgusu: tum oda etiketlerinden ayni anda 4-komsuluklu yayilir, her bos hucre
    kendisine (duvarlardan dolasarak) en yakin etikete ait olur. Duvarsiz acik gecisler (acik salonlar,
    kapisiz bosluklar) boylece etiketler arasinda ortadan paylasilir. tohumlar: [(k, j, azami_mesafe_hucre)].
    Donus: sahip dizisi (-1 = kimseye ait degil)."""
    ny, nx = g.shape
    sahip = np.full((ny, nx), -1, dtype=np.int32)
    q = deque()
    for i, (k, j, sinir) in enumerate(tohumlar):
        bas = None
        for r in range(0, 8):          # etiket bir cizginin ustundeyse yakin bos hucreden basla
            for dk in range(-r, r+1):
                for dj in range(-r, r+1):
                    if max(abs(dk), abs(dj)) != r: continue
                    kk, jj = k+dk, j+dj
                    if 0 <= kk < ny and 0 <= jj < nx and g[kk, jj] == 0 and sahip[kk, jj] < 0: bas = (kk, jj); break
                if bas: break
            if bas: break
        if not bas: continue
        sahip[bas] = i; q.append((bas[0], bas[1], 0, i, sinir))
    while q:
        k, j, d, i, sinir = q.popleft()
        if d >= sinir: continue
        for dk, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            kk, jj = k+dk, j+dj
            if 0 <= kk < ny and 0 <= jj < nx and g[kk, jj] == 0 and sahip[kk, jj] < 0:
                sahip[kk, jj] = i; q.append((kk, jj, d+1, i, sinir))
    return sahip

def hucre_cokgen(gor, x0, y0):
    """Hucre kumesinin dis sinirini (en uzun halka) sadelestirilmis cokgen olarak dondurur."""
    # sinir kenarlari saat yonunde (x saga, y asagi): ust ->, sag v, alt <-, sol ^ ; bir kosede iki hucre
    # yalniz capraz degiyorsa ayni koseden iki kenar cikar - gelis yonune gore saat yonunde donen secilir
    kenar = {}
    def ekle(a, b): kenar.setdefault(a, []).append(b)
    for k, j in gor:
        if (k-1, j) not in gor: ekle((j, k), (j+1, k))
        if (k, j+1) not in gor: ekle((j+1, k), (j+1, k+1))
        if (k+1, j) not in gor: ekle((j+1, k+1), (j, k+1))
        if (k, j-1) not in gor: ekle((j, k+1), (j, k))
    def sec(v, gelis):
        c = kenar.get(v)
        if not c: return None
        if len(c) == 1 or gelis is None: n = c[0]
        else:   # saat yonunde donus: gelis x cikis capraz carpimi en buyuk olan (y asagi oldugundan isaret ters)
            n = max(c, key=lambda b: -(gelis[0]*(b[1]-v[1])-gelis[1]*(b[0]-v[0])))
        c.remove(n)
        if not c: del kenar[v]
        return n
    halkalar = []
    while kenar:
        v0 = next(iter(kenar)); h = [v0]; v = sec(v0, None); gelis = (v[0]-v0[0], v[1]-v0[1])
        while v != v0 and v in kenar:
            h.append(v); n = sec(v, gelis); gelis = (n[0]-v[0], n[1]-v[1]); v = n
        halkalar.append(h)
    if not halkalar: return None
    h = max(halkalar, key=len)
    pts = [(x0+j*HUC, y0+k*HUC) for j, k in h]
    def dp(p, eps):      # Douglas-Peucker: izgara kirpintilarini ve kucuk girintileri atar
        if len(p) < 3: return p
        a, b = p[0], p[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1
        dm, im = -1, 0
        for i in range(1, len(p)-1):
            d = abs((p[i][0]-a[0])*dy-(p[i][1]-a[1])*dx)/L
            if d > dm: dm, im = d, i
        if dm > eps: return dp(p[:im+1], eps)[:-1]+dp(p[im:], eps)
        return [a, b]
    # kapali halka: bas ve son ayni noktada olunca DP cokerdi - halka, ilk noktaya en uzak noktadan ikiye bolunur
    im = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0]-pts[0][0], pts[i][1]-pts[0][1]))
    pts = dp(pts[:im+1], 0.7)[:-1] + dp(pts[im:]+[pts[0]], 0.7)[:-1]
    out = []
    for i, c in enumerate(pts):
        a, b = pts[i-1], pts[(i+1) % len(pts)]
        if abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])) < 1e-6: continue
        out.append(c)
    return out if len(out) >= 3 else None

def ana_parca(hucreler, bas):
    """Sahiplik bolgesi kopuk parcalara dusmusse yalniz etiketin bulundugu parca alinir."""
    kume = set(hucreler)
    if bas not in kume: return kume
    gor = {bas}; q = deque([bas])
    while q:
        k, j = q.popleft()
        for dk, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (k+dk, j+dj)
            if n in kume and n not in gor: gor.add(n); q.append(n)
    return gor

def ana_blok(doc):
    """Cizim tek bir INSERT icine konmussa o blogu dondurur (blok birimi dm kabul edilir); degilse modelspace."""
    msp = doc.modelspace()
    ents = list(msp)
    ins = [e for e in ents if e.dxftype() == 'INSERT']
    if len(ins) == 1 and len(ents) == 1:
        return doc.blocks.get(ins[0].dxf.name), 1.0
    u = doc.header.get('$INSUNITS', 4)       # modelspace: mm -> dm
    return msp, {4: 0.01, 5: 0.1, 6: 10.0}.get(u, 0.01)

def topla(src, sc):
    cizgi, dolu, yazi, yay = [], [], [], []
    for e in src:
        t = e.dxftype()
        if t == 'LINE':
            a, b = e.dxf.start, e.dxf.end
            cizgi.append((a.x*sc, a.y*sc, b.x*sc, b.y*sc))
        elif t == 'LWPOLYLINE':
            pts = [(p[0]*sc, p[1]*sc) for p in e.get_points('xy')]
            if e.closed: pts.append(pts[0])
            cizgi.extend((pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) for i in range(len(pts)-1))
        elif t == 'POLYLINE':
            pts = [(v.dxf.location.x*sc, v.dxf.location.y*sc) for v in e.vertices]
            if e.is_closed: pts.append(pts[0])
            cizgi.extend((pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) for i in range(len(pts)-1))
        elif t == 'SOLID':
            v = [e.dxf.vtx0, e.dxf.vtx1, e.dxf.vtx3, e.dxf.vtx2]
            dolu.append([(p.x*sc, p.y*sc) for p in v])
        elif t == 'ARC':
            c, r = e.dxf.center, e.dxf.radius*sc
            a0, a1 = math.radians(e.dxf.start_angle), math.radians(e.dxf.end_angle)
            if a1 < a0: a1 += 2*math.pi
            n = max(4, int((a1-a0)/(math.pi/12)))
            pts = [(c.x*sc + r*math.cos(a0+(a1-a0)*i/n), c.y*sc + r*math.sin(a0+(a1-a0)*i/n)) for i in range(n+1)]
            yay.extend((pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) for i in range(n))
        elif t == 'CIRCLE' and 4 <= e.dxf.radius*sc <= 6:      # aks balonu: merkezi aks cizgisinin koordinati
            yay.append(('AKS', e.dxf.center.x*sc, e.dxf.center.y*sc))
        elif t in ('TEXT', 'MTEXT'):
            s = e.dxf.text if t == 'TEXT' else e.plain_text()
            p = e.dxf.insert
            h = float(getattr(e.dxf, 'height', 0) or getattr(e.dxf, 'char_height', 0) or 2)*sc
            yazi.append((s.strip(), p.x*sc, p.y*sc, h, float(getattr(e.dxf, 'rotation', 0) or 0)))
    return cizgi, dolu, yazi, yay

KOD = re.compile(r'^(\d{2}[A-Z]{3})(\d{2})R(\d{3})$')
PARCA_ON = re.compile(r'^\d{2}[A-Z]{3}\d{2}$')      # "00UYB10"
PARCA_SON = re.compile(r'^R\d{3}$')                  # "R015"

def oda_etiketleri(yazi):
    tam, on, son = [], [], []
    for s, x, y, h, rot in yazi:
        s2 = s.replace(' ', '')
        if KOD.match(s2): tam.append((s2, x, y))
        elif PARCA_ON.match(s2): on.append((s2, x, y))
        elif PARCA_SON.match(s2): son.append((s2, x, y))
    # ikiye bolunmus etiketler: "R015" parcasini en yakin "00UYB10" parcasiyla birlestir (<= 12 dm)
    kalan_on = list(on)
    for s, x, y in son:
        best = None
        for o in kalan_on:
            d = math.hypot(o[1]-x, o[2]-y)
            if d <= 12 and (best is None or d < best[0]): best = (d, o)
        if best:
            tam.append((best[1][0]+s, x, y))
            kalan_on.remove(best[1])
    return tam

def isin(px, py, segs, yon):
    """(px,py)'den yon ('+x','-x','+y','-y') dogrultusunda ilk carpilan cizgiye uzaklik."""
    best = None
    for (x1, y1, x2, y2) in segs:
        if yon in ('+x', '-x'):
            if (y1-py)*(y2-py) > 0 or y1 == y2: continue
            t = (py-y1)/(y2-y1); xi = x1+(x2-x1)*t
            d = xi-px if yon == '+x' else px-xi
        else:
            if (x1-px)*(x2-px) > 0 or x1 == x2: continue
            t = (px-x1)/(x2-x1); yi = y1+(y2-y1)*t
            d = yi-py if yon == '+y' else py-yi
        if d > 0.3 and (best is None or d < best): best = d
    return best

def main():
    dxf, bina, kat, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    doc = ezdxf.readfile(dxf)
    src, sc = ana_blok(doc)
    cizgi, dolu, yazi, yay = topla(src, sc)
    aksX = {round(a[1], 1) for a in yay if a[0] == 'AKS'}; aksY = {round(a[2], 1) for a in yay if a[0] == 'AKS'}
    yay = [a for a in yay if a[0] != 'AKS']
    def aks_cizgisi(c):   # aks koordinati uzerindeki eksen-paralel cizgi (duvar yuzeyi aksin uzerinde olmaz)
        return (abs(c[0]-c[2]) < .05 and any(abs(c[0]-x) < .3 for x in aksX)) or (abs(c[1]-c[3]) < .05 and any(abs(c[1]-y) < .3 for y in aksY))
    cizgi = [c for c in cizgi if math.hypot(c[2]-c[0], c[3]-c[1]) >= 0.8]   # tarama / yazi cizgileri atilir
    xs = [v for c in cizgi for v in (c[0], c[2])]; ys = [v for c in cizgi for v in (c[1], c[3])]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    # isin icin duvar adayi: 3 dm'den uzun cizgiler; binayi boydan boya gecen aks cizgileri (>= 300 dm) sayilmaz
    duvar = [c for c in cizgi if 3 <= math.hypot(c[2]-c[0], c[3]-c[1]) < 300 and not aks_cizgisi(c)]
    # tasirma dolgusu icin izgara: aks cizgileri disinda tum cizgiler + yaylar (kapi kanadi + yay acikligi kapatir)
    duv = [c for c in cizgi if not aks_cizgisi(c)]
    g = rasterle(duv+yay+kapi_kapat(duv), x0, y0, x1-x0, y1-y0)
    odalar = []; tohum = []
    for kod, x, y in oda_etiketleri(yazi):
        L = isin(x, y, duvar, '-x') or 10; R = isin(x, y, duvar, '+x') or 10
        D = isin(x, y, duvar, '-y') or 6; U = isin(x, y, duvar, '+y') or 6
        L, R, D, U = (min(v, 200) for v in (L, R, D, U))
        odalar.append({'kod': kod, 'lx': round(x-x0, 1), 'ly': round(y1-y, 1),
                       'x': round(x-L-x0, 1), 'y': round(y1-(y+U), 1), 'w': round(L+R, 1), 'h': round(U+D, 1)})
        # yayilma siniri: isinla bulunan dikdortgenin uzun kenarinin 1.6 kati (en az 60 dm)
        tohum.append((int((y-y0)/HUC), int((x-x0)/HUC), int(max(60, 1.6*max(L+R, U+D))/HUC)))
    sahip = bolge_ata(g, tohum)
    cokgenli = 0
    for i, o in enumerate(odalar):
        ks, js = np.nonzero(sahip == i)
        if not len(ks): continue
        hucreler = ana_parca(zip(ks.tolist(), js.tolist()), (tohum[i][0], tohum[i][1]))
        alan = len(hucreler)*HUC*HUC
        if alan < o['w']*o['h']*0.25 or alan > o['w']*o['h']*4+2000: continue   # cok kucuk / cok sizmis: dikdortgen kalir
        poly = hucre_cokgen(hucreler, x0, y0)
        if not poly: continue
        cokgenli += 1
        o['p'] = [[round(px-x0, 1), round(y1-py, 1)] for px, py in poly]
        xs_ = [q[0] for q in o['p']]; ys_ = [q[1] for q in o['p']]
        o['x'], o['y'], o['w'], o['h'] = min(xs_), min(ys_), round(max(xs_)-min(xs_), 1), round(max(ys_)-min(ys_), 1)
    odalar.sort(key=lambda o: o['kod'])
    aks, kot = [], []
    for s, x, y, h, rot in yazi:
        if re.match(r'^[A-ZА-Я]{1,2}(/\d)?$|^\d{1,2}(/\d)?$', s) and h >= 3.5:
            aks.append({'t': s, 'x': round(x-x0, 1), 'y': round(y1-y, 1)})
        elif re.match(r'^[+-]?\d\.\d{3}$', s):
            kot.append({'t': s, 'x': round(x-x0, 1), 'y': round(y1-y, 1)})
    R1 = lambda v: round(v, 1)
    data = {
        'bina': bina, 'kat': kat, 'birim': 'dm', 'kaynak': dxf.replace('\\', '/').split('/')[-1],
        'w': R1(x1-x0), 'h': R1(y1-y0),
        'cizgi': [[R1(c[0]-x0), R1(y1-c[1]), R1(c[2]-x0), R1(y1-c[3])] for c in cizgi],
        'yay': [[R1(c[0]-x0), R1(y1-c[1]), R1(c[2]-x0), R1(y1-c[3])] for c in yay],
        'dolu': [[[R1(p[0]-x0), R1(y1-p[1])] for p in d] for d in dolu],
        'oda': odalar, 'aks': aks, 'kot': kot,
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{out}: {len(cizgi)} cizgi, {len(yay)} yay, {len(dolu)} dolu, {len(odalar)} oda ({cokgenli} cokgen, {len(odalar)-cokgenli} dikdortgen), {len(aks)} aks, {len(kot)} kot; {data["w"]} x {data["h"]} dm')
    for o in odalar: print(' ', o['kod'], o['x'], o['y'], o['w'], o['h'], 'cokgen %d kose' % len(o['p']) if 'p' in o else 'dikdortgen')

if __name__ == '__main__':
    main()
