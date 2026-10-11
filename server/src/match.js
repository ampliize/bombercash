import { randomUUID } from 'node:crypto';
import { Room, MODES, TOKEN_ENTRY } from './room.js';

export const STAKES = [200, 500, 1000, 2000, 5000, 10000]; // centavos: R$ 2, 5, 10, 20, 50, 100
const REASONS = {
  profile_required: 'complete seu cadastro para jogar valendo', account_not_active: 'sua conta não está ativa', kyc_required: 'seu cadastro ainda está em verificação',
  insufficient_funds: 'saldo insuficiente para esta entrada', already_in_match: 'você já tem uma partida em andamento', insufficient_tokens: 'ClashTokens insuficientes',
  deposit_required: 'a sala dourada exige 1 depósito de R$ 10,00 nas últimas 3 semanas',
};

// Fila de partidas: junta jogadores do mesmo modo e do mesmo valor; a partida só começa quando a sala enche
// (2, 4 ou 8 pessoas). Não existe bot nem sala combinada entre amigos.
export class Matchmaker {
  constructor({ ledger, tokenLedger = null, log = () => {}, money = false, onRoom = () => {} }) {
    Object.assign(this, { ledger, tokenLedger, log, money, onRoom });
    this.queues = new Map(); // "modo:centavos" -> [{conn,user}]
    this.privates = new Map(); // código -> {conn,user,stake,at}: 1x1 entre amigos (só no duelo)
    this.playing = new Set(); // usuários com partida em andamento (uma partida e uma fila por pessoa, em qualquer conexão)
    this.checking = new Set(); // usuários com checagem de elegibilidade em andamento
  }
  key(mode, stake) { return mode + ':' + stake; }
  status(k) {
    const q = this.queues.get(k) || [], [mode, stake] = k.split(':'), need = MODES[mode];
    for (const e of q) e.conn.send({ t: 'queue', mode, stake: +stake, have: q.length, need });
  }
  queue(conn, user, mode, stake) {
    mode = String(mode); stake = Math.round(+stake);
    if (!MODES[mode]) return { err: 'modo inválido' };
    if (TOKEN_ENTRY[mode]) { // sala por ClashToken: precisa de conta (os tokens são da conta) e não tem valor em dinheiro
      if (!this.tokenLedger) return { err: 'sala ClashToken indisponível agora' };
      if (!user.auth) return { err: 'entre na sua conta para jogar por ClashToken' };
      stake = 0;
    } else if (!STAKES.includes(stake)) return { err: 'valor de entrada inválido' };
    const b = this.busy(conn, user); if (b) return { err: b };
    const k = this.key(mode, stake), tok = TOKEN_ENTRY[mode];
    // valendo: confere conta, cadastro e saldo ANTES de entrar na fila (assim ninguém derruba a sala dos outros)
    const lg = tok ? this.tokenLedger : this.money ? this.ledger : null, check = lg && (tok ? lg.canClash : lg.canPlay);
    if (!check) { this.enqueue(k, conn, user); return { ok: true }; }
    this.checking.add(user.id);
    check.call(lg, tok ? { userId: user.id, entry: tok } : { userId: user.id, stakeCents: stake })
      .then(r => {
        this.checking.delete(user.id);
        if (conn.ws.readyState !== 1) return;
        if (!r || r.ok !== true) return conn.send({ t: 'error', error: REASONS[r && r.reason] || 'você não pode entrar nesta partida agora' });
        const b2 = this.busy(conn, user, true); if (b2) return conn.send({ t: 'error', error: b2 });
        this.enqueue(k, conn, user);
      })
      .catch(e => { this.checking.delete(user.id); this.log('checagem falhou', e.message); conn.send({ t: 'error', error: 'servidor de pagamentos indisponível, tente de novo' }); });
    return { ok: true, pending: true };
  }
  enqueue(k, conn, user) {
    const q = this.queues.get(k) || [], mode = k.split(':')[0];
    q.push({ conn, user }); this.queues.set(k, q);
    if (q.length >= MODES[mode]) this.launch(k); else this.status(k);
  }
  // 1x1 com amigo: quem cria recebe um código; o amigo entra com o código e os dois apostam o mesmo valor
  busy(conn, user, afterCheck = false) {
    if (conn.room || this.playing.has(user.id)) return 'você já está numa partida';
    if (!afterCheck && this.checking.has(user.id)) return 'aguarde, conferindo sua conta';
    for (const q of this.queues.values()) if (q.some(e => e.user.id === user.id)) return 'você já está na fila';
    for (const p of this.privates.values()) if (p.user.id === user.id) return 'você já tem uma sala aberta';
    return null;
  }
  createPrivate(conn, user, stake) {
    stake = Math.round(+stake);
    if (!STAKES.includes(stake)) return { err: 'valor de entrada inválido' };
    const b = this.busy(conn, user); if (b) return { err: b };
    this.sweep();
    let code; do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); } while (this.privates.has(code));
    this.privates.set(code, { conn, user, stake, at: Date.now() });
    conn.send({ t: 'private', code, stake, mode: '1x1' });
    return { ok: true, code };
  }
  joinPrivate(conn, user, code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    this.sweep();
    const p = this.privates.get(code);
    if (!p) return { err: 'sala não encontrada ou expirada' };
    if (p.user.id === user.id) return { err: 'esta sala é sua: envie o código para o seu amigo' };
    const b = this.busy(conn, user); if (b) return { err: b };
    this.privates.delete(code);
    const room = new Room({ code: code.toLowerCase(), mode: '1x1', stakeCents: this.money ? p.stake : 0, ledger: this.ledger, tokenLedger: this.tokenLedger, log: this.log, onClose: r => { this.playing.delete(p.user.id); this.playing.delete(user.id); this.onRoom(r, false); } });
    this.onRoom(room, true);
    this.playing.add(p.user.id); this.playing.add(user.id);
    for (const { conn: c, user: u } of [p, { conn, user }]) { const r = room.join(c.ws, u); if (r.ok) c.setRoom(room, r.seat); }
    this.log('partida entre amigos', room.matchId, p.stake, p.user.id + ',' + user.id);
    return { ok: true };
  }
  sweep() { const lim = Date.now() - 15 * 60e3; for (const [c, p] of this.privates) if (p.at < lim) { this.privates.delete(c); p.conn.send({ t: 'error', error: 'o convite expirou (15 minutos)' }); } }
  launch(k) {
    const q = this.queues.get(k), [mode, stake] = k.split(':'), n = MODES[mode];
    const group = q.splice(0, n); if (!q.length) this.queues.delete(k);
    const room = new Room({ code: randomUUID().slice(0, 8), mode, stakeCents: this.money ? +stake : 0, ledger: this.ledger, tokenLedger: this.tokenLedger, log: this.log, onClose: r => { for (const s of r.seats) this.playing.delete(s.userId); for (const e of group) this.playing.delete(e.user.id); this.onRoom(r, false); } });
    this.onRoom(room, true);
    for (const e of group) this.playing.add(e.user.id);
    for (const { conn, user } of group) { const r = room.join(conn.ws, user); if (r.ok) conn.setRoom(room, r.seat); }
    this.log('partida', room.matchId, mode, stake, group.map(e => e.user.id).join(','));
    if (q.length) this.status(k);
  }
  leave(conn) {
    for (const [c, p] of this.privates) if (p.conn === conn) { this.privates.delete(c); return true; }
    for (const [k, q] of this.queues) { const i = q.findIndex(e => e.conn === conn); if (i >= 0) { q.splice(i, 1); if (!q.length) this.queues.delete(k); else this.status(k); return true; } }
    return false;
  }
}
