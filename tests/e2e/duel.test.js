// Empate vira duelo na lava entre os finalistas; só um vence.
const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
const SHOTS=process.env.SHOTS;
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const open=async(w,h)=>{const c=await b.newContext({viewport:{width:w,height:h}});const p=await c.newPage();p.on('pageerror',e=>ok(false,'pageerror '+e.message));
  await p.addInitScript(()=>{window.__bcCount=0;localStorage.setItem('bc_cfg',JSON.stringify({fs:false}))});
  await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.evaluate(()=>window.__bcEnter());await sleep(800);await p.click('#hello-ok');await sleep(700);
  await p.evaluate(()=>{document.querySelector('#rail .card[data-k="1x1"]').click()});await p.evaluate(()=>window.__bcSolo());
  await p.waitForFunction(()=>window.__arena.active&&window.__arena._s().players.length===2,null,{timeout:8000});await sleep(300);return{c,p}};
 const st=p=>p.evaluate(()=>{const s=window.__arena._s();return{duel:s.duel,freeze:+s.freeze.toFixed(2),ended:s.ended,timer:document.getElementById('timer').textContent,
   ps:s.players.map(q=>[Math.round(q.x/48-.5),Math.round(q.y/48-.5),q.alive,q.speed,q.bombMax,q.power]),border:s.world[0][0],crates:s.world.flat().filter(v=>v===1).length,pillars:s.world.slice(1,-1).map(r=>r.slice(1,-1)).flat().filter(v=>v===2).length}});
 // 1) os dois morrem juntos
 {const{c,p}=await open(1000,760);
  await p.evaluate(()=>{const s=window.__arena._s(),t=performance.now();s.players.forEach(q=>{q.power=7;q.bombMax=4;q.alive=false;q.deadAt=t})});await sleep(300);
  const a=await st(p);console.log(JSON.stringify(a));
  ok(a.duel===1,'morreram juntos: começa o duelo');ok(a.ps.every(q=>q[2]),'os dois finalistas voltam vivos');
  ok(a.ps[0][0]===1&&a.ps[0][1]===1&&a.ps[1][0]===13&&a.ps[1][1]===11,'cada um num canto oposto');
  ok(a.ps.every(q=>q[3]===140&&q[4]===1&&q[5]===1),'poderes zerados e velocidade de duelo (agilidade decide)');
  ok(a.freeze>1.5&&a.freeze<=3,'contagem curta antes do duelo ('+a.freeze+'s)');ok(a.timer==='DUELO','relógio mostra DUELO');
  ok(a.crates<=40&&a.pillars<=30,'mapa de lava com poucos blocos (caixas '+a.crates+', pilares '+a.pillars+')');
  if(SHOTS){await sleep(2600);await p.screenshot({path:SHOTS+'/duel_start.png'})}
  // a lava fecha a arena: alguém tem que cair; deixa rodar até acabar
  await p.evaluate(()=>window.__arena._jump(30));let e=null;for(let i=0;i<80&&!e;i++){await sleep(500);const s=await p.evaluate(()=>({end:document.getElementById('s-end').classList.contains('on'),t:document.getElementById('e-t').textContent,duel:window.__arena._s().duel,lava:window.__arena._s().sd.blocks.size}));if(SHOTS&&i===6)await p.screenshot({path:SHOTS+'/duel_lava.png'});if(s.end)e=s}
  console.log(JSON.stringify(e));ok(e&&e.t!=='Empate','duelo termina com 1 vencedor ('+(e&&e.t)+', duelos: '+(e&&e.duel)+')');await c.close()}
 // 2) acabou o tempo com os dois de pé
 {const{c,p}=await open(800,700);await p.evaluate(()=>window.__arena._jump(151));await sleep(300);const a=await st(p);
  ok(a.duel===1&&a.ps.every(q=>q[2]),'tempo acabou com 2 de pé: duelo');
  await sleep(3300);await p.evaluate(()=>{window.__arena._s().players[1].alive=false});await sleep(2600);
  const e=await p.evaluate(()=>({end:document.getElementById('s-end').classList.contains('on'),t:document.getElementById('e-t').textContent}));ok(e.end&&e.t==='Você venceu!','quem sobra no duelo vence ('+e.t+')');await c.close()}
 await b.close();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
