const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,m)=>{console.log((c?'OK  ':'FALHA ')+m);if(!c)process.exitCode=1};
const launch=()=>chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
(async()=>{
 const b=await launch();
 // 1) reproducao em tempo real + fluidez
 {const c=await b.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{window.__dts=[];let l=0;const f=ts=>{if(l)window.__dts.push(ts-l);l=ts;requestAnimationFrame(f)};requestAnimationFrame(f)});
  await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>document.getElementById('intro').classList.contains('art'),null,{timeout:6000});
  const t0=Date.now();await sleep(1500);const mid=await p.evaluate(()=>({t:window.__sp.t,cta:document.getElementById('intro').classList.contains('cta')}));
  ok(mid.t>1&&mid.t<2.2&&!mid.cta,'aos ~1.5s a revelacao esta em andamento (t='+mid.t.toFixed(2)+')');
  await sleep(3200);const end=await p.evaluate(()=>({t:window.__sp.t,cta:document.getElementById('intro').classList.contains('cta'),mask:document.getElementById('sp-cam').style.maskImage}));
  ok(end.cta&&end.t>3.8,'ao fim aparece "Toque para jogar" (cta, t='+end.t.toFixed(2)+')');ok(end.mask==='none'||end.mask==='','mascara removida no fim (sem custo de renderizacao)');
  const d=await p.evaluate(()=>window.__dts.slice(5));d.sort((a,b)=>a-b);const avg=d.reduce((a,b)=>a+b,0)/d.length,p95=d[Math.floor(d.length*.95)],mx=d[d.length-1];
  console.log('   quadros:',d.length,'| intervalo medio',avg.toFixed(1)+'ms','| p95',p95.toFixed(1)+'ms','| maior',mx.toFixed(1)+'ms (headless sem GPU; no aparelho real e mais fluido)');
  ok(avg<40,'intervalo medio razoavel mesmo sem GPU');
  await p.screenshot({path:'sp_end.png'});
  // toque -> exit -> aviso 18+
  await p.touchscreen.tap(400,200);await sleep(1400);
  ok(await p.evaluate(()=>document.getElementById('intro').classList.contains('msg')),'toque abre o aviso de 18+');
  await p.screenshot({path:'sp_age.png'});
  await p.click('#hello-ok');await sleep(900);
  ok(await p.evaluate(()=>!document.getElementById('intro')),'confirmar 18+ remove a abertura e mostra o lobby');
  ok(errs.length===0,'sem erros de pagina '+errs.join('|'));await c.close()}
 // 2) toque no meio da animacao (pula rapido sem quebrar)
 {const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>document.getElementById('intro').classList.contains('art'),null,{timeout:6000});await sleep(700);
  await p.touchscreen.tap(200,400);await sleep(1800);
  ok(await p.evaluate(()=>document.getElementById('intro').classList.contains('msg')),'toque aos 0.7s acelera a revelacao e abre o aviso de 18+ em ~1.8s');ok(errs.length===0,'sem erros (toque cedo)');await c.close()}
 // 3) girar o aparelho durante a abertura
 {const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>document.getElementById('intro').classList.contains('art'),null,{timeout:6000});await sleep(900);
  const s1=await p.evaluate(()=>document.getElementById('sp-art').src);await p.setViewportSize({width:844,height:390});await sleep(1200);
  const s2=await p.evaluate(()=>document.getElementById('sp-art').src);ok(s1.includes('splash-v')&&s2.includes('splash-h'),'girar troca a arte vertical por horizontal ('+s1.split('/').pop()+' -> '+s2.split('/').pop()+')');ok(errs.length===0,'sem erros ao girar');await c.close()}
 // 4) reduzir movimento
 {const c=await b.newContext({viewport:{width:844,height:390},reducedMotion:'reduce'});const p=await c.newPage();
  await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>document.getElementById('intro').classList.contains('art'),null,{timeout:6000});await sleep(300);
  const r=await p.evaluate(()=>({t:window.__sp.t,cta:document.getElementById('intro').classList.contains('cta')}));ok(r.cta&&r.t>3.8,'"reduzir movimento": mostra direto o quadro final, sem animar');
  await p.mouse.click(400,200);await sleep(500);ok(await p.evaluate(()=>document.getElementById('intro').classList.contains('msg')),'toque funciona sem animacao');await c.close()}
 await b.close();process.exit(process.exitCode||0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
