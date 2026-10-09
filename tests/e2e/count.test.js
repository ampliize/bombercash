// Contagem de 10s antes da partida: números na tela, bonecos e relógio parados, depois "VAI!" e o jogo libera.
const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const c=await b.newContext({viewport:{width:900,height:700}});const p=await c.newPage();p.on('pageerror',e=>ok(false,'pageerror '+e.message));
 await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.evaluate(()=>window.__bcEnter());await sleep(1000);await p.click('#hello-ok');await sleep(500);
 await p.evaluate(()=>{document.querySelector('#rail .card[data-k="1x1"]').click()});await p.evaluate(()=>window.__bcSolo());await p.waitForFunction(()=>window.__arena.active&&window.__arena._s().players.length>1,null,{timeout:8000});await sleep(300);
 const st=()=>p.evaluate(()=>{const c=document.getElementById('count'),s=window.__arena._s(),me=s.players[window.__arena.meIdx];return{vis:!c.hidden,txt:c.textContent,x:Math.round(me.x),t:document.getElementById('timer').textContent,bots:s.players.filter((q,i)=>i!==window.__arena.meIdx).map(q=>Math.round(q.x)+','+Math.round(q.y)).join(' ')}});
 const a=await st();ok(a.vis&&/^(10|9)A partida começa em/.test(a.txt),'mostra a contagem no início: "'+a.txt+'"');
 await p.keyboard.down('ArrowRight');await sleep(1500);const b1=await st();await p.keyboard.up('ArrowRight');
 ok(b1.x===a.x,'boneco não anda durante a contagem');ok(b1.bots===a.bots,'bots parados durante a contagem');ok(b1.t==='2:30','relógio parado em 2:30');ok(/^[7-9]/.test(b1.txt),'contagem descendo: "'+b1.txt+'"');
 await sleep(7600);const c1=await st();ok(c1.vis&&/^[1-3]$/.test(c1.txt),'perto do fim: "'+c1.txt+'"');
 let go=false;for(let i=0;i<30&&!go;i++){await sleep(100);go=(await st()).txt==='VAI!'}ok(go,'mostra VAI!');
 await p.keyboard.down('ArrowRight');await sleep(800);await p.keyboard.up('ArrowRight');const d=await st();ok(d.x>a.x,'depois da contagem o boneco anda');
 await sleep(800);ok((await st()).vis===false,'contagem some da tela');
 await b.close();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
