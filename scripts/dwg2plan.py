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
import ezdxf

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
    odalar = []
    for kod, x, y in oda_etiketleri(yazi):
        L = isin(x, y, duvar, '-x') or 10; R = isin(x, y, duvar, '+x') or 10
        D = isin(x, y, duvar, '-y') or 6; U = isin(x, y, duvar, '+y') or 6
        L, R, D, U = (min(v, 200) for v in (L, R, D, U))
        odalar.append({'kod': kod, 'lx': round(x-x0, 1), 'ly': round(y1-y, 1),
                       'x': round(x-L-x0, 1), 'y': round(y1-(y+U), 1), 'w': round(L+R, 1), 'h': round(U+D, 1)})
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
    print(f'{out}: {len(cizgi)} cizgi, {len(yay)} yay, {len(dolu)} dolu, {len(odalar)} oda, {len(aks)} aks, {len(kot)} kot; {data["w"]} x {data["h"]} dm')
    for o in odalar: print(' ', o['kod'], o['x'], o['y'], o['w'], o['h'])

if __name__ == '__main__':
    main()
