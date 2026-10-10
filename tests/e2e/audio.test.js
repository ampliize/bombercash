const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const c=await b.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.addInitScript(()=>{window.__au={osc:0,src:0,state:'-'};const AC=window.AudioContext;const po=AC.prototype.createOscillator,ps=AC.prototype.createBufferSource;
  AC.prototype.createOscillator=function(){window.__au.osc++;window.__au.state=this.state;return po.apply(this,arguments)};AC.prototype.createBufferSource=function(){window.__au.src++;return ps.apply(this,arguments)}});
 await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.evaluate(()=>window.__bcEnter());await sleep(900);await p.click('#hello-ok');await sleep(400);
 const au=()=>p.evaluate(()=>({...window.__au,fs:!!document.fullscreenElement}));
 console.log('viewport meta:',await p.evaluate(()=>document.querySelector('meta[name=viewport]').content));
 console.log('antes de jogar (lobby, sem som):',JSON.stringify(await au()));
 await p.evaluate(()=>{document.querySelector('#rail .card[data-k="4x4"]').click()});await sleep(300);await p.evaluate(()=>window.__bcSolo());await sleep(4200);
 await p.evaluate(()=>{setInterval(()=>{try{window.__arena._s().players[0].inv=999}catch(e){}},300)});const a1=await au();await sleep(2000);const a2=await au();console.log('musica tocando: osc',a1.osc,'->',a2.osc,'em 2s | estado',a2.state,'| tela cheia auto:',a2.fs);
 // efeitos: bomba + explosao
 const s0=(await au()).src;await p.keyboard.down(' ');await sleep(250);await p.keyboard.up(' ');await sleep(3200);const s1=(await au()).src;console.log('efeitos (fontes de ruido da explosao):',s0,'->',s1);
 // mudo
 await p.evaluate(()=>document.querySelector('[data-act="mute"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true})));await sleep(900);const m1=await au();await sleep(1500);const m2=await au();console.log('mudo: osc',m1.osc,'->',m2.osc,'(deve parar de crescer)');
 await p.evaluate(()=>document.querySelector('[data-act="mute"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true})));await sleep(1800);const u2=await au();console.log('som de volta: osc',m2.osc,'->',u2.osc);
 // musica 0 pelas configuracoes
 await p.evaluate(()=>{const e=document.getElementById('c-mus');e.value=0;e.dispatchEvent(new Event('input',{bubbles:true}))});await sleep(900);const z1=await au();await sleep(1500);const z2=await au();console.log('musica 0%: MUS.on =',await p.evaluate(()=>window.__MUS.on),'(deve ser false)');
 await p.evaluate(()=>{const e=document.getElementById('c-mus');e.value=60;e.dispatchEvent(new Event('input',{bubbles:true}))});await sleep(1800);const z3=await au();console.log('musica 60%: MUS.on =',await p.evaluate(()=>window.__MUS.on),'(deve ser true) | acelera na morte subita:',await p.evaluate(()=>{window.__MUS.sd=true;return window.__MUS.sd}));
 // zoom por toque duplo
 const r=await p.evaluate(()=>{const out=[];document.addEventListener('touchend',e=>out.push(e.defaultPrevented),false);const t=document.getElementById('arena');
  const mk=()=>new Event('touchend',{bubbles:true,cancelable:true});t.dispatchEvent(mk());t.dispatchEvent(mk());return out});
 console.log('partida ainda ativa no fim do teste:',await p.evaluate(()=>({ended:window.__arena._s().ended,playing:document.body.classList.contains('playing')})));
 console.log('toque duplo no jogo: 1o prevented?',r[0],'| 2o prevented?',r[1]);
 console.log('erros de pagina:',errs.length?errs.join(' | '):'nenhum');
 await b.close();process.exit(0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
