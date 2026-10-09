import { randomUUID, createHash } from 'node:crypto';
import { Sim } from './sim.js';

export const TICK = 1 / 30, SNAP_EVERY = 2; // simula a 30 Hz, envia estado a 15 Hz
export const COUNTDOWN = Number(process.env.COUNTDOWN ?? 10); // segundos de contagem antes de liberar os bonecos
export const MODES = { '1x1': 2, '4x4': 4, '8x8': 8 };
const STAKES = [200, 500, 1000, 2000, 5000, 10000];

export class Room {
  constructor({ code, mode, stakeCents = 0, ledger, onClose, log = () => {} }) {
    if (!MODES[mode]) throw new Error('modo inválido');
    if (stakeCents && !STAKES.includes(stakeCents)) throw new Error('valor de aposta inválido');
    Object.assign(this, { code, mode, stakeCents, ledger, onClose, log });
    this.n = MODES[mode]; this.seats = []; this.state = 'lobby'; this.matchId = randomUUID(); this.sim = null; this.timer = null; this.starting = false;
  }
  send(seat, msg) { try { if (seat.ws.readyState === 1) seat.ws.send(JSON.stringify(msg)); } catch { /* conexão caiu */ } }
  lobby() { const names = this.seats.map(s => s.name); for (const s of this.seats) this.send(s, { t: 'lobby', names, n: this.n, you: s.slot }); }
  bcast(msg) { for (const s of this.seats) this.send(s, msg); }
  join(ws, user) {
    if (this.state !== 'lobby') return { err: 'partida em andamento' };
    if (this.seats.length >= this.n) return { err: 'sala cheia' };
    if (this.seats.some(s => s.userId === user.id)) return { err: 'você já está nesta sala' };
    const seat = { ws, userId: user.id, name: user.name, slot: this.seats.length, lastSeen: Date.now() };
    this.seats.push(seat);
    this.send(seat, { t: 'joined', code: this.code, slot: seat.slot, n: this.n, mode: this.mode, stake: this.stakeCents });
    this.lobby();
    if (this.seats.length === this.n) this.start().catch(e => this.abort('erro ao iniciar: ' + e.message));
    return { ok: true, seat };
  }
  async start() {
    if (this.starting) return; this.starting = true;
    const seed = (Math.random() * 0x7fffffff) | 0, map = Math.floor(Math.random() * 7);
    try { // aposta: debita e prende em escrow ANTES de a partida existir; se qualquer um não cobrir, ninguém joga
      await this.ledger.open({ matchId: this.matchId, mode: this.mode, stakeCents: this.stakeCents, userIds: this.seats.map(s => s.userId) });
    } catch (e) { this.bcast({ t: 'abort', reason: 'saldo insuficiente ou erro no caixa' }); this.close(); this.log('open falhou', e.message); return; }
    this.sim = new Sim({ seed, map, n: this.seats.length });
    this.state = 'play'; this.freeze = COUNTDOWN; this.tickN = 0; this.inputLog = [];
    const skins = this.seats.map((_, i) => i % 4);
    this.sim.players.forEach((p, i) => { p.skin = skins[i]; });
    this.bcast({ t: 'start', seed, map, W: this.sim.W, H: this.sim.H, n: this.seats.length, w: this.sim.encWorld(), br: [...this.sim.bridges], stake: this.stakeCents, names: this.seats.map(s => s.name), skins, matchId: this.matchId });
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }
  input(seat, d) {
    if (this.state !== 'play' || !this.sim || this.freeze > 0 || !d || typeof d !== 'object') return;
    seat.lastSeen = Date.now();
    const dx = Math.sign(+d.dx || 0), dy = Math.sign(+d.dy || 0), bomb = !!d.bomb;
    this.inputLog.push([this.tickN, seat.slot, dx, dy, bomb ? 1 : 0]);
    this.sim.input(seat.slot, { dx, dy, bomb });
  }
  tick() {
    if (this.freeze > 0) { this.freeze -= TICK; if (this.tickN++ % SNAP_EVERY === 0) this.bcast({ t: 'snap', s: { ...this.sim.snapshot(), t: -Math.max(0.01, this.freeze) } }); return; }
    for (const s of this.seats) if (!s.gone && Date.now() - s.lastSeen > 9000) this.drop(s);
    this.sim.step(TICK);
    if (this.tickN++ % SNAP_EVERY === 0 || this.sim.ended) this.bcast({ t: 'snap', s: this.sim.snapshot() });
    if (this.sim.ended) this.finish().catch(e => this.log('settle falhou', e.message));
  }
  drop(seat) { // desconexão = derrota (regra do produto)
    if (seat.gone) return; seat.gone = true;
    if (this.state === 'lobby') { this.seats = this.seats.filter(s => s !== seat); this.seats.forEach((s, i) => { s.slot = i; }); this.lobby(); if (!this.seats.length) this.close(); return; }
    if (this.sim && this.state === 'play') this.sim.leave(seat.slot);
  }
  async finish() {
    if (this.state !== 'play') return; this.state = 'done'; clearInterval(this.timer);
    const w = this.sim.winner, winner = w >= 0 ? this.seats[w] : null;
    const resultHash = createHash('sha256').update(JSON.stringify({ seed: this.sim.seed, map: this.sim.map, n: this.sim.N, inputs: this.inputLog, w })).digest('hex');
    let paid = null;
    try {
      if (winner) paid = await this.ledger.settle({ matchId: this.matchId, winnerId: winner.userId, seed: this.sim.seed, resultHash });
      else paid = await this.ledger.refund({ matchId: this.matchId, reason: 'empate' });
    } catch (e) { this.log('ERRO NO CAIXA — revisar partida', this.matchId, e.message); }
    this.bcast({ t: 'end', winner: w, matchId: this.matchId, resultHash, settled: !!paid });
    setTimeout(() => this.close(), 3000);
  }
  async abort(reason) { clearInterval(this.timer); if (this.state === 'play') { try { await this.ledger.refund({ matchId: this.matchId, reason }); } catch (e) { this.log('refund falhou', e.message); } } this.bcast({ t: 'abort', reason }); this.close(); }
  close() { clearInterval(this.timer); this.state = 'closed'; for (const s of this.seats) { try { s.ws.close(); } catch { /* já fechado */ } } this.onClose && this.onClose(this); }
}
