// Partida de verdade: 2 navegadores entram na fila do 1x1 com o mesmo valor; o servidor junta, começa e decide.
// Requer o mock (npm run mock) na 8765; este teste sobe o servidor de jogo na 2599.
const {chromium}=require('playwright-core'),{spawn}=require('child_process'),path=require('path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),GS='ws://127.0.0.1:2599';
(async()=>{
 const gs=spawn('node',[path.join(__dirname,'../../server/src/index.js')],{env:{...process.env,PORT:'2599',COUNTDOWN:'3'},stdio:'inherit'});await sleep(800);
 const fail=m=>{console.log('FALHOU:',m);gs.kill();process.exit(1)};
 const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});const pages=[];
 for(let i=0;i<3;i++){const c=await b.newContext({viewport:{width:900,height:800}});const p=await c.newPage();p.on('pageerror',e=>fail('P'+(i+1)+' pageerror: '+e.message));await p.goto('http://127.0.0.1:8765/?gs='+GS);pages.push(p)}
 await sleep(2000);
 for(const p of pages){await p.evaluate(()=>window.__bcEnter());await sleep(700);await p.click('#hello-ok')}
 await sleep(800);
 const [A,B,C]=pages;
 const queue=async(p,k,v)=>{await p.evaluate(v=>{const c=document.querySelector('#chips .chip[data-b="'+v+'"]');c&&c.click();const d=document.getElementById('rg');if(d.open){document.getElementById('rg-ck').click();document.getElementById('rg-ok').click()}},v);await sleep(200);
  await p.evaluate(k=>document.querySelector('#rail .card[data-k="'+k+'"]').click(),k);await sleep(300);await p.evaluate(()=>document.getElementById('d-ok').click())};
 await queue(A,'1x1',5);await sleep(700);
 const msgA=await A.textContent('#d-msg');console.log('A na fila:',msgA);if(!/1\/2/.test(msgA))fail('A deveria estar esperando 1/2');
 await queue(C,'1x1',10);await sleep(700);  // outro valor: não junta com A
 if(!/1\/2/.test(await C.textContent('#d-msg')))fail('C (R$ 10) deveria esperar sozinho');
 await queue(B,'1x1',5);await sleep(1500);
 const st=p=>p.evaluate(()=>{const s=window.__arena._s();return{arena:document.getElementById('s-arena').classList.contains('on'),me:window.__arena.meIdx,n:s.players.length,ctrl:s.players.map(x=>x.ctrl),p:s.players.map(x=>[Math.round(x.x),Math.round(x.y),x.alive])}});
 const a0=await st(A),b0=await st(B);console.log('A',JSON.stringify(a0));console.log('B',JSON.stringify(b0));
 if(!a0.arena||!b0.arena||a0.n!==2||a0.ctrl.includes('ai'))fail('partida não começou com 2 pessoas sem bots');
 if(a0.me===b0.me)fail('os dois na mesma vaga');
 if(await C.evaluate(()=>window.__arena.active))fail('C entrou numa partida errada');
 await C.evaluate(()=>document.getElementById('d-no').click());
 const cd=await A.evaluate(()=>{const c=document.getElementById('count');return{vis:!c.hidden,t:c.textContent}});console.log('contagem',JSON.stringify(cd));if(!cd.vis)fail('contagem não apareceu');
 await sleep(3000);
 const [W,L]=a0.me===0?[B,A]:[A,B]; // quem está na vaga 0 solta a bomba e fica parado: perde
 await L.keyboard.down(' ');await sleep(150);await L.keyboard.up(' ');
 await sleep(5500);
 for(const [n,p,exp] of [['perdedor',L,'Derrota'],['vencedor',W,'Você venceu!']]){const r=await p.evaluate(()=>({fim:document.getElementById('s-end').classList.contains('on'),t:document.getElementById('e-t').textContent,rows:document.querySelectorAll('#e-rank li').length}));console.log(n,JSON.stringify(r));
  if(!r.fim||r.t!==exp)fail(n+' resultado errado');if(r.rows!==2)fail('classificação deveria ter 2 jogadores')}
 console.log('OK fila + servidor autoritativo');await b.close();gs.kill();process.exit(0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
