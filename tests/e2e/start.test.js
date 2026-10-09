// Tela inicial nova: fliperama animado (start.html) em iframe, JOGUE AGORA abre o aviso 18+, trilha da interface toca
// depois do toque e para na partida; sem start.html entra o vídeo de reserva.
const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{args:['--autoplay-policy=no-user-gesture-required']});
 for(const [n,w,h] of [['deitado',1280,720],['em pé',390,844]]){
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:h>w,hasTouch:h>w});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/');
  await p.waitForSelector('#st-frame.on',{timeout:9000}).catch(()=>{});
  ok(await p.$eval('#st-frame',e=>e.classList.contains('on')),n+': fliperama animado carregou');
  const fr=p.frames().find(f=>f.url().includes('/start.html'));
  ok(!!fr&&await fr.evaluate(()=>window.BomberCash.ready()),n+': arte e logo prontas');
  ok(await fr.evaluate(()=>document.querySelector('canvas').width>100),n+': canvas desenhando');
  await sleep(3800); // intro da logo termina (T_D=3.3s)
  // toca no JOGUE AGORA da arte (coordenadas da arte -> tela, igual ao start.html)
  const pt=await fr.evaluate(()=>{const P=innerWidth/innerHeight<0.95,L=P?{w:941,h:1672,b:[358,1103,588,1190],K:[100,170,841,1205]}:{w:1672,h:941,b:[743,741,942,819],K:[440,66,1232,830]},
    W=innerWidth,H=innerHeight,K=L.K,k=Math.min(Math.max(W/L.w,H/L.h),W/(K[2]-K[0]),H/(K[3]-K[1])),z=1.025,
    place=(scr,art,c)=>art<=scr?(scr-art)/2:Math.min(0,Math.max(scr-art,scr/2-c*k)),ox=place(W,L.w*k,(K[0]+K[2])/2),oy=place(H,L.h*k,(K[1]+K[3])/2),
    a=k*z,e=ox+L.w*k/2*(1-z),f=oy+L.h*k/2*(1-z);
    return[e+(L.b[0]+L.b[2])/2*a,f+(L.b[1]+L.b[3])/2*a]});
  const box=await p.$eval('#st-frame',e=>{const r=e.getBoundingClientRect();return[r.left,r.top]});
  await p.mouse.click(box[0]+pt[0],box[1]+pt[1]);await sleep(700);
  ok(await p.$eval('#intro',e=>e.classList.contains('msg')),n+': JOGUE AGORA abre o aviso 18+');
  const m1=await p.evaluate(()=>({on:window.__bgm.on,st:window.__bgm.state}));ok(m1.on&&m1.st==='running',n+': trilha da tela inicial tocando '+JSON.stringify(m1));
  const s0=await p.evaluate(()=>window.__bgm.step);await sleep(600);ok(await p.evaluate(()=>window.__bgm.step)!==s0,n+': trilha avançando');
  await p.click('#hello-ok');await sleep(900);ok(!(await p.$('#intro')),n+': tela inicial sai e libera o lobby');
  ok(await p.evaluate(()=>window.__bgm.on),n+': trilha continua no lobby');
  if(n==='deitado'){
   await p.evaluate(()=>{document.querySelector('#rail .card[data-k="1x1"]').click()});await p.evaluate(()=>document.getElementById('d-ok').click());await p.waitForFunction(()=>window.__arena.active,null,{timeout:8000});await sleep(500);
   ok(!(await p.evaluate(()=>window.__bgm.on)),'trilha da interface para durante a partida');
   await p.evaluate(()=>document.getElementById('ar-back').click());await sleep(700);
   ok(await p.evaluate(()=>window.__bgm.on),'trilha volta ao sair da partida')}
  ok(!errs.length,n+': sem erros de página '+(errs[0]||''));await c.close()}
 // reserva: sem start.html entra o vídeo
 {const c=await b.newContext({viewport:{width:1280,height:720}});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/?nostart');
  const h264=await p.evaluate(()=>!!document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'));
  if(h264){await p.waitForSelector('#st-vid.on',{timeout:12000}).catch(()=>{});
   const v=await p.evaluate(()=>{const v=document.getElementById('st-vid');return{on:!!v&&v.classList.contains('on'),src:v&&v.getAttribute('src'),frame:!!document.getElementById('st-frame')}});
   ok(v.on&&v.src==='assets/start-L.mp4'&&!v.frame,'sem a animação, entra o vídeo deitado '+JSON.stringify(v))}
  else{await sleep(7500);const v=await p.evaluate(()=>({vid:!!document.getElementById('st-vid'),frame:!!document.getElementById('st-frame'),cls:document.getElementById('intro').className}));
   ok(!v.vid&&!v.frame&&!/st-on/.test(v.cls),'navegador sem H.264: cai na abertura antiga (logo) '+JSON.stringify(v))}
  await p.click('#intro');await sleep(600);ok(await p.$eval('#intro',e=>e.classList.contains('msg')),'no vídeo, tocar na tela abre o aviso 18+');
  ok(!errs.length,'reserva: sem erros '+(errs[0]||''));await c.close()}
 await b.close();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
