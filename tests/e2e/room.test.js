const {chromium}=require('playwright-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});const pages=[];
 for(let i=0;i<3;i++){const c=await b.newContext({viewport:{width:900,height:800}});const p=await c.newPage();await p.addInitScript(()=>{window.__bcCount=1});p.on('pageerror',e=>console.log('P'+(i+1)+' pageerror:',e.message));await p.goto('http://127.0.0.1:8765/');pages.push(p)}
 await sleep(2500);
 for(const p of pages){await p.click('#intro');await sleep(1200);await p.click('#hello-ok');}
 await sleep(2500);
 const [A,B,C]=pages;
 // pular qualquer tela de introducao
 for(const p of pages){const st=await p.evaluate(()=>({intro:!!document.getElementById('intro'),lobby:document.getElementById('s-lobby').classList.contains('on')}));console.log('state',JSON.stringify(st))}
 await A.click('#rm-open');await A.click('#rm-create');await A.waitForFunction(()=>document.getElementById('rm-c').textContent.length===5,null,{timeout:8000});
 const code=await A.textContent('#rm-c');console.log('codigo',code);
 for(const p of [B,C]){await p.click('#rm-open');await p.fill('#rm-code',code);await p.press('#rm-code','Enter')}
 await A.waitForFunction(()=>document.querySelectorAll('#rm-list li').length===3,null,{timeout:8000});
 console.log('roster host:',await A.$$eval('#rm-list li',l=>l.map(x=>x.textContent)));
 await B.waitForFunction(()=>document.querySelectorAll('#rm-list li').length===3,null,{timeout:8000});
 console.log('roster B ok; start disabled?',await A.$eval('#rm-start',e=>e.disabled));
 await A.click('#rm-start');await sleep(3500);
 for(const [n,p] of [['A',A],['B',B],['C',C]]){console.log(n,JSON.stringify(await p.evaluate(()=>({arena:document.getElementById('s-arena').classList.contains('on'),active:window.__arena.active,me:window.__arena.meIdx,n:window.__arena._s().players.length,ctrl:window.__arena._s().players.map(x=>x.ctrl),bal:window.__t.bal()}))))}

 // fim de partida: elimina B, C e o bot no host -> A vence; premio = 3 humanos x 5 = 15
 await A.evaluate(()=>{const ps=window.__arena._s().players;[1,2,3].forEach(i=>{ps[i].alive=false})});
 await sleep(4500);
 for(const [n,p] of [['A',A],['B',B],['C',C]]){console.log(n,JSON.stringify(await p.evaluate(()=>({lobbyEnd:document.getElementById('s-end').classList.contains('on'),titulo:(document.getElementById('e-t')||{}).textContent,msg:(document.getElementById('e-p')||{}).textContent,bal:window.__t.bal(),net:!!window.__t.net()}))))}
 console.log('relatorios:',JSON.stringify(await (await fetch('http://127.0.0.1:8765/__reports')).json().then(a=>a.map(x=>({mode:x.p_mode,res:x.p_result,kind:x.p_kind,stake:x.p_stake,opp:x.p_opponents})))));
 await b.close();process.exit(0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
