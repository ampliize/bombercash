const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const views=[['land',844,390,1],['port',390,844,1],['lap',1366,768,0],['uw',2560,1080,0]];
const times=[0.1,0.5,1.0,1.6,2.2,2.8,3.4,4.2];
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 for(const [n,w,h,touch] of views){const c=await b.newContext({viewport:{width:w,height:h},isMobile:!!touch,hasTouch:!!touch,deviceScaleFactor:1});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/');await p.waitForFunction(()=>document.getElementById('intro')&&document.getElementById('intro').classList.contains('art'),null,{timeout:6000}).catch(()=>console.log(n,'sem art!'));
  for(const t of times){await p.evaluate(x=>window.__sp.seek(x),t);await sleep(120);await p.screenshot({path:`fr/${n}_${String(t).replace('.','_')}.png`})}
  console.log(n,'ok',errs.length?errs.join('|'):'sem erros');await c.close()}
 await b.close();process.exit(0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
