const http=require('http'),fs=require('fs'),{WebSocketServer}=require('ws');
const PORT=8765;let uid=100;
const html=fs.readFileSync(require('path').join(__dirname,'../../demo/index.html'),'utf8').replace("https://tuowzfpbpjxknouodzgb.supabase.co","http://127.0.0.1:"+PORT).replace("const arena=BC.create({canvas:cv,keys,","const arena=window.__arena=BC.create({canvas:cv,keys,").replace("const MUS={on:false,timer:0,next:0,step:0,sd:false,bpm:128};","const MUS=window.__MUS={on:false,timer:0,next:0,step:0,sd:false,bpm:128};").replace("let rm=null,rmStartMsg=null;","let rm=null,rmStartMsg=null;window.__t={bal:()=>bal,net:()=>net};");
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,GET,OPTIONS'};
const srv=http.createServer((req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}
 if(req.url.startsWith('/rest/v1/rpc/')){const fn=req.url.split('/').pop();let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  const a=b?JSON.parse(b):{};let out={ok:true};
  if(fn==='bc_register')out={id:++uid,token:'00000000-0000-4000-8000-'+String(uid).padStart(12,'0'),nick:a.p_nick};
  else if(fn==='bc_inbox')out={ok:true,invites:[],out:null};
  else if(fn.startsWith('bc_ranking'))out={top:[],me:null,total:0};
  else if(fn==='bc_friends_list')out={ok:true,list:[]};
  else if(fn==='bc_profile')out={ok:true,history:[]};
  global.reports=global.reports||[];if(fn==='bc_report_v3')global.reports.push(a);
  res.writeHead(200,{...cors,'Content-Type':'application/json'});res.end(JSON.stringify(out))});return}
 if(req.url.startsWith('/assets/')&&process.env.ASSETS_DIR){const f=require('path').join(process.env.ASSETS_DIR,req.url.slice(8).split('?')[0]);if(fs.existsSync(f)){res.writeHead(200,{'Content-Type':'image/webp',...cors});return res.end(fs.readFileSync(f))}res.writeHead(404);return res.end()}
 if(req.url==='/__reports'){res.writeHead(200,{...cors});return res.end(JSON.stringify(global.reports||[]))}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(html)});
const wss=new WebSocketServer({server:srv});const topics=new Map();
wss.on('connection',ws=>{ws.on('message',m=>{let o;try{o=JSON.parse(m)}catch(e){return}
 if(o.event==='phx_join'){(topics.get(o.topic)||topics.set(o.topic,new Set()).get(o.topic)).add(ws);ws.send(JSON.stringify({topic:o.topic,event:'phx_reply',payload:{status:'ok',response:{}},ref:o.ref}))}
 else if(o.event==='broadcast'){for(const c of topics.get(o.topic)||[])if(c!==ws&&c.readyState===1)c.send(JSON.stringify({topic:o.topic,event:'broadcast',payload:o.payload}))}
 else if(o.event==='heartbeat')ws.send(JSON.stringify({topic:'phoenix',event:'phx_reply',payload:{status:'ok'},ref:o.ref}))});
 ws.on('close',()=>{for(const s of topics.values())s.delete(ws)})});
srv.listen(PORT,()=>console.log('mock on',PORT));
