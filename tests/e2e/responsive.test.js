const {chromium}=require('playwright-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const devsAll=[['SE-p',375,667,1],['S8-p',360,640,1],['iP14-p',390,844,1],['PM-p',430,932,1],['Fold-p',280,653,1],['SE-l',667,375,1],['iP14-l',844,390,1],['short-l',740,360,1],['PM-l',932,430,1],['tab-p',768,1024,0],['tab-l',1024,768,0],['lap',1366,768,0],['fhd',1920,1080,0],['uw',2560,1080,0]];
const only=process.argv[2]?process.argv[2].split(','):null;const devs=devsAll.filter(d=>!only||only.includes(d[0]));
const measure=()=>{const r=e=>{const q=e&&e.getBoundingClientRect();return q?[Math.round(q.left),Math.round(q.top),Math.round(q.width),Math.round(q.height)]:null};
 const de=document.documentElement,top=[...document.querySelectorAll('#atop > *')].filter(e=>e.offsetParent!==null).map(e=>e.getBoundingClientRect().right);
 return{vw:innerWidth,vh:innerHeight,scrollW:de.scrollWidth,scrollH:Math.max(de.scrollHeight,document.body.scrollHeight),cv:r(document.getElementById('arena')),stick:r(document.getElementById('stick')),bomb:r(document.getElementById('bombbtn')),jl:r(document.querySelector('.jl')),jr:r(document.querySelector('.jr')),topRight:Math.max(...top),swap:document.querySelector('.console').classList.contains('swap')}};
const check=(m,label)=>{const bad=[];const ov=(a,b)=>a&&b&&a[0]<b[0]+b[2]&&b[0]<a[0]+a[2]&&a[1]<b[1]+b[3]&&b[1]<a[1]+a[3];
 if(m.scrollW>m.vw+1)bad.push('scrollX');if(m.scrollH>m.vh+1)bad.push('scrollY '+m.scrollH);
 if(m.topRight>m.vw+1)bad.push('barra do topo estoura '+Math.round(m.topRight));
 if(m.cv&&(m.cv[0]<0||m.cv[0]+m.cv[2]>m.vw+1||m.cv[1]+m.cv[3]>m.vh+1))bad.push('canvas fora');
 for(const k of ['stick','bomb'])if(m[k]&&(m[k][0]<0||m[k][0]+m[k][2]>m.vw+1||m[k][1]+m[k][3]>m.vh+1||m[k][2]<44))bad.push(k+' ruim '+m[k]);
 if(ov(m.cv,m.stick))bad.push('stick sobre canvas');if(ov(m.cv,m.bomb))bad.push('bomba sobre canvas');
 if(m.jl&&m.jr){const stickRight=(m.stick[0]+m.stick[2]/2)>m.vw/2;if(m.swap&&!stickRight)bad.push('swap nao inverteu');if(!m.swap&&stickRight)bad.push('lado errado')}
 return label+' canvas '+JSON.stringify(m.cv)+' bomba '+m.bomb[2]+'px '+(bad.length?'PROBLEMAS: '+bad.join('; '):'ok')};
(async()=>{
 const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 for(const [n,w,h,touch] of devs){
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:!!touch,hasTouch:!!touch,deviceScaleFactor:2});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.click('#intro');await sleep(1000);await p.click('#hello-ok');await sleep(400);
  const dm=await p.evaluate(()=>{document.querySelector('#rail .card[data-k="4x4"]').click();const d=document.getElementById('dlg'),r=d.getBoundingClientRect();return{bottom:Math.round(r.bottom),vh:innerHeight,scrolls:d.scrollHeight>d.clientHeight}});
  await p.evaluate(()=>document.getElementById('d-ok').click());await sleep(4200);
  const m1=await p.evaluate(measure);console.log(n.padEnd(7),(w+'x'+h).padEnd(9),check(m1,'padrao'),dm.bottom>dm.vh+1?'| DIALOGO MODO ESTOURA':'', errs.length?'ERR '+errs[0]:'');
  await p.screenshot({path:'n_'+n+'.png'});
  await p.evaluate(()=>{const set=(id,v,ev)=>{const e=document.getElementById(id);if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new Event(ev,{bubbles:true}))};set('c-swap',true,'change');set('c-bomb',150,'input');set('c-scr',70,'input');set('c-float',true,'change')});await sleep(400);
  const m2=await p.evaluate(measure);console.log(' '.repeat(18),check(m2,'ajustado'));
  await p.screenshot({path:'n2_'+n+'.png'});
  if(n==='iP14-p'){ // analogico flutuante: toque no canto do painel e confere que o analogico foi para la
   const jl=m2.jl; const sx=jl[0]+(m2.swap?20:20),sy=jl[1]+jl[3]-60;
   const r=await p.evaluate(([x,y])=>{const z=document.querySelector('.jl'),s=document.getElementById('stick');const mk=(t)=>new PointerEvent(t,{pointerId:7,clientX:x,clientY:y,bubbles:true,pointerType:'touch',isPrimary:true});
     const b=s.getBoundingClientRect();z.dispatchEvent(mk('pointerdown'));const a=s.getBoundingClientRect();const cls=s.className;z.dispatchEvent(mk('pointerup'));const e=s.getBoundingClientRect();
     return{antes:[Math.round(b.left),Math.round(b.top)],durante:[Math.round(a.left),Math.round(a.top)],cls,depois:[Math.round(e.left),Math.round(e.top)],clsDepois:s.className}},[sx+40,sy]);
   console.log('   flutuante:',JSON.stringify(r));
  }
  await c.close()}
 // dialogo de configuracoes em tela pequena
 for(const [n,w,h] of [['Fold',280,653],['short-l',740,360],['SE',375,667]]){const c=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true});const p=await c.newPage();await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.click('#intro');await sleep(1000);await p.click('#hello-ok');await sleep(400);
  const r=await p.evaluate(()=>{document.getElementById('cfg-open').click();const d=document.getElementById('cfg'),q=d.getBoundingClientRect();return{top:Math.round(q.top),bottom:Math.round(q.bottom),vh:innerHeight,scroll:d.scrollHeight>d.clientHeight}});console.log('config em',n,JSON.stringify(r),r.bottom<=r.vh+1&&r.top>=-1?'cabe (rola por dentro: '+r.scroll+')':'ESTOURA');await p.screenshot({path:'cfg_'+n+'.png'});await c.close()}
 await b.close();process.exit(0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
