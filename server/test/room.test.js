import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Room } from '../src/room.js';
import { verifyJwt } from '../src/auth.js';

const fakeWs = () => ({ readyState: 1, out: [], send(m) { this.out.push(JSON.parse(m)); }, close() { this.readyState = 3; } });
const wait = ms => new Promise(r => setTimeout(r, ms));
const mkLedger = (fail) => { const calls = []; return { calls, open: async a => { calls.push(['open', a]); if (fail) throw new Error('sem saldo'); return {}; }, settle: async a => { calls.push(['settle', a]); return {}; }, refund: async a => { calls.push(['refund', a]); return {}; } }; };

test('sala 1x1: abre escrow, joga, quem perde é derrotado e o vencedor é liquidado', async () => {
  const ledger = mkLedger(); let closed = false;
  const room = new Room({ code: '1234', mode: '1x1', stakeCents: 500, ledger, onClose: () => { closed = true; } });
  const a = fakeWs(), b = fakeWs();
  assert.ok(room.join(a, { id: 'u1', name: 'A' }).ok);
  assert.ok(room.join(b, { id: 'u2', name: 'B' }).ok);
  assert.equal(room.join(fakeWs(), { id: 'u3', name: 'C' }).err, 'sala cheia');
  await wait(50);
  assert.equal(ledger.calls[0][0], 'open');
  assert.deepEqual(ledger.calls[0][1].userIds, ['u1', 'u2']);
  assert.ok(a.out.some(m => m.t === 'start'));
  room.freeze = 0;                                   // pula a contagem
  room.input(room.seats[0], { dx: 0, dy: 0, bomb: true }); // A solta bomba e fica parado: morre
  for (let i = 0; i < 100 && room.state === 'play'; i++) await wait(40);
  await wait(60);
  const end = b.out.find(m => m.t === 'end');
  assert.ok(end, 'recebeu fim');
  assert.equal(end.winner, 1);
  const st = ledger.calls.find(c => c[0] === 'settle');
  assert.equal(st[1].winnerId, 'u2');
  assert.match(st[1].resultHash, /^[0-9a-f]{64}$/);
  room.close(); assert.ok(closed);
});

test('se o caixa recusa a aposta, a partida não começa', async () => {
  const ledger = mkLedger(true);
  const room = new Room({ code: '1', mode: '1x1', stakeCents: 200, ledger });
  const a = fakeWs(), b = fakeWs();
  room.join(a, { id: 'u1', name: 'A' }); room.join(b, { id: 'u2', name: 'B' });
  await wait(50);
  assert.ok(a.out.some(m => m.t === 'abort'));
  assert.ok(!a.out.some(m => m.t === 'start'));
});

test('desconectar durante a partida = derrota', async () => {
  const ledger = mkLedger();
  const room = new Room({ code: '2', mode: '1x1', stakeCents: 200, ledger });
  const a = fakeWs(), b = fakeWs();
  room.join(a, { id: 'u1', name: 'A' }); room.join(b, { id: 'u2', name: 'B' });
  await wait(50); room.freeze = 0;
  room.drop(room.seats[0]);
  await wait(150);
  assert.equal(ledger.calls.find(c => c[0] === 'settle')[1].winnerId, 'u2');
});

test('aposta fora da tabela é rejeitada', () => {
  assert.throws(() => new Room({ code: '3', mode: '1x1', stakeCents: 300, ledger: mkLedger() }));
  assert.throws(() => new Room({ code: '3', mode: '2x2', ledger: mkLedger() }));
});

test('entradas são saneadas (direção só -1/0/1)', async () => {
  const room = new Room({ code: '4', mode: '1x1', ledger: mkLedger() });
  room.join(fakeWs(), { id: 'u1', name: 'A' }); room.join(fakeWs(), { id: 'u2', name: 'B' });
  await wait(50); room.freeze = 0;
  room.input(room.seats[0], { dx: 9999, dy: -50, bomb: 'x' });
  assert.deepEqual(room.sim.players[0].dir, [1, -1]);
  room.close();
});

const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const jwt = (c, secret = 's3cret', alg = 'HS256') => { const h = b64u({ alg, typ: 'JWT' }), p = b64u(c); return `${h}.${p}.${createHmac('sha256', secret).update(h + '.' + p).digest('base64url')}`; };
test('JWT: aceita válido, rejeita adulterado/expirado/outro papel', () => {
  const ok = { sub: 'abc', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60, user_metadata: { nickname: 'Zé' } };
  assert.deepEqual(verifyJwt(jwt(ok), 's3cret'), { id: 'abc', name: 'Zé' });
  assert.equal(verifyJwt(jwt(ok, 'outro'), 's3cret'), null);
  assert.equal(verifyJwt(jwt({ ...ok, exp: 1 }), 's3cret'), null);
  assert.equal(verifyJwt(jwt({ ...ok, role: 'anon' }), 's3cret'), null);
  assert.equal(verifyJwt(jwt(ok, 's3cret', 'none'), 's3cret'), null);
  assert.equal(verifyJwt('lixo', 's3cret'), null);
});
