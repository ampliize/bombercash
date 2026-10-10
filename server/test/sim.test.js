import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, T } from '../src/sim.js';

const run = (s, sec, dt = 1 / 30) => { for (let i = 0; i < sec / dt && !s.ended; i++) s.step(dt); };

test('mesmo seed gera o mesmo mapa', () => {
  const a = new Sim({ seed: 42, map: 2, n: 4 }), b = new Sim({ seed: 42, map: 2, n: 4 });
  assert.equal(a.encWorld(), b.encWorld());
  assert.notEqual(a.encWorld(), new Sim({ seed: 43, map: 2, n: 4 }).encWorld());
});

for (const [n, map] of [[2, 0], [4, 1], [8, 4], [4, 3], [8, 3]]) {
  test(`mapa simétrico n=${n} map=${map}`, () => {
    const s = new Sim({ seed: 7 + n, map, n });
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      assert.equal(s.world[y][x], s.world[y][s.W - 1 - x], `x ${x},${y}`);
      assert.equal(s.world[y][x], s.world[s.H - 1 - y][x], `y ${x},${y}`);
    }
  });
}

test('casas iniciais livres', () => {
  const s = new Sim({ seed: 9, map: 0, n: 8 });
  for (const p of s.players) assert.equal(s.world[Math.floor(p.y / T)][Math.floor(p.x / T)], 0);
});

test('bomba explode, quebra caixa e mata quem fica parado', () => {
  const s = new Sim({ seed: 1, map: 0, n: 2 });
  s.input(0, { dx: 0, dy: 0, bomb: true });
  run(s, .1);
  assert.equal(s.bombs.length, 1);
  run(s, 2.3);
  assert.equal(s.players[0].alive, false);
  assert.equal(s.ended, true);
  assert.equal(s.winner, 1);
});

test('replay determinístico com mesmas entradas', () => {
  const play = () => {
    const s = new Sim({ seed: 5, map: 1, n: 4 });
    for (let i = 0; i < 600 && !s.ended; i++) {
      if (i % 20 === 0) for (const p of s.players) s.input(p.i, { dx: (i / 20 + p.i) % 3 - 1, dy: (i / 20 + 2 * p.i) % 3 - 1, bomb: i % 40 === 0 });
      s.step(1 / 30);
    }
    return JSON.stringify(s.snapshot());
  };
  assert.equal(play(), play());
});

test('empate (parados até a morte súbita/tempo): duelo na lava até sobrar 1', () => {
  const s = new Sim({ seed: 3, map: 2, n: 2 });
  for (let i = 0; i < 30 * 152 && !s.duel; i++) s.step(1 / 30);
  assert.equal(s.ended, false, 'empate não encerra a partida');
  assert.equal(s.duel, 1, 'começou o duelo');
  assert.ok(s.players.every(p => p.alive), 'finalistas voltam');
  assert.deepEqual(s.players.map(p => [Math.floor(p.x / T), Math.floor(p.y / T)]), [[1, 1], [13, 11]]);
  assert.ok(s.players.every(p => p.speed === 140 && p.bombMax === 1 && p.power === 1));
  assert.ok(s.snapshot().t < 0 && s.snapshot().du === 1, 'contagem do duelo vai no snapshot');
  run(s, 80);
  assert.equal(s.ended, true); assert.ok(s.winner >= 0, 'sempre sai um vencedor');
});

test('parados no duelo: a lava decide, nunca empata (vários seeds)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const s = new Sim({ seed, map: seed % 7, n: seed % 2 ? 2 : 4 });
    s.matchT = 151; s.step(1 / 30);
    assert.equal(s.duel, 1);
    for (let i = 0; i < 30 * 200 && !s.ended; i++) s.step(1 / 30);
    assert.equal(s.ended, true, 'seed ' + seed); assert.ok(s.winner >= 0, 'seed ' + seed);
  }
});

test('morreram no mesmo instante: duelo só entre eles', () => {
  const s = new Sim({ seed: 8, map: 0, n: 4 });
  s.kill(s.players[3]); s.step(1 / 30);           // o 4º caiu antes
  s.players[0].alive = false; s.players[0].deadTick = s.tick + 1;
  s.players[2].alive = false; s.players[2].deadTick = s.tick + 1;
  s.kill(s.players[1]); s.players[1].deadTick = s.tick + 1;
  s.step(1 / 30);
  assert.equal(s.duel, 1);
  assert.deepEqual(s.players.map(p => p.alive), [true, true, true, false]);
});

test('jogador que sai perde', () => {
  const s = new Sim({ seed: 3, map: 2, n: 2 });
  s.leave(1); s.step(1 / 30);
  assert.equal(s.ended, true); assert.equal(s.winner, 0);
});

test('movimento respeita paredes e velocidade', () => {
  const s = new Sim({ seed: 3, map: 2, n: 2 });
  s.input(0, { dx: -1, dy: 0 });
  run(s, 2);
  assert.ok(s.players[0].x >= T + 14);
  const s2 = new Sim({ seed: 3, map: 2, n: 2 });
  const x0 = s2.players[0].x; s2.input(0, { dx: 1, dy: 0 }); s2.step(1 / 30);
  assert.ok(s2.players[0].x - x0 <= 125 / 30 + .01);
});

test('explosão destrói item no chão, mas não o que acabou de sair da caixa', () => {
  const s = new Sim({ seed: 1, map: 0, n: 2 });
  const p = s.players[0], cx = Math.floor(p.x / T), cy = Math.floor(p.y / T);
  s.world[cy][cx + 1] = 0; s.world[cy][cx + 2] = 1;
  s.items.push({ x: cx + 1, y: cy, born: -5, kind: 'fire' });
  s.rng = () => 0;                          // força a caixa a soltar item
  s.blast({ id: 99, x: cx, y: cy, power: 3, owner: 0 });
  assert.ok(!s.items.some(i => i.x === cx + 1), 'item antigo queimou');
  assert.ok(s.items.some(i => i.x === cx + 2), 'item da caixa sobreviveu');
  s.matchT = 1; s.blast({ id: 100, x: cx, y: cy, power: 3, owner: 0 });
  assert.ok(!s.items.some(i => i.x === cx + 2), 'na explosão seguinte ele queima');
});

test('quina: segurando para o lado, o boneco escorrega para a faixa livre e entra no corredor', () => {
  const s = new Sim({ seed: 2, map: 0, n: 2 });
  for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) if (s.world[y][x] === 1) s.world[y][x] = 0;
  const p = s.players[0];
  p.x = 1.5 * T; p.y = 1.5 * T + 20;             // quase na faixa de baixo (linha 2 é pilar em x=2)
  s.input(0, { dx: 1, dy: 0 });
  for (let i = 0; i < 40; i++) s.step(1 / 30);
  assert.ok(p.x > 2.5 * T, 'passou pela quina: x=' + p.x.toFixed(1));
  assert.ok(Math.abs(p.y - 1.5 * T) < 1, 'alinhado no meio do corredor: y=' + p.y.toFixed(1));
});
