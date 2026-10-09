// Sala com amigos rodando no servidor autoritativo (server/): 2 aparelhos, movimento e bomba decididos pelo servidor.
// Requer o mock (npm run mock) na 8765; este teste sobe o servidor de jogo na 2599.
const {chromium}=require('playwright-core'),{spawn}=require('child_process'),path=require('path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),GS='ws://127.0.0.1:2599';
(async()=>{
 const gs=spawn('node',[path.join(__dirname,'../../server/src/index.js')],{env:{...process.env,PORT:'2599',COUNTDOWN:'3'},stdio:'inherit'});await sleep(800);
 const fail=m=>{console.log('FALHOU:',m);gs.kill();process.exit(1)};
 const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});const pages=[];
 for(let i=0;i<2;i++){const c=await b.newContext({viewport:{width:900,height:800}});const p=await c.newPage();p.on('pageerror',e=>fail('P'+(i+1)+' pageerror: '+e.message));await p.goto('http://127.0.0.1:8765/?gs='+GS);pages.push(p)}
 await sleep(2500);
 for(const p of pages){await p.evaluate(()=>window.__bcEnter());await sleep(1200);await p.click('#hello-ok')}
 await sleep(1500);
 const [A,B]=pages;
 await A.click('#rm-open');await A.click('#rm-create');await A.waitForFunction(()=>/^\d{4}$/.test(document.getElementById('rm-c').textContent),null,{timeout:8000});
 const code=await A.textContent('#rm-c');console.log('codigo',code);
 await B.click('#rm-open');await B.fill('#rm-code',code);await B.press('#rm-code','Enter');
 await A.waitForFunction(()=>document.querySelectorAll('#rm-list li').length===2,null,{timeout:8000});
 console.log('roster:',await B.$$eval('#rm-list li',l=>l.map(x=>x.textContent)));
 if(!await B.$eval('#rm-start',e=>e.hidden))fail('convidado não deveria ver Começar');
 await A.click('#rm-start');await sleep(1500);
 const st=p=>p.evaluate(()=>{const s=window.__arena._s();return{arena:document.getElementById('s-arena').classList.contains('on'),me:window.__arena.meIdx,n:s.players.length,ctrl:s.players.map(x=>x.ctrl),p:s.players.map(x=>[Math.round(x.x),Math.round(x.y),x.alive])}});
 const a0=await st(A),b0=await st(B);console.log('A',JSON.stringify(a0));console.log('B',JSON.stringify(b0));
 if(!a0.arena||!b0.arena||a0.me!==0||b0.me!==1||a0.n!==2)fail('partida não começou certo');
 if(JSON.stringify(a0.p)!==JSON.stringify(b0.p))fail('posições iniciais diferentes');
 const cd=await A.evaluate(()=>{const c=document.getElementById('count');return{vis:!c.hidden,t:c.textContent}});console.log('contagem',JSON.stringify(cd));if(!cd.vis||!/^[1-3]/.test(cd.t))fail('contagem não apareceu');
 await sleep(2000); // contagem
 // B anda para cima por 0,6s: o servidor move e A vê
 await B.keyboard.down('ArrowUp');await sleep(600);await B.keyboard.up('ArrowUp');await sleep(500);
 const a1=await st(A),b1=await st(B);console.log('apos andar A ve',JSON.stringify(a1.p[1]),'B ve',JSON.stringify(b1.p[1]));
 if(!(a1.p[1][1]<a0.p[1][1]-20))fail('A não viu B andar');
 if(Math.abs(a1.p[1][1]-b1.p[1][1])>6)fail('B e servidor divergiram');
 // trapaça: B tenta se teleportar mexendo no próprio boneco; o servidor corrige
 await B.evaluate(()=>{const p=window.__arena._s().players[1];p.x=48*7.5;p.y=48*6.5});await sleep(500);
 const b2=await st(B);console.log('apos teleporte B',JSON.stringify(b2.p[1]));
 if(Math.abs(b2.p[1][0]-a1.p[1][0])>6||Math.abs(b2.p[1][1]-a1.p[1][1])>6)fail('teleporte não foi corrigido');
 // A solta bomba e fica parado: morre; B vence
 await A.keyboard.down(' ');await sleep(150);await A.keyboard.up(' ');
 await sleep(5500);
 for(const [n,p] of [['A',A],['B',B]]){const r=await p.evaluate(()=>({fim:document.getElementById('s-end').classList.contains('on'),t:document.getElementById('e-t').textContent}));console.log(n,JSON.stringify(r));
  if(!r.fim)fail(n+' não chegou ao fim');if(r.t!==(n==='A'?'Derrota':'Você venceu!'))fail(n+' resultado errado')}
 console.log('OK servidor autoritativo');await b.close();gs.kill();process.exit(0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
