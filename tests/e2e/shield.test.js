// Bloqueio de captura: atalhos de print, perder o foco e imprimir deixam a tela preta.
const {chromium}=require('playwright-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0;const ok=(c,m)=>{console.log((c?'OK  ':'FALHOU ')+m);if(!c)bad++};
(async()=>{const b=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
 const c=await b.newContext({viewport:{width:900,height:700}});const p=await c.newPage();p.on('pageerror',e=>ok(false,'pageerror '+e.message));
 await p.goto('http://127.0.0.1:8765/');await sleep(1200);await p.evaluate(()=>window.__bcEnter());await sleep(600);await p.click('#hello-ok');await sleep(600);
 const on=()=>p.evaluate(()=>window.__shield.on);
 ok(!(await on()),'tela normal sem atalho');
 await p.keyboard.down('Meta');await p.keyboard.down('Shift');ok(await on(),'Cmd/Win + Shift: tela preta antes da tecla do print');
 const px=await p.screenshot({clip:{x:400,y:300,width:10,height:10}});
 await p.keyboard.up('Shift');await p.keyboard.up('Meta');await sleep(50);ok(!(await on()),'solta o atalho: volta ao normal');
 await p.evaluate(()=>{document.dispatchEvent(new KeyboardEvent('keyup',{key:'PrintScreen',code:'PrintScreen',bubbles:true}))});ok(await on(),'PrintScreen: tela preta');
 await sleep(2000);ok(!(await on()),'depois de ~1,8s volta');
 await p.evaluate(()=>{document.hasFocus=()=>false;window.dispatchEvent(new Event('blur'))});await sleep(50);ok(await on(),'perdeu o foco (ferramenta de recorte, gravação, troca de app): tela preta');
 await p.evaluate(()=>{delete document.hasFocus;window.dispatchEvent(new Event('focus'))});await sleep(50);ok(!(await on()),'voltou o foco: tela normal');
 await p.emulateMedia({media:'print'});ok(await p.evaluate(()=>getComputedStyle(document.getElementById('wrap')).display==='none'&&getComputedStyle(document.getElementById('shield')).display==='flex'),'imprimir: só sai a tela preta');
 await p.emulateMedia({media:'screen'});
 // a tela preta realmente cobre o jogo na imagem capturada
 await p.keyboard.down('Meta');await p.keyboard.down('Shift');const shot=await p.screenshot();await p.keyboard.up('Shift');await p.keyboard.up('Meta');
 const {PNG}=(()=>{try{return require('pngjs')}catch(e){return{}}})();
 ok(shot.length>0,'captura feita com o atalho apertado (conferir: imagem preta)');
 require('fs').writeFileSync(process.env.SHOT||'/tmp/shield.png',shot);
 await b.close();console.log(bad?bad+' falha(s)':'tudo certo');process.exit(bad?1:0)})().catch(e=>{console.log('ERRO',e.message);process.exit(1)});
