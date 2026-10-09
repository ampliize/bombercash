const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,m)=>{console.log((c?'OK  ':'FALHA ')+m);if(!c)process.exitCode=1};
(async()=>{
 const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const c=await b.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.click('#intro');await sleep(900);await p.click('#hello-ok');await sleep(400);
 // abre configuracoes -> editor
 await p.evaluate(()=>document.getElementById('cfg-open').click());await sleep(300);
 await p.evaluate(()=>document.getElementById('c-edit').click());await sleep(400);
 ok(await p.evaluate(()=>document.getElementById('ed').open),'editor abriu');
 const items=await p.evaluate(()=>[...document.querySelectorAll('#ed .ed-item')].map(e=>{const r=e.getBoundingClientRect();return{k:e.dataset.k,cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),w:Math.round(r.width)}}));
 console.log('itens (padrao deitado):',JSON.stringify(items));
 await p.screenshot({path:'ed_land.png'});
 // arrasta o analogico para a direita-baixo e a bomba para a esquerda
 const drag=async(sel,dx,dy)=>{const r=await p.evaluate(s=>{const q=document.querySelector(s).getBoundingClientRect();return[q.left+q.width/2,q.top+q.height/2]},sel);
  await p.mouse.move(r[0],r[1]);await p.mouse.down();await p.mouse.move(r[0]+dx/2,r[1]+dy/2,{steps:4});await p.mouse.move(r[0]+dx,r[1]+dy,{steps:4});await p.mouse.up()};
 await drag('#ed-stick',560,-40);await drag('#ed-bomb',-560,-60);
 const after=await p.evaluate(()=>[...document.querySelectorAll('#ed .ed-item')].map(e=>{const r=e.getBoundingClientRect();return{k:e.dataset.k,cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2)}}));
 console.log('apos arrastar:',JSON.stringify(after));
 ok(after.find(i=>i.k==='stick').cx>items.find(i=>i.k==='stick').cx+300,'analogico foi para a direita');
 ok(after.find(i=>i.k==='bomb').cx<items.find(i=>i.k==='bomb').cx-300,'bomba foi para a esquerda');
 await p.evaluate(()=>document.getElementById('ed-save').click());await sleep(500);
 const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('bc_cfg')));
 ok(saved.layout==='custom','layout personalizado salvo');ok(saved.pos.l.stick[0]>.6&&saved.pos.l.bomb[0]<.4,'posicoes salvas para deitado: stick '+saved.pos.l.stick+' bomba '+saved.pos.l.bomb);
 ok(JSON.stringify(saved.pos.p)===JSON.stringify({stick:[.24,.82],bomb:[.78,.82],bar:[.5,.035]}),'posicao em pe nao mudou (cada orientacao e separada)');
 // inicia partida e confere posicoes reais
 await p.evaluate(()=>{document.querySelector('#rail .card[data-k="4x4"]').click()});await sleep(300);await p.evaluate(()=>document.getElementById('d-ok').click());await sleep(4200);
 const m=await p.evaluate(()=>{const r=e=>{const q=document.querySelector(e).getBoundingClientRect();return[Math.round(q.left+q.width/2),Math.round(q.top+q.height/2),Math.round(q.width),Math.round(q.height)]};const de=document.documentElement;
  return{free:document.querySelector('.console').classList.contains('free'),stick:r('#stick'),bomb:r('#bombbtn'),cv:r('#arena'),bar:r('#atop'),vw:innerWidth,vh:innerHeight,scrollH:de.scrollHeight}});
 console.log('em jogo:',JSON.stringify(m));
 ok(m.free,'console em modo livre');ok(m.stick[0]>m.vw*.55,'analogico na direita na partida');ok(m.bomb[0]<m.vw*.45,'bomba na esquerda na partida');
 ok(m.stick[1]+m.stick[3]/2<=m.vh+1&&m.bomb[1]+m.bomb[3]/2<=m.vh+1,'controles dentro da tela');ok(m.scrollH<=m.vh+1,'sem rolagem');
 console.log('arena',m.cv[2]+'x'+m.cv[3],'(antes ~438x380 no modo fixo)');
 await p.screenshot({path:'free_land.png'});
 // controles funcionam: toque no analogico e na bomba
 const k=await p.evaluate(([sx,sy])=>{const z=document.querySelector('.jl'),mk=(t,x,y)=>new PointerEvent(t,{pointerId:9,clientX:x,clientY:y,bubbles:true,pointerType:'touch',isPrimary:true});
   z.dispatchEvent(mk('pointerdown',sx,sy));z.dispatchEvent(mk('pointermove',sx+60,sy));const s=document.getElementById('stick').dataset.dir;z.dispatchEvent(mk('pointerup',sx+60,sy));return{dir:s,depois:document.getElementById('stick').dataset.dir||''}},[m.stick[0],m.stick[1]]);
 ok(k.dir==='d','analogico responde no lugar novo (direcao '+k.dir+')');
 // rotaciona para em pe: usa posicao propria da orientacao
 await p.setViewportSize({width:390,height:844});await sleep(700);
 const mp=await p.evaluate(()=>{const r=e=>{const q=document.querySelector(e).getBoundingClientRect();return[Math.round(q.left+q.width/2),Math.round(q.top+q.height/2)]};return{stick:r('#stick'),bomb:r('#bombbtn'),vw:innerWidth,vh:innerHeight}});
 ok(mp.stick[0]<mp.vw*.5&&mp.bomb[0]>mp.vw*.5,'em pe: usa a posicao padrao dessa orientacao (analogico esq, bomba dir) '+JSON.stringify(mp));
 await p.screenshot({path:'free_port.png'});
 // persistencia
 await p.setViewportSize({width:844,height:390});await p.reload();await sleep(1200);
 const kept=await p.evaluate(()=>JSON.parse(localStorage.getItem('bc_cfg')).layout);ok(kept==='custom','layout persiste apos recarregar');
 // cancelar nao salva
 await p.click('#intro');await sleep(900);await p.click('#hello-ok');await sleep(400);
 await p.evaluate(()=>document.getElementById('cfg-open').click());await sleep(300);await p.evaluate(()=>document.getElementById('c-edit').click());await sleep(300);
 await drag('#ed-stick',-300,0);await p.evaluate(()=>document.getElementById('ed-cancel').click());await sleep(300);
 const s2=await p.evaluate(()=>JSON.parse(localStorage.getItem('bc_cfg')).pos.l.stick[0]);ok(s2===saved.pos.l.stick[0],'cancelar nao altera a posicao salva');
 // restaurar volta ao padrao do editor
 await p.evaluate(()=>document.getElementById('cfg-open').click());await sleep(300);await p.evaluate(()=>document.getElementById('c-edit').click());await sleep(300);
 await p.evaluate(()=>document.getElementById('ed-reset').click());await sleep(200);await p.evaluate(()=>document.getElementById('ed-save').click());await sleep(300);
 const s3=await p.evaluate(()=>JSON.parse(localStorage.getItem('bc_cfg')).pos.l);ok(s3.stick[0]===.13&&s3.bomb[0]===.87,'restaurar volta ao padrao');
 ok(errs.length===0,'sem erros de pagina '+errs.join('|'));
 await b.close();process.exit(process.exitCode||0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
