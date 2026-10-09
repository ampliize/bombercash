// Passo a passo: aparece no primeiro login, navega, pula, não volta no login seguinte e reabre no "?".
const {chromium}=require('playwright-core'),{cpf,signup,kyc}=require('./acct');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const ctx=await b.newContext({viewport:{width:390,height:780}});const p=await ctx.newPage();p.on('pageerror',e=>ok(false,'pageerror '+e.message));
 await p.addInitScript(()=>{window.__bcCount=0;localStorage.setItem('bc_cfg',JSON.stringify({fs:false}))});
 await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.evaluate(()=>window.__bcEnter());await sleep(600);await p.click('#hello-ok');await sleep(400);
 ok(!(await p.$eval('#tut',d=>d.open)),'sem login: o passo a passo não aparece sozinho');
 const T=Date.now(),email='t'+T+'@teste.com';
 await p.evaluate(()=>{document.querySelector('#rail .card[data-k="1x1"]').click()});await sleep(200);await p.evaluate(()=>document.getElementById('d-ok').click());await sleep(300);
 await signup(p,email);await kyc(p,cpf(T%1e8+3),'Tut_'+String(T).slice(-4),true);
 await p.waitForFunction(()=>document.getElementById('tut').open,null,{timeout:5000});
 ok(/PASSO 1 DE 6/.test(await p.textContent('#tu-n'))&&await p.$eval('#tu-back',e=>e.hidden),'primeiro login: abre no passo 1 de 6');
 ok(await p.isVisible('#tu-skip'),'tem o botão Pular passo a passo');
 await p.click('#tu-next');await p.click('#tu-next');ok(/1 bloco de cada lado/.test(await p.textContent('#tu-b')),'passo 3 ensina a bomba');
 await p.click('#tu-back');ok(/PASSO 2/.test(await p.textContent('#tu-n')),'Voltar funciona');
 for(let i=0;i<4;i++)await p.click('#tu-next');
 ok(await p.textContent('#tu-next')==='Começar a jogar'&&!(await p.isVisible('#tu-skip')),'último passo: Começar a jogar');
 const sh=await p.screenshot();require('fs').writeFileSync(__dirname+'/tut_last.png',sh);
 await p.click('#tu-next');await sleep(300);ok(!(await p.$eval('#tut',d=>d.open)),'terminou: fecha');ok(await p.$eval('#dep',d=>d.open),'depois do passo a passo segue o caminho para jogar (depósito)');await p.click('#dp-no');
 await p.evaluate(()=>document.getElementById('d-no').click());await sleep(200);await p.click('#tut-open');await sleep(200);ok(await p.$eval('#tut',d=>d.open)&&/PASSO 1/.test(await p.textContent('#tu-n')),'botão ? reabre o passo a passo');
 await p.click('#tu-skip');await sleep(200);ok(!(await p.$eval('#tut',d=>d.open)),'Pular fecha');
 // novo login na mesma conta: não aparece de novo
 await p.evaluate(()=>{localStorage.removeItem('bc_sess')});await p.reload();await sleep(1500);
 await p.evaluate(()=>document.getElementById('login-open').click());await p.fill('#au-email',email);await p.fill('#au-pass','senha-segura-1');await p.click('#au-ok');await sleep(1200);
 ok(!(await p.$eval('#tut',d=>d.open))&&!(await p.$eval('#auth',d=>d.open)),'login seguinte: não mostra de novo');
 // outra conta nova: pular logo no passo 1
 const p2=await (await b.newContext({viewport:{width:900,height:800}})).newPage();p2.on('pageerror',e=>ok(false,'pageerror '+e.message));
 await p2.goto('http://127.0.0.1:8765/');await sleep(1200);await p2.evaluate(()=>window.__bcEnter());await sleep(600);await p2.click('#hello-ok');
 await signup(p2,'u'+T+'@teste.com');await kyc(p2,cpf(T%1e8+11),'Tuu_'+String(T).slice(-4),true);
 await p2.waitForFunction(()=>document.getElementById('tut').open,null,{timeout:5000});await p2.click('#tu-skip');await sleep(200);
 ok(!(await p2.$eval('#tut',d=>d.open))&&await p2.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('bc_tut_'))),'pular no passo 1 fecha e fica lembrado');
 await b.close();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
