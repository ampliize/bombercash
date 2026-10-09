import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Room, MODES } from './room.js';
import { NoopLedger, SupabaseLedger } from './ledger.js';
import { verifyJwt } from './auth.js';

const PORT = +process.env.PORT || 2567;
const MONEY = process.env.MONEY_MODE === '1'; // sem isso, só partidas de brincadeira (sem saldo)
const SECRET = process.env.SUPABASE_JWT_SECRET || '';
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ledger = MONEY ? new SupabaseLedger({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY }) : new NoopLedger();
if (MONEY && !SECRET) throw new Error('MONEY_MODE exige SUPABASE_JWT_SECRET');

const rooms = new Map();
const log = (...a) => console.log(new Date().toISOString(), ...a);
const code = () => { for (;;) { const c = String(Math.floor(1000 + Math.random() * 9000)); if (!rooms.has(c)) return c; } };

const server = http.createServer((req, res) => { if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, money: MONEY })); } else { res.writeHead(404); res.end(); } });
const wss = new WebSocketServer({ server, maxPayload: 2048, verifyClient: ({ origin }) => !ORIGINS.length || ORIGINS.includes(origin) });

wss.on('connection', ws => {
  let user = null, room = null, seat = null, msgs = 0;
  const rate = setInterval(() => { msgs = 0; }, 1000);
  const err = m => { try { ws.send(JSON.stringify({ t: 'error', error: m })); } catch { /* fechado */ } };
  ws.on('message', raw => {
    if (++msgs > 90) { ws.close(); return; }
    let m; try { m = JSON.parse(raw); } catch { return err('mensagem inválida'); }
    if (!m || typeof m !== 'object') return;
    if (!user) { // primeira mensagem identifica o jogador
      if (m.t !== 'hello') return err('identifique-se');
      if (MONEY || m.token) { user = verifyJwt(m.token, SECRET); if (!user) { err('sessão inválida'); return ws.close(); } }
      else { const nm = String(m.name || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 14) || 'Jogador'; user = { id: 'demo-' + Math.random().toString(36).slice(2, 10), name: nm }; }
      return ws.send(JSON.stringify({ t: 'hello', id: user.id }));
    }
    if (m.t === 'create' && !room) {
      try { room = new Room({ code: code(), mode: String(m.mode || '1x1'), stakeCents: MONEY ? +m.stake || 0 : 0, ledger, log, onClose: r => rooms.delete(r.code) }); } catch (e) { return err(e.message); }
      if (MONEY && !room.stakeCents) { room = null; return err('aposta obrigatória'); }
      rooms.set(room.code, room); const r = room.join(ws, user); if (r.err) { room = null; return err(r.err); } seat = r.seat;
    } else if (m.t === 'join' && !room) {
      const r0 = rooms.get(String(m.code)); if (!r0) return err('sala não encontrada');
      const r = r0.join(ws, user); if (r.err) return err(r.err); room = r0; seat = r.seat;
    } else if (m.t === 'in' && room && seat) room.input(seat, m);
  });
  ws.on('close', () => { clearInterval(rate); if (room && seat) room.drop(seat); });
  ws.on('error', () => {});
});

server.listen(PORT, () => log(`BomberCash game server :${PORT} money=${MONEY} modos=${Object.keys(MODES)}`));
