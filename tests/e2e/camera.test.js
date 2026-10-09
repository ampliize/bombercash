// Câmera automática e tela do jogo: no celular o bloco fica grande (>=34px) e a câmera segue o boneco;
// no PC o mapa inteiro cabe; no layout personalizado o mapa fica centralizado e a página não rola; o editor mostra o mapa.
const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
const start=async(b,w,h,touch,lay)=>{const c=await b.newContext({viewport:{width:w,height:h},isMobile:touch,hasTouch:touch});const p=await c.newPage();p.on('pageerror',e=>ok(false,'pageerror '+e.message));
 await p.addInitScript(l=>{localStorage.setItem('bc_cfg',JSON.stringify({layout:l,fs:false}))},lay);
 await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.evaluate(()=>window.__bcEnter());await sleep(1000);await p.click('#hello-ok');await sleep(500);return{c,p}};
const play=async p=>{await p.evaluate(()=>{document.querySelector('#rail .card[data-k="1x1"]').click()});await p.evaluate(()=>document.getElementById('d-ok').click());await sleep(3200)};
const geo=p=>p.evaluate(()=>{const v=document.getElementById('vp'),r=v.getBoundingClientRect(),c=document.getElementById('arena').getBoundingClientRect(),s=window.__arena._s();return{cam:v.classList.contains('cam'),vp:[r.left,r.top,r.width,r.height].map(Math.round),tile:c.width/(document.getElementById('arena').width/1.5)*48,tf:getComputedStyle(document.getElementById('arena')).transform,vw:innerWidth,vh:innerHeight,canScroll:(()=>{scrollTo(0,300);const y=scrollY;scrollTo(0,0);return y>0})()}});
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 {const{c,p}=await start(b,390,844,true,'fixed');await play(p);const g=await geo(p);
  ok(g.cam,'celular em pé: câmera ligada');ok(g.tile>=33.5,'celular em pé: bloco com '+g.tile.toFixed(1)+'px (antes ~25px)');ok(!g.canScroll,'celular em pé: página não rola');
  await p.evaluate(()=>{const s=window.__arena._s(),me=s.players[window.__arena.meIdx];me.x=(s.W-2.5)*48;me.y=(s.H-2.5)*48});await sleep(800);const g2=await geo(p);
  ok(g2.tf!==g.tf,'câmera seguiu o boneco ('+g.tf+' -> '+g2.tf+')');
  const ex=await p.evaluate(()=>{const s=window.__arena._s(),cv=document.getElementById('arena'),vp=document.getElementById('vp'),sc=parseFloat(cv.style.width)/(cv.width/1.5),tl=48*sc,M=(cv.width/1.5-s.W*48)/2*sc,
    m=getComputedStyle(cv).transform.match(/-?[\d.]+/g).map(Number),ox=-m[4],oy=-m[5],r=x=>Math.abs(x-Math.round(x));
    return{tl,bw:vp.clientWidth,bh:vp.clientHeight,cw:parseFloat(cv.style.width),ch:parseFloat(cv.style.height),ox,oy,M,
     wOk:vp.clientWidth>=parseFloat(cv.style.width)-1||r(vp.clientWidth/tl)<.02,xOk:vp.clientWidth>=parseFloat(cv.style.width)-1||r((ox-M)/tl)<.03,yOk:vp.clientHeight>=parseFloat(cv.style.height)-1||r((oy-M)/tl)<.03}});
  ok(ex.wOk&&ex.xOk&&ex.yOk,'recorte exato: janela e câmera em blocos inteiros '+JSON.stringify(ex));await c.close()}
 {const{c,p}=await start(b,844,390,true,'fixed');await play(p);const g=await geo(p);ok(!g.cam&&g.tile>=26,'celular deitado: mapa inteiro, sem cortar a borda (bloco '+g.tile.toFixed(1)+'px)');ok(g.vp[1]+g.vp[3]<=g.vh+1,'celular deitado: jogo cabe na altura');await c.close()}
 {const{c,p}=await start(b,1366,768,false,'fixed');await play(p);const g=await geo(p);ok(!g.cam,'PC: mapa inteiro sem câmera (bloco '+g.tile.toFixed(0)+'px)');await c.close()}
 {const{c,p}=await start(b,390,844,true,'custom');await play(p);const g=await geo(p);
  const cy=g.vp[1]+g.vp[3]/2;ok(Math.abs(cy-g.vh/2)<14,'personalizado em pé: mapa centralizado na vertical (centro '+Math.round(cy)+' de '+g.vh+')');
  ok(Math.abs(g.vp[0]+g.vp[2]/2-g.vw/2)<6,'personalizado: centralizado na horizontal');ok(g.vp[2]>=g.vw-34,'personalizado em pé: mapa ocupa a largura da tela (blocos inteiros: '+g.vp[2]+' de '+g.vw+')');ok(!g.canScroll,'personalizado: página não rola');await c.close()}
 {const{c,p}=await start(b,844,390,true,'custom');await play(p);const g=await geo(p);ok(g.vp[3]>=g.vh-12,'personalizado deitado: mapa ocupa a altura da tela');ok(Math.abs(g.vp[0]+g.vp[2]/2-g.vw/2)<6,'personalizado deitado: centralizado');
  await p.evaluate(()=>document.getElementById('bt-cfg').click());await sleep(300);await p.evaluate(()=>document.getElementById('c-edit').click());await sleep(500);
  const e=await p.evaluate(()=>{const a=document.getElementById('ed-arena'),r=a.getBoundingClientRect();return{img:/url\("?data:image/.test(a.style.background||a.style.backgroundImage),c:[r.left+r.width/2,r.top+r.height/2].map(Math.round)}});
  ok(e.img,'editor mostra o mapa de verdade');ok(Math.abs(e.c[0]-g.vw/2)<6&&Math.abs(e.c[1]-g.vh/2)<6,'editor: mapa centralizado');await c.close()}
 await b.close();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
