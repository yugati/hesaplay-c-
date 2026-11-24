/* ARAYUZ DILI (TR / RU) - CEVIRI KATMANI
   ─────────────────────────────────────────────────────────────────────────────
   Uygulamanin kodu Turkce metin uretmeye devam eder; Rusca secildiginde bu katman
   ekrana yazilan metni (metin dugumleri + title / placeholder / aria-label) sozluk
   ile Ruscaya cevirir. Boylece binlerce cagri noktasina dokunmadan arayuz cevrilir
   ve VERIYE HIC DOKUNULMAZ: kaydedilen, Excel'e / PDF'e yazilan her sey Turkce kalir.

   Sozluk: window.DIL_RU (dil-ru.js). Anahtar = ekrandaki metnin "cekirdegi":
     - bosluklar teke indirilir, sayilar '#' olur (91 siparis -> "# siparis"),
     - bastaki / sondaki noktalama (· : ( ) - … vb.) ayrilir, cevrilince geri eklenir.
   Ceviride '#' sirayla gercek sayiyla doldurulur; {заказ|заказа|заказов} bicimi
   kendinden onceki sayiya gore Rusca cogul ekini secer.

   Esik durumlar:
     - value'su olmayan <option>: metni cevrilmeden once value olarak sabitlenir,
       yoksa select.value Rusca metni dondurur ve kayda Rusca yazilirdi.
     - textarea, script, style, contenteditable ve [data-cevirme] icine girilmez.
     - confirm / alert / prompt mesajlari da cevrilir (satir satir).
   Dil tercihi tarayicida saklanir (localStorage 'arayuzDili'). */
