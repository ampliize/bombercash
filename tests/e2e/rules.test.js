// Aviso de jogo responsável (caixa + confirmar), sair do jogo, mapa sempre aleatório, ID com 7 dígitos, bomba inicial com alcance 1.
const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const c=await b.newContext({viewport:{width:900,height:800}});const p=await c.newPage();p.on('pageerror',e=>ok(false,'pageerror '+e.message));
 await p.addInitScript(()=>{window.__bcCount=0;localStorage.setItem('bc_cfg',JSON.stringify({fs:false}))});
 await p.goto('http://127.0.0.1:8765/?rg');await sleep(1200);await p.evaluate(()=>window.__bcEnter());await sleep(600);await p.click('#hello-ok');await sleep(800);
 ok(!(await p.$('#d-map'))&&!(await p.$('#maprail')),'não tem mais escolha de mapa');
 ok(/^ID \d{7}$/.test(await p.textContent('#me-id')),'ID com 7 dígitos: '+await p.textContent('#me-id'));
 await p.evaluate(()=>{document.querySelector('#rail .card[data-k="1x1"]').click()});await sleep(300);await p.evaluate(()=>document.getElementById('d-ok').click());await sleep(300);
 ok(await p.$eval('#rg',d=>d.open)&&!(await p.evaluate(()=>window.__arena.active)),'jogar sem aceitar o aviso: aparece o aviso e a partida não começa');
 await p.click('#rg-no');await p.evaluate(()=>document.getElementById('dlg').open&&document.getElementById('dlg').close());await sleep(200);
 // escolher valor abre o aviso
 await p.click('#chips .chip[data-b="10"]');await sleep(300);
 ok(await p.$eval('#rg',d=>d.open),'escolher o valor abre o aviso de jogo responsável');
 ok(/JOGUE COM RESPONSABILIDADE/.test(await p.textContent('#rg'))&&/nunca tente recuperar perdas/.test(await p.textContent('#rg')),'texto do aviso completo');
 ok(await p.$eval('#rg-ok',e=>e.disabled),'Confirmar travado sem marcar a caixa');
 await p.click('#rg-no');await sleep(200);ok(await p.evaluate(()=>JSON.parse(localStorage.bc_bet||'5'))!==10,'cancelar não troca o valor');
 await p.click('#chips .chip[data-b="10"]');await sleep(200);await p.click('#rg-ck');ok(!(await p.$eval('#rg-ok',e=>e.disabled)),'marcou a caixa: Confirmar liberado');
 await p.click('#rg-ok');await sleep(200);ok(await p.evaluate(()=>JSON.parse(localStorage.bc_bet))===10&&!(await p.$eval('#rg',d=>d.open)),'confirmou: valor R$ 10 aplicado');
 // partida: aviso já aceito nesta sessão, mapa sorteado, bomba alcance 1
 await p.evaluate(()=>{document.querySelector('#rail .card[data-k="1x1"]').click()});await p.evaluate(()=>document.getElementById('d-ok').click());
 await p.waitForFunction(()=>window.__arena.active,null,{timeout:8000});await sleep(500);
 const st=await p.evaluate(()=>{const s=window.__arena._s();return{pw:s.players.map(q=>q.power),map:window.__arena.map}});
 ok(st.pw.every(v=>v===1),'bomba inicial com alcance 1 bloco');
 await p.evaluate(()=>document.getElementById('ar-back').click());await sleep(400);
 // sair do jogo
 await p.click('#quit-open');await sleep(200);ok(await p.$eval('#quit',d=>d.open),'botão Sair abre a confirmação');
 await Promise.all([p.waitForNavigation({timeout:8000}),p.click('#quit-ok')]);await sleep(1200);
 ok(!!(await p.$('#intro')),'Sair do jogo volta para a tela inicial');
 ok(await p.evaluate(()=>sessionStorage.getItem('bc_rg'))!=='1','depois de sair o aviso volta a ser pedido');
 await b.close();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
