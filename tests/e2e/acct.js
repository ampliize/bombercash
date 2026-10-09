// Ajuda dos testes: cria conta (mock do Supabase Auth), completa o cadastro com CPF e deposita por PIX simulado.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cpf(seed){const d=String(100000000+seed).slice(-9).split('').map(Number);
 for(const n of [9,10]){let s=0;for(let i=0;i<n;i++)s+=d[i]*(n+1-i);const r=s*10%11;d.push(r===10?0:r)}return d.join('')}
async function signup(p,email){await p.evaluate(()=>document.getElementById('login-open').click());await sleep(200);
 await p.click('#au-tabs [data-v="up"]');await p.fill('#au-email',email);await p.fill('#au-pass','senha-segura-1');await p.click('#au-ok');
 await p.waitForFunction(()=>document.getElementById('kyc').open,null,{timeout:5000})}
async function kyc(p,c,nick,keepTut){await p.fill('#ky-name','Fulano de Tal');await p.fill('#ky-cpf',c);await p.fill('#ky-birth','1990-05-10');await p.fill('#ky-nick',nick);
 await p.check('#ky-ok18');await p.click('#ky-go');await p.waitForFunction(()=>!document.getElementById('kyc').open,null,{timeout:5000});
 if(!keepTut){await p.waitForFunction(()=>document.getElementById('tut').open,null,{timeout:5000});await p.click('#tu-skip')}}
async function deposit(p,reais){await p.evaluate(()=>document.getElementById('dep-open').click());await sleep(200);await p.fill('#dp-val',String(reais));await p.click('#dp-go');
 await p.waitForFunction(()=>!document.getElementById('dp-step2').hidden,null,{timeout:5000});
 await p.evaluate(()=>fetch('/__pay',{method:'POST',body:'{}'}));
 await p.waitForFunction(r=>/Pagamento confirmado/.test(document.getElementById('dp-status').textContent)&&document.getElementById('bal').textContent.includes(String(r)),reais,{timeout:9000});
 await p.click('#dp-done')}
module.exports={cpf,signup,kyc,deposit};
