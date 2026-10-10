// 1x1 com amigo: A cria a sala (código + convite), B abre o link do convite e entra; a partida começa só com os dois.
const {chromium}=require('playwright-core'),{spawn}=require('child_process'),path=require('path'),{cpf,signup,kyc,deposit}=require('./acct');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),GS='ws://127.0.0.1:2598';
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
(async()=>{
 const gs=spawn('node',[path.join(__dirname,'../../server/src/index.js')],{env:{...process.env,PORT:'2598',COUNTDOWN:'2',SUPABASE_JWT_SECRET:'mock-secret'},stdio:'ignore'});await sleep(800);
 const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});const T=Date.now();
 const mk=async(i,q)=>{const p=await (await b.newContext({viewport:{width:900,height:820}})).newPage();p.on('pageerror',e=>ok(false,'P'+i+' pageerror '+e.message));
  await p.addInitScript(()=>{window.__bcCount=0;localStorage.setItem('bc_cfg',JSON.stringify({fs:false}))});
  await p.goto('http://127.0.0.1:8765/?gs='+GS+(q||''));await sleep(1300);await p.evaluate(()=>window.__bcEnter());await sleep(700);await p.click('#hello-ok');
  await signup(p,'f'+i+'_'+T+'@teste.com');await kyc(p,cpf((T+i*7717)%1e8),'Amigo'+i+'_'+String(T).slice(-4));await deposit(p,20);return p};
 const A=await mk(1);
 await A.evaluate(()=>{const c=document.querySelector('#chips .chip[data-b="5"]');c.click();const d=document.getElementById('rg');if(d.open){document.getElementById('rg-ck').click();document.getElementById('rg-ok').click()}});
 await A.evaluate(()=>document.querySelector('#rail .card[data-k="4x4"]').click());await sleep(300);
 ok(await A.$eval('#d-how',e=>e.hidden),'modo 4 jogadores não tem convite de amigo');await A.click('#d-no');
 await A.evaluate(()=>document.querySelector('#rail .card[data-k="1x1"]').click());await sleep(300);
 ok(!(await A.$eval('#d-how',e=>e.hidden))&&/online/.test(await A.textContent('#d-how')),'1x1: escolher contra alguém online ou com um amigo');
 await A.click('#d-how [data-v="friend"]');await sleep(200);
 ok(/Criar sala e convidar · R\$ 5,00/.test(await A.textContent('#d-ok'))&&!(await A.$eval('#d-friend',e=>e.hidden)),'com amigo: botão Criar sala e convidar e campo de código');
 await A.evaluate(()=>document.getElementById('d-ok').click());
 await A.waitForFunction(()=>!document.getElementById('d-share').hidden,null,{timeout:6000});
 const code=await A.textContent('#d-scode'),wa=await A.getAttribute('#d-wa','href');
 ok(/^[A-Z0-9]{6}$/.test(code)&&/wa\.me/.test(wa)&&decodeURIComponent(wa).includes('sala='+code+'&v=500'),'sala criada: código '+code+' e convite pelo WhatsApp com o link');
 const B=await mk(2,'&sala='+code+'&v=500');
 await B.waitForFunction(c=>document.getElementById('dlg').open&&document.getElementById('d-code').value===c,code,{timeout:8000});
 ok(/convidou/.test(await B.textContent('#d-msg'))&&/R\$ 5,00/.test(await B.textContent('#d-msg')),'B abriu o link: duelo de R$ 5,00 com o código preenchido');
 await B.click('#d-join');await sleep(300);if(await B.$eval('#rg',d=>d.open)){await B.click('#rg-ck');await B.click('#rg-ok')}
 await A.waitForFunction(()=>window.__arena.active,null,{timeout:8000});await B.waitForFunction(()=>window.__arena.active,null,{timeout:8000});
 const sa=await A.evaluate(()=>({n:window.__arena._s().players.length,me:window.__arena.meIdx})),sb=await B.evaluate(()=>({n:window.__arena._s().players.length,me:window.__arena.meIdx}));
 ok(sa.n===2&&sb.n===2&&sa.me!==sb.me,'partida 1x1 começou só com os dois amigos');
 await b.close();gs.kill();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
