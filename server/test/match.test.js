import test from 'node:test';
import assert from 'node:assert/strict';
import { Matchmaker } from '../src/match.js';
import { NoopLedger } from '../src/ledger.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const mkConn = () => { const out = []; const ws = { readyState: 1, out, send(m) { out.push(JSON.parse(m)); }, close() { this.readyState = 3; } };
  return { ws, out, room: null, seat: null, send(m) { out.push(m); }, setRoom(r, s) { this.room = r; this.seat = s; } }; };
const ledger = () => { const calls = []; return { calls, open: async a => { calls.push(['open', a]); }, settle: async a => { calls.push(['settle', a]); }, refund: async a => { calls.push(['refund', a]); } }; };

test('fila: 4x4 só começa com 4 pessoas no mesmo valor; valores diferentes não se misturam', async () => {
  const L = ledger(), mm = new Matchmaker({ ledger: L, money: true });
  const c = [1, 2, 3, 4, 5].map(mkConn);
  assert.ok(mm.queue(c[0], { id: 'a', name: 'A' }, '4x4', 500).ok);
  assert.ok(mm.queue(c[1], { id: 'b', name: 'B' }, '4x4', 500).ok);
  assert.ok(mm.queue(c[4], { id: 'e', name: 'E' }, '4x4', 1000).ok);   // outro valor: outra fila
  assert.ok(mm.queue(c[2], { id: 'c', name: 'C' }, '4x4', 500).ok);
  assert.equal(c[0].out.at(-1).have, 3); assert.equal(c[0].out.at(-1).need, 4);
  assert.equal(c[0].room, null, 'com 3 ainda não começa');
  mm.queue(c[3], { id: 'd', name: 'D' }, '4x4', 500);
  assert.ok(c[0].room && c[0].room === c[3].room, 'com 4 abre a sala');
  assert.equal(c[4].room, null, 'quem está em R$ 10 continua esperando');
  await wait(30);
  const open = L.calls.find(x => x[0] === 'open')[1];
  assert.deepEqual(open.userIds, ['a', 'b', 'c', 'd']); assert.equal(open.stakeCents, 500);
  assert.ok(c[0].ws.out.some(m => m.t === 'start'));
  c[0].room.close();
});

test('fila: sem bots, não aceita valor fora da tabela, nem entrar duas vezes, e sai da fila', () => {
  const mm = new Matchmaker({ ledger: ledger() }), a = mkConn(), b = mkConn();
  assert.ok(mm.queue(a, { id: 'a', name: 'A' }, '1x1', 300).err);
  assert.ok(mm.queue(a, { id: 'a', name: 'A' }, '3x3', 500).err);
  assert.ok(mm.queue(a, { id: 'a', name: 'A' }, '1x1', 500).ok);
  assert.ok(mm.queue(b, { id: 'a', name: 'A' }, '1x1', 500).err, 'mesmo jogador duas vezes');
  assert.equal(mm.leave(a), true);
  assert.ok(mm.queue(b, { id: 'a', name: 'A' }, '1x1', 500).ok, 'depois de sair pode entrar de novo');
});

test('sala ClashToken: só com conta, entrada de 6 tokens debitada de todos e pote inteiro para o vencedor', async () => {
  const calls = [];
  const tl = { tokenOpen: async a => { calls.push(['open', a]); return { ok: true }; }, tokenSettle: async a => { calls.push(['settle', a]); return { ok: true }; }, tokenRefund: async a => { calls.push(['refund', a]); return { ok: true }; } };
  const mm = new Matchmaker({ ledger: new NoopLedger(), tokenLedger: tl });
  const mk = () => { const sent = []; return { sent, ws: { readyState: 1, send: m => sent.push(JSON.parse(m)), close() {} }, room: null, send: m => sent.push(m), setRoom(r, s) { this.room = r; this.seat = s; } }; };
  assert.match(mm.queue(mk(), { id: 'teste-x', name: 'x' }, '4x4t', 0).err, /conta/);
  const cs = [mk(), mk(), mk(), mk()];
  cs.forEach((c, i) => assert.ok(mm.queue(c, { id: 'u' + i, name: 'P' + i, auth: true }, '4x4t', 999).ok));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(calls[0][0], 'open'); assert.equal(calls[0][1].entry, 6); assert.deepEqual(calls[0][1].userIds, ['u0', 'u1', 'u2', 'u3']);
  const room = cs[0].room; assert.equal(room.stakeCents, 0); assert.equal(room.tokens, 6);
  assert.ok(cs[0].sent.some(m => m.t === 'start' && m.tokens === 6));
  room.sim.winner = 2; room.sim.ended = true; await room.finish();
  assert.equal(calls[1][0], 'settle'); assert.equal(calls[1][1].winnerId, 'u2');
  room.close();
});

test('sala ClashToken fechada quando o servidor não tem caixa de tokens', () => {
  const mm = new Matchmaker({ ledger: new NoopLedger() });
  const c = { ws: { readyState: 1, send() {}, close() {} }, room: null, send() {}, setRoom() {} };
  assert.match(mm.queue(c, { id: 'u', name: 'u', auth: true }, '4x4t', 0).err, /indisponível/);
});
