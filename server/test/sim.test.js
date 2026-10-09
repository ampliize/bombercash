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

test('empate por tempo e morte súbita fecham a arena', () => {
  const s = new Sim({ seed: 3, map: 2, n: 2 });
  run(s, 100);
  assert.equal(s.sd.on, true);
  run(s, 60);
  assert.equal(s.ended, true);
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
