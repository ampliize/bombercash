import http from 'node:http';
import { WebSocketServer } from 'ws';
import { MODES } from './room.js';
import { Matchmaker } from './match.js';
import { NoopLedger, SupabaseLedger } from './ledger.js';
import { verifyToken } from './auth.js';

const PORT = +process.env.PORT || 2567;
const MONEY = process.env.MONEY_MODE === '1'; // sem isso, só partidas sem dinheiro
// PLAY_MODE=demo: servidor público do pré-lançamento (fichas virtuais, sem dinheiro). Em produção (NODE_ENV=production)
// o servidor só sobe com MONEY_MODE=1 ou PLAY_MODE=demo explícitos e com ALLOWED_ORIGINS: nunca roda "sem querer" sem dinheiro.
const PROD = process.env.NODE_ENV === 'production', DEMO_MODE = process.env.PLAY_MODE === 'demo';
const MODE_NAME = MONEY ? 'money' : DEMO_MODE ? 'demo' : 'test';
if (PROD && !MONEY && !DEMO_MODE) throw new Error('produção exige MONEY_MODE=1 ou PLAY_MODE=demo');
if (PROD && !(process.env.ALLOWED_ORIGINS || '').trim()) throw new Error('produção exige ALLOWED_ORIGINS (ex.: https://bombercash.vercel.app)');
if (MONEY && DEMO_MODE) throw new Error('MONEY_MODE e PLAY_MODE=demo não podem estar ligados juntos');
const MAX_PER_IP = +process.env.MAX_CONN_PER_IP || 6;
const SECRET = process.env.SUPABASE_JWT_SECRET || '';
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ledger = MONEY ? new SupabaseLedger({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY }) : new NoopLedger();
// ClashToken usa o banco sempre que houver chave de serviço (mesmo sem MONEY_MODE); sem chave, a sala dourada fica fechada
// (TOKENS_TEST=1 libera com caixa falso, só para teste local)
const tokenLedger = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? (MONEY ? ledger : new SupabaseLedger({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY }))
  : process.env.TOKENS_TEST === '1' ? new NoopLedger() : null;
if (MONEY && !SECRET && !process.env.SUPABASE_URL) throw new Error('MONEY_MODE exige SUPABASE_URL (chaves novas) ou SUPABASE_JWT_SECRET (chave legada)');

const rooms = new Map();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const server = http.createServer((req, res) => { if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: !closing })); } else { res.writeHead(404); res.end(); } });
let closing = false;
const perIp = new Map();
const ipOf = req => String(req.headers['fly-client-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
const wss = new WebSocketServer({ server, maxPayload: 2048, verifyClient: ({ origin, req }) => !closing && (!ORIGINS.length || ORIGINS.includes(origin)) && (perIp.get(ipOf(req)) || 0) < MAX_PER_IP });

const mm = new Matchmaker({ ledger, tokenLedger, log, money: MONEY, onRoom: (r, open) => { if (open) rooms.set(r.code, r); else rooms.delete(r.code); } });

wss.on('connection', (ws, req) => {
  const ip = ipOf(req); perIp.set(ip, (perIp.get(ip) || 0) + 1);
  let user = null, msgs = 0;
  const helloT = setTimeout(() => { if (!user) ws.close(); }, 5000); // quem não se identifica em 5 s é desconectado
  const conn = { ws, room: null, seat: null, send: m => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch { /* fechado */ } }, setRoom(r, s) { this.room = r; this.seat = s; } };
  const rate = setInterval(() => { msgs = 0; }, 1000);
  const err = m => conn.send({ t: 'error', error: m });
  let authing = false;
  ws.on('message', async raw => {
    if (++msgs > 90) { ws.close(); return; }
    let m; try { m = JSON.parse(raw); } catch { return err('mensagem inválida'); }
    if (!m || typeof m !== 'object') return;
    if (!user) { // primeira mensagem identifica o jogador
      if (m.t !== 'hello') return err('identifique-se');
      if (authing) return; authing = true;
      if (MONEY || m.token) { user = await verifyToken(m.token, { secret: SECRET, supabaseUrl: process.env.SUPABASE_URL }); if (!user) { err('sessão inválida, faça login de novo'); return ws.close(); } }
      else { const nm = String(m.name || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 14) || 'Jogador'; user = { id: 'teste-' + Math.random().toString(36).slice(2, 10), name: nm }; }
      clearTimeout(helloT);
      return conn.send({ t: 'hello', id: user.id, money: MONEY, mode: MODE_NAME });
    }
    if (conn.seat) conn.seat.lastSeen = Date.now(); // qualquer mensagem conta como presença
    if (m.t === 'queue') { const r = mm.queue(conn, user, m.mode, m.stake); if (r.err) err(r.err); }
    else if (m.t === 'private_create') { const r = mm.createPrivate(conn, user, m.stake); if (r.err) err(r.err); }
    else if (m.t === 'private_join') { const r = mm.joinPrivate(conn, user, m.code); if (r.err) err(r.err); }
    else if (m.t === 'leave') { if (mm.leave(conn)) conn.send({ t: 'left' }); }
    else if (m.t === 'in' && conn.room && conn.seat) conn.room.input(conn.seat, m);
  });
  ws.on('close', () => { clearTimeout(helloT); const n = (perIp.get(ip) || 1) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); clearInterval(rate); mm.leave(conn); if (conn.room && conn.seat) conn.room.drop(conn.seat); });
  ws.on('error', () => {});
});

server.listen(PORT, () => log(`BomberCash game server :${PORT} modo=${MODE_NAME} modos=${Object.keys(MODES)}`));

// desligamento seguro (deploy/reinício): para de aceitar conexões, cancela as partidas e devolve as entradas
async function shutdown(sig) {
  if (closing) return; closing = true; log('desligando por', sig, 'salas:', rooms.size);
  await Promise.allSettled([...rooms.values()].map(r => r.abort('servidor reiniciando; a entrada voltou para o saldo')));
  wss.close(); server.close(); setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => log('ERRO não tratado', e && e.stack || e));
process.on('unhandledRejection', e => log('promessa rejeitada', e && e.stack || e));
