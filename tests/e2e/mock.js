const http=require('http'),fs=require('fs'),{WebSocketServer}=require('ws');
const PORT=8765;let uid=100;
const mkHtml=()=>fs.readFileSync(require('path').join(__dirname,'../../demo/index.html'),'utf8').replace('<head>','<head><script>if(!/[?&]rg\\b/.test(location.search))try{sessionStorage.setItem(\'bc_rg\',\'1\')}catch(e){}if(!/[?&]clash\\b/.test(location.search))window.__noClashAuto=true;</script>').replace("let mq=null;","let mq=null;/* só no teste: partida local para exercitar o motor (o jogo real não tem bots) */window.__bcSolo=k=>{if(k){mode=MODES[k];mode.k=k}if($('dlg').open)$('dlg').close();show('s-arena');arena.begin(mode.n,finish,{map:-1,names:[me.nick],skins:window.__bcSkins||null,sdAt:window.__bcSdAt});fit()};").replace("https://tuowzfpbpjxknouodzgb.supabase.co","http://127.0.0.1:"+PORT).replace("const arena=BC.create({canvas:cv,keys,","const arena=window.__arena=BC.create({canvas:cv,keys,").replace("const MUS={on:false,timer:0,next:0,step:0,sd:false,bpm:128};","const MUS=window.__MUS={on:false,timer:0,next:0,step:0,sd:false,bpm:128};").replace("let rm=null,rmStartMsg=null;","let rm=null,rmStartMsg=null;window.__t={bal:()=>bal,net:()=>net};");
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,GET,OPTIONS'};
const srv=http.createServer((req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}
 // ---- conta real simulada: Supabase Auth, RPCs my_*, Edge Functions (account, pix-deposit, pix-withdraw) ----
 if(req.url.startsWith('/auth/v1/')||req.url.startsWith('/functions/v1/')||/\/rest\/v1\/rpc\/(my_|clash_)/.test(req.url)||req.url.startsWith('/__pay')||req.url.startsWith('/__clash')){let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  const A=global.ACC=global.ACC||{users:{},wallet:{},profiles:{},deps:[],wds:[],clash:{}},send=(st,o)=>{res.writeHead(st,{...cors,'Content-Type':'application/json'});res.end(JSON.stringify(o))};
  const a=b?JSON.parse(b):{},u=req.url.split('?')[0],bear=(req.headers.authorization||'').replace('Bearer ',''),who=bear.split('.').length===3?(()=>{try{return JSON.parse(Buffer.from(bear.split('.')[1],'base64url')).sub}catch(e){return null}})():null;
  const jwt=(id,nick)=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),pl=Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,user_metadata:{nickname:nick}})).toString('base64url');return h+'.'+pl+'.'+require('crypto').createHmac('sha256','mock-secret').update(h+'.'+pl).digest('base64url')};
  const sess=x=>({access_token:jwt(x.id,x.nick),refresh_token:'r-'+x.id,expires_in:3600,user:{id:x.id,email:x.email}});
  if(u==='/auth/v1/signup'){if(A.users[a.email])return send(422,{msg:'User already registered'});const x=A.users[a.email]={id:require('crypto').randomUUID(),email:a.email,pass:a.password,nick:(a.data&&a.data.nickname)||'Jogador'};A.wallet[x.id]=0;return send(200,sess(x))}
  if(u==='/auth/v1/token'){if(a.refresh_token){const x=Object.values(A.users).find(y=>'r-'+y.id===a.refresh_token);return x?send(200,sess(x)):send(400,{error_description:'invalid'})}
   const x=A.users[a.email];return x&&x.pass===a.password?send(200,sess(x)):send(400,{error_description:'Invalid login credentials'})}
  if(u==='/auth/v1/logout')return send(204,{});
  if(u==='/__pay'){for(const d of A.deps.filter(d=>!d.paid)){d.paid=true;A.wallet[d.user]+=d.amount}return send(200,{ok:true})}
  if(!who)return send(401,{error:'Faça login de novo.'});
  if(u.endsWith('/my_profile'))return send(200,A.profiles[who]?[A.profiles[who]]:[]);
  // ClashToken: 1 por dia por conta (só com cadastro); /__clash dá tokens de teste
  if(u.endsWith('/clash_status')){const c=A.clash[who]||{bal:0,at:null},nx=c.at?c.at+864e5:Date.now(),dep=A.deps.some(d=>d.user===who&&d.paid&&d.amount>=1000);return send(200,{balance:c.bal,can_claim:!!A.profiles[who]&&Date.now()>=nx,next_at:new Date(nx).toISOString(),last_at:c.at?new Date(c.at).toISOString():null,deposit_ok:dep,deposit_until:dep?new Date(Date.now()+21*864e5).toISOString():null})}
  if(u.endsWith('/clash_exchange')){const c=A.clash[who]||{bal:0,at:null};if(!A.profiles[who])return send(400,{message:'profile_required'});if(c.bal<6)return send(200,{ok:false,error:'insufficient_tokens',balance:c.bal});c.bal-=6;A.wallet[who]=(A.wallet[who]||0)+200;return send(200,{ok:true,balance:c.bal,credited_cents:200})}
  if(u.endsWith('/clash_claim')){if(!A.profiles[who])return send(400,{message:'profile_required'});const c=A.clash[who]=A.clash[who]||{bal:0,at:null};
   if(c.at&&Date.now()<c.at+864e5)return send(200,{ok:false,error:'already',balance:c.bal,next_at:new Date(c.at+864e5).toISOString()});c.bal++;c.at=Date.now();return send(200,{ok:true,balance:c.bal,next_at:new Date(c.at+864e5).toISOString()})}
  if(u==='/__clash'){const c=A.clash[who]=A.clash[who]||{bal:0,at:null};c.bal+=+a.n||0;if(a.back)c.at=(c.at||Date.now())-a.back;return send(200,{balance:c.bal})}
  if(u.endsWith('/my_wallet'))return send(200,[{balance_cents:A.wallet[who]||0,escrow_cents:0}]);
  if(u.endsWith('/my_withdrawals'))return send(200,A.wds.filter(w=>w.user===who).map(w=>({amount_cents:w.amount,status:w.status,pix_key_masked:w.mask,requested_at:new Date().toISOString()})));
  if(u==='/functions/v1/account'){const cpf=String(a.cpf||'').replace(/\D/g,'');if(cpf.length!==11)return send(400,{error:'CPF inválido.'});if(Object.values(A.profiles).some(p=>p.cpf===cpf))return send(409,{error:'Este CPF já tem uma conta.'});
   A.profiles[who]={nickname:a.nick,kyc:'approved',status:'active',cpf_last4:cpf.slice(-4),cpf};return send(200,{ok:true})}
  if(u==='/functions/v1/pix-deposit'){if(!A.profiles[who])return send(409,{error:'Complete seu cadastro primeiro.'});if(!(a.amount_cents>=1000))return send(400,{error:'Valor entre R$ 10 e R$ 5.000.'});
   const d={id:'dep-'+A.deps.length,user:who,amount:a.amount_cents,paid:false};A.deps.push(d);
   return send(200,{id:d.id,amount_cents:d.amount,brCode:'00020126580014BR.GOV.BCB.PIX0136teste-bombercash5204000053039865802BR6304ABCD',qr:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',expiresAt:new Date(Date.now()+3600e3).toISOString()})}
  if(u==='/functions/v1/pix-withdraw'){const p=A.profiles[who],cpf=String(a.cpf||'').replace(/\D/g,'');if(!p||p.cpf!==cpf)return send(409,{error:'A chave PIX precisa ser o CPF do titular da conta.'});if(a.amount_cents>(A.wallet[who]||0))return send(409,{error:'Saldo insuficiente.'});
   A.wallet[who]-=a.amount_cents;const w={user:who,amount:a.amount_cents,status:a.amount_cents<=10000?'approved':'pending_review',mask:'***.***.'+cpf.slice(6,9)+'-'+cpf.slice(9)};A.wds.push(w);return send(200,{ok:true,status:w.status})}
  return send(404,{error:'não encontrado'})});return}
 if(req.url.startsWith('/rest/v1/rpc/')){const fn=req.url.split('/').pop();let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  const a=b?JSON.parse(b):{};let out={ok:true};
  if(fn==='bc_register')out={id:++uid,token:'00000000-0000-4000-8000-'+String(uid).padStart(12,'0'),nick:a.p_nick};
  else if(fn==='bc_inbox')out={ok:true,invites:[],out:null};
  else if(fn.startsWith('bc_ranking'))out={top:[],me:null,total:0};
  else if(fn==='bc_friends_list')out={ok:true,list:[]};
  else if(fn==='bc_profile')out={ok:true,history:[]};
  global.reports=global.reports||[];if(fn==='bc_report_v3')global.reports.push(a);
  res.writeHead(200,{...cors,'Content-Type':'application/json'});res.end(JSON.stringify(out))});return}
 const path=require('path'),u=req.url.split('?')[0],TYPES={webp:'image/webp',png:'image/png',jpg:'image/jpeg',mp4:'video/mp4',html:'text/html',js:'text/javascript',css:'text/css'};
 if(u.startsWith('/assets/')){const name=u.slice(8),f=[process.env.ASSETS_DIR,path.join(__dirname,'../../demo/assets')].filter(Boolean).map(d=>path.join(d,name)).find(x=>fs.existsSync(x));
  if(f&&!process.env.NO_ASSETS?.split(',').some(n=>name.startsWith(n))){res.writeHead(200,{'Content-Type':TYPES[f.split('.').pop()]||'application/octet-stream',...cors});return res.end(fs.readFileSync(f))}res.writeHead(404);return res.end()}
 if(u==='/start.html'){if(process.env.NO_START||(req.headers.referer||'').includes('nostart')){res.writeHead(404);return res.end()}res.writeHead(200,{'Content-Type':'text/html'});return res.end(fs.readFileSync(path.join(__dirname,'../../demo/start.html')))}
 if(req.url==='/__reports'){res.writeHead(200,{...cors});return res.end(JSON.stringify(global.reports||[]))}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(mkHtml())});
const wss=new WebSocketServer({server:srv});const topics=new Map();
wss.on('connection',ws=>{ws.on('message',m=>{let o;try{o=JSON.parse(m)}catch(e){return}
 if(o.event==='phx_join'){(topics.get(o.topic)||topics.set(o.topic,new Set()).get(o.topic)).add(ws);ws.send(JSON.stringify({topic:o.topic,event:'phx_reply',payload:{status:'ok',response:{}},ref:o.ref}))}
 else if(o.event==='broadcast'){for(const c of topics.get(o.topic)||[])if(c!==ws&&c.readyState===1)c.send(JSON.stringify({topic:o.topic,event:'broadcast',payload:o.payload}))}
 else if(o.event==='heartbeat')ws.send(JSON.stringify({topic:'phoenix',event:'phx_reply',payload:{status:'ok'},ref:o.ref}))});
 ws.on('close',()=>{for(const s of topics.values())s.delete(ws)})});
srv.listen(PORT,()=>console.log('mock on',PORT));