(function(){
  'use strict';
  var ANAHTAR='arayuzDili';
  var DIL='tr';
  try{
    // ?dil=ru / ?dil=tr ile gelen link tercihi kalici yapar (Rus calisana dogrudan Rusca link verilebilsin)
    var q=/[?&]dil=(ru|tr)\b/i.exec(location.search||'');
    if(q) localStorage.setItem(ANAHTAR,q[1].toLowerCase());
    DIL=localStorage.getItem(ANAHTAR)==='ru'?'ru':'tr';
  }catch(_){}
  window.ARAYUZ_DILI=DIL;

  var SOZ=function(){ return window.DIL_RU||{}; };
  var SAYI=/\d+(?:[.,]\d+)*/g;
  var HARF=/[A-Za-zÇĞİÖŞÜçğıöşü]/;
  var KENAR=/^([\s·:,;.!?()\[\]\-–—•|\/…*"'«»>]*)([\s\S]*?)([\s·:,;.!?()\[\]\-–—•|\/…*"'«»<]*)$/;
  var ATLA={SCRIPT:1,STYLE:1,TEXTAREA:1,NOSCRIPT:1,CODE:1,PRE:1};
  var NITELIK=['title','placeholder','aria-label'];

  function cogul(n,bir,az,cok){
    if(n==null) return cok;
    var s=String(n);
    if(/,/.test(s)) return az;                       // ondalikli: 1,5 заказа
    var x=parseInt(s.replace(/\./g,''),10); if(isNaN(x)) return cok;
    var m10=x%10, m100=x%100;
    if(m10===1&&m100!==11) return bir;
    if(m10>=2&&m10<=4&&(m100<12||m100>14)) return az;
    return cok;
  }
  function cekirdekCevir(cekirdek,sayilar,onSayi){
    var t=SOZ()[cekirdek]; if(t==null||t==='') return null;
    var i=0, son=onSayi==null?null:onSayi;
    return t.replace(/#|\{([^{}|]*)\|([^{}|]*)\|([^{}|]*)\}/g,function(m,a,b,c){
      if(m==='#'){ son=sayilar[i++]; return son==null?'#':son; }
      return cogul(son,a,b,c);
    });
  }
  // tek satirlik metni cevirir; sozlukte yoksa null
  // onSayi: "<b>91</b> siparis" gibi sayinin ayri etikette durdugu yerde o sayi (cogul icin)
  function cevirSatir(s,onSayi){
    if(!s||!HARF.test(s)) return null;
    var sayilar=[];
    var k=String(s).replace(/\s+/g,' ').replace(SAYI,function(m){ sayilar.push(m); return '#'; });
    var p=KENAR.exec(k); if(!p||!p[2]) return null;
    // kenarlarda sayi kalmaz ('#' kenar karakteri degil); sayilar sirasi cekirdekle ayni
    var t=cekirdekCevir(p[2],sayilar,onSayi);
    if(t==null){
      // "12 kat olusturuldu" / "Iade fisi: 3": kodda n+' metin' diye birlesen metnin sozlukteki
      // anahtari sayisizdir - bastaki / sondaki sayi ayrilip kalan cevrilir (cogul o sayiya gore)
      var bs=/^# (.+)$/.exec(p[2]);
      if(bs){ var tb2=cekirdekCevir(bs[1],sayilar.slice(1),sayilar[0]); if(tb2!=null) return p[1]+sayilar[0]+' '+tb2+p[3]; }
      var ss=/^(.+?)(:? )#$/.exec(p[2]);
      if(ss){ var n3=(ss[1].match(/#/g)||[]).length, tb3=cekirdekCevir(ss[1],sayilar.slice(0,n3),null);
        if(tb3!=null) return p[1]+tb3+ss[2]+sayilar[sayilar.length-1]+p[3]; }
      // "Bir sey yapilamadi: <ayrinti>" - iki noktadan oncesi cevrilir, ayrinti oldugu gibi kalir
      var i=p[2].indexOf(': ');
      if(i>0){
        var bas=KENAR.exec(p[2].slice(0,i));
        var onSay=(p[2].slice(0,i).match(/#/g)||[]).length;
        var tb=bas&&bas[2]?cekirdekCevir(bas[2],sayilar.slice(0,onSay)):null;
        if(tb!=null){
          var j=onSay, kalan=p[2].slice(i).replace(/#/g,function(){ return sayilar[j++]; });
          return p[1]+bas[1]+tb+bas[3]+kalan+p[3];
        }
      }
      return null;
    }
    // ceviri kenar karakteriyle bitiyorsa ve ekrandaki kenar ayni karakterle basliyorsa tek yazilir
    if(p[3]&&t&&t.slice(-1)===p[3].charAt(0)&&/[?!:)\].]/.test(p[3].charAt(0))) t=t.slice(0,-1);
    return p[1]+t+p[3];
  }
  function cevirMetin(s){
    if(DIL!=='ru'||s==null) return s;
    s=String(s);
    if(s.indexOf('\n')<0){ var t=cevirSatir(s); return t==null?s:t; }
    return s.split('\n').map(function(x){ var t=cevirSatir(x); return t==null?x:t; }).join('\n');
  }
  window.dilCevir=cevirMetin;

  function atlanirMi(el){
    for(var e=el;e&&e.nodeType===1;e=e.parentNode){
      if(ATLA[e.nodeName]) return true;
      if(e.isContentEditable) return true;
      if(e.hasAttribute&&e.hasAttribute('data-cevirme')) return true;
    }
    return false;
  }
  function metinDugumu(n){
    var v=n.nodeValue;
    if(!v||v===n.__trYaz||!HARF.test(v)) return;
    var p=n.parentNode; if(!p||p.nodeType!==1) return;
    var on=n.previousSibling, onSayi=null;
    if(on&&on.nodeType===1){ var ot=(on.textContent||'').trim(); if(/^[+−-]?\d[\d.,]*$/.test(ot)) onSayi=ot.replace(/^[+−-]/,''); }
    var t=cevirSatir(v,onSayi); if(t==null||t===v) return;
    if(atlanirMi(p)) return;
    if(p.nodeName==='OPTION'&&!p.hasAttribute('value')) p.setAttribute('value',p.textContent);
    n.__trOrj=v; n.__trYaz=t; n.nodeValue=t;
  }
  function nitelikCevir(el,ad){
    var v=el.getAttribute(ad);
    if(!v||(el.__trYazA&&el.__trYazA[ad]===v)||!HARF.test(v)) return;
    var t=cevirMetin(v); if(t===v) return;
    if(atlanirMi(el)&&el.nodeName!=='TEXTAREA') return;
    el.__trOrjA=el.__trOrjA||{}; el.__trYazA=el.__trYazA||{};
    el.__trOrjA[ad]=v; el.__trYazA[ad]=t; el.setAttribute(ad,t);
  }
  function elemanNitelikleri(el){
    for(var i=0;i<NITELIK.length;i++) if(el.hasAttribute(NITELIK[i])) nitelikCevir(el,NITELIK[i]);
  }
  function agac(kok){
    if(!kok) return;
    if(kok.nodeType===3){ metinDugumu(kok); return; }
    if(kok.nodeType!==1&&kok.nodeType!==11) return;
    if(kok.nodeType===1){ if(ATLA[kok.nodeName]) return; elemanNitelikleri(kok); }
    var w=document.createTreeWalker(kok,5 /* ELEMENT|TEXT */,null), n;
    while((n=w.nextNode())){
      if(n.nodeType===3) metinDugumu(n);
      else elemanNitelikleri(n);
    }
  }
  window.dilAgacCevir=function(k){ if(DIL==='ru') agac(k); };

  var gozcu=null;
  function baslat(){
    if(DIL!=='ru') return;
    document.documentElement.lang='ru';
    agac(document.body);
    gozcu=new MutationObserver(function(kayitlar){
      for(var i=0;i<kayitlar.length;i++){
        var r=kayitlar[i];
        if(r.type==='childList'){ for(var j=0;j<r.addedNodes.length;j++) agac(r.addedNodes[j]); }
        else if(r.type==='characterData') metinDugumu(r.target);
        else if(r.type==='attributes') nitelikCevir(r.target,r.attributeName);
      }
    });
    gozcu.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:NITELIK});
  }
  // RU -> TR: cevrilmis dugumler ve nitelikler asillarina dondurulur
  function geriAl(){
    if(gozcu){ gozcu.disconnect(); gozcu=null; }
    var w=document.createTreeWalker(document.body,5,null), n;
    while((n=w.nextNode())){
      if(n.nodeType===3){ if(n.__trOrj!=null&&n.nodeValue===n.__trYaz) n.nodeValue=n.__trOrj; n.__trOrj=n.__trYaz=undefined; }
      else if(n.__trOrjA){ for(var a in n.__trOrjA){ if(n.getAttribute(a)===n.__trYazA[a]) n.setAttribute(a,n.__trOrjA[a]); } n.__trOrjA=n.__trYazA=undefined; }
    }
    document.documentElement.lang='tr';
  }

  // tarayici diyaloglari
  ['alert','confirm','prompt'].forEach(function(ad){
    var asil=window[ad]; if(typeof asil!=='function') return;
    window[ad]=function(m){ var a=[].slice.call(arguments); a[0]=cevirMetin(m); return asil.apply(window,a); };
  });

  function dugmeleriGuncelle(){
    var ls=document.querySelectorAll('[data-dil-dugme]');
    for(var i=0;i<ls.length;i++){
      var b=ls[i];
      b.textContent=DIL==='ru'?'RU':'TR';
      var ip=DIL==='ru'?'Язык интерфейса: русский (нажмите для турецкого)':'Arayüz dili: Türkçe (Rusça için tıklayın)';
      b.setAttribute('title',ip); b.setAttribute('aria-label',ip);
      b.__trYazA={title:ip,'aria-label':ip};
    }
  }
  window.dilDegistir=function(yeni){
    yeni=yeni||(DIL==='ru'?'tr':'ru');
    if(yeni===DIL) return;
    try{ localStorage.setItem(ANAHTAR,yeni); }catch(_){}
    if(yeni==='tr'){ DIL='tr'; window.ARAYUZ_DILI='tr'; geriAl(); }
    else { DIL='ru'; window.ARAYUZ_DILI='ru'; baslat(); }
    dugmeleriGuncelle();
    // CURRENT_USER uygulamada top-level let: window'da degil ama ortak global kapsamda adiyla erisilir
    try{ if(CURRENT_USER&&typeof render==='function') render(); }catch(_){}
  };
  window.dilDugmeleriGuncelle=dugmeleriGuncelle;

  function hazir(){ baslat(); dugmeleriGuncelle(); }
  if(document.body) hazir(); else document.addEventListener('DOMContentLoaded',hazir);
})();
