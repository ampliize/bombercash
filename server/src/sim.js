// Simulação autoritativa do BomberCash (porte headless das regras do demo/index.html).
// Determinística: toda aleatoriedade sai de um PRNG semeado; mesmo seed + mesmas entradas = mesmo resultado (replay).
export const T = 48, FL = .52;
export const MATCH_T = 150, SD_START = 90, SD_DUR = 40, SD_WARN = .9, SD_FALL = .28;
// empate: duelo de morte súbita só entre os finalistas, no mapa de lava (igual ao demo/index.html)
export const DUEL_FREEZE = 3, DUEL_SD = 5, DUEL_DUR = 34, DUEL_SPEED = 140;
export const MAPS = ['fac', 'jun', 'cas', 'isl', 'rui', 'lab', 'fort'];
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const FACES = ['down', 'up', 'left', 'right'];
export const ITEM_KEYS = ['fire', 'bomb', 'speed', 'shield', 'star', 'skull'];
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;

export function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function layout(n) { return n > 4 ? { W: 21, H: 15 } : { W: 15, H: 13 }; }

export class Sim {
  // opts: { seed, map (0..6), n (2|4|8), ids?: string[] }
  constructor(o) {
    this.seed = o.seed >>> 0; this.map = o.map | 0; this.N = o.n;
    const { W, H } = layout(o.n); this.W = W; this.H = H;
    this.rng = prng(this.seed);
    this.matchT = 0; this.ended = false; this.winner = -1; this.seq = 1; this.tick = 0; this.duel = 0; this.freeze = 0; this.sdStart = SD_START;
    this.bombs = []; this.flames = []; this.items = [];
    this.sd = { on: false, order: [], idx: 0, next: 0, every: .4, falling: [], blocks: new Set(), doomed: new Set() };
    this.bridges = new Set();
    const { W: w, H: h } = this;
    const starts = (this.N > 4 ? [[1, 1], [w - 2, h - 2], [w - 2, 1], [1, h - 2], [(w - 1) / 2, 1], [(w - 1) / 2, h - 2], [1, (h - 1) / 2], [w - 2, (h - 1) / 2]] : [[1, 1], [w - 2, h - 2], [w - 2, 1], [1, h - 2]]).slice(0, this.N);
    this.genWorld(starts);
    this.players = starts.map(([x, y], i) => ({ i, x: (x + .5) * T, y: (y + .5) * T, alive: true, face: 'down', bombMax: 1, power: 2, speed: 125, cooldown: 0, shield: 0, inv: 0, curse: 0, mv: false, axis: null, dir: [0, 0], wantBomb: false, lastIn: 0, deadAt: -1, pass: 0 }));
  }
  at(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }
  id(x, y) { return y * this.W + x; }
  solid(x, y) { return !this.at(x, y) || this.world[y][x] > 0; }
  genWorld(starts) {
    const { W, H, rng } = this;
    // simétrico: sorteia um quadrante e espelha nos eixos, para ninguém ter mapa melhor que o outro
    const dens = .5 + rng() * .25, sparse = rng() < .4;
    const w = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)) ? 2 : 0));
    const mir = (x, y, v) => { for (const [a, b] of [[x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]]) w[b][a] = v; };
    if (sparse) for (let y = 2; y <= (H - 1) / 2; y += 2) for (let x = 2; x <= (W - 1) / 2; x += 2) if (rng() >= .7) mir(x, y, 0);
    this.world = w;
    const key = MAPS[this.map];
    if (key === 'isl') {
      const cxs = W === 15 ? [4, 10] : [6, 14], cys = [4, H - 5], bx = W === 15 ? [2, 7, 12] : [3, 10, 17], by = H === 13 ? [2, 6, 10] : [2, 7, 12];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (cxs.includes(x) || cys.includes(y)) w[y][x] = 3;
      for (const x of cxs) for (const y of by) { w[y][x] = 0; this.bridges.add(this.id(x, y)); }
      for (const y of cys) for (const x of bx) { w[y][x] = 0; this.bridges.add(this.id(x, y)); }
      w[(H - 1) / 2][(W - 1) / 2] = 0;
    }
    const safe = new Set();
    for (const [sx, sy] of starts) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.at(sx + dx, sy + dy)) safe.add(this.id(sx + dx, sy + dy));
    if (key === 'isl') safe.add(this.id((W - 1) / 2, (H - 1) / 2));
    for (let y = 1; y <= (H - 1) / 2; y++) for (let x = 1; x <= (W - 1) / 2; x++) if (!w[y][x] && !safe.has(this.id(x, y)) && !this.bridges.has(this.id(x, y)) && rng() < dens) mir(x, y, 1);
  }
  // ---- entradas (validadas): direção -1/0/1, bomba ----
  input(i, d) {
    const p = this.players[i]; if (!p || !p.alive || this.ended) return;
    const c = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
    p.dir = [c(+d.dx || 0), c(+d.dy || 0)];
    if (d.bomb) p.wantBomb = true;
  }
  leave(i) { const p = this.players[i]; if (p && p.alive && !this.ended) { p.alive = false; p.deadAt = this.matchT; p.left = true; } }
  canMove(p, nx, ny) {
    const r = 15;
    for (const xx of [nx - r, nx + r]) for (const yy of [ny - r, ny + r]) {
      const gx = Math.floor(xx / T), gy = Math.floor(yy / T);
      if (this.solid(gx, gy)) return false;
      for (const b of this.bombs) if (b.x === gx && b.y === gy && !(b.pass & (1 << p.i))) return false;
    }
    return true;
  }
  move(p, dx, dy, dt) {
    const s = p.speed * (p.curse > 0 ? .6 : 1) * dt;
    if (dx && dy) { if (p.axis === 'x') dx = 0; else dy = 0; } else if (dx || dy) p.axis = dx ? 'x' : 'y';
    p.mv = !!(dx || dy);
    if (dx || dy) {
      p.face = dy > 0 ? 'down' : dy < 0 ? 'up' : dx < 0 ? 'left' : 'right';
      this.walkStep(p, dx, dy, s);
    }
    this.pickup(p);
  }
  walkable(p, x, y) { return !this.solid(x, y) && !this.bombs.some(b => b.x === x && b.y === y && !(b.pass & (1 << p.i))); }
  // anda nos trilhos: centraliza na faixa e escorrega na quina para a faixa vizinha livre (igual ao demo/index.html)
  walkStep(p, dx, dy, s) {
    const ax = dx ? 0 : 1, d = dx || dy, u = ax ? p.x : p.y, v = ax ? p.y : p.x, cell = Math.floor(u / T), cen = (cell + .5) * T, off = cen - u;
    const go = (a, b) => ax ? this.canMove(p, p.x + b, p.y + a) : this.canMove(p, p.x + a, p.y + b), mv = (a, b) => { if (ax) { p.x += b; p.y += a; } else { p.x += a; p.y += b; } };
    if (go(d * s, 0)) { mv(d * s, 0); if (Math.abs(off) > .3) { const t = Math.sign(off) * Math.min(Math.abs(off), s * .6); if (go(0, t)) mv(0, t); } return; }
    const ahead = c => { const vv = Math.floor(v / T) + d; return ax ? this.walkable(p, c, vv) : this.walkable(p, vv, c); }, nb = cell + (off < 0 ? 1 : -1), nbOff = (nb + .5) * T - u;
    let tgt = null; if (ahead(cell)) tgt = off; else if (Math.abs(nbOff) < T * .6 && ahead(nb)) tgt = nbOff;
    if (tgt !== null && Math.abs(tgt) > .3) { const t = Math.sign(tgt) * Math.min(Math.abs(tgt), s); if (go(0, t)) mv(0, t); }
  }
  pickup(p) {
    for (const it of this.items.slice()) if (Math.abs(p.x - (it.x + .5) * T) < 24 && Math.abs(p.y - (it.y + .5) * T) < 24) {
      this.items.splice(this.items.indexOf(it), 1);
      const k = it.kind;
      if (k === 'fire') p.power = Math.min(7, p.power + 1); else if (k === 'bomb') p.bombMax = Math.min(6, p.bombMax + 1); else if (k === 'speed') p.speed = Math.min(175, p.speed + 13);
      else if (k === 'shield') p.shield = 1; else if (k === 'star') p.inv = Math.max(p.inv, 5); else if (k === 'skull') p.curse = 7;
    }
  }
  place(p) {
    if (!p.alive || p.cooldown > 0) return;
    const x = Math.round((p.x - T / 2) / T), y = Math.round((p.y - T / 2) / T);
    if (!this.at(x, y) || this.world[y][x] > 0) return;
    if (this.bombs.some(b => b.x === x && b.y === y) || this.bombs.filter(b => b.owner === p.i).length >= p.bombMax) return;
    let pass = 0; for (const q of this.players) if (q.alive && Math.abs(q.x - (x + .5) * T) < T / 2 + 15 && Math.abs(q.y - (y + .5) * T) < T / 2 + 15) pass |= 1 << q.i;
    this.bombs.push({ id: this.seq++, x, y, owner: p.i, t: 2.1, power: p.power, pass });
    p.cooldown = .23;
  }
  drop(x, y) {
    if (this.rng() >= .3) return; const r = this.rng();
    this.items.push({ x, y, born: this.matchT, kind: r < .32 ? 'fire' : r < .56 ? 'bomb' : r < .73 ? 'speed' : r < .84 ? 'shield' : r < .9 ? 'star' : 'skull' });
  }
  blast(b) {
    const loc = [[b.x, b.y, 'c', null]], w = this.world;
    for (const [dx, dy] of D4) {
      let lastI = -1;
      for (let s = 1; s <= b.power; s++) {
        const x = b.x + dx * s, y = b.y + dy * s;
        if (!this.at(x, y) || w[y][x] === 2) break;
        loc.push([x, y, dx ? 'h' : 'v', null]); lastI = loc.length - 1;
        if (w[y][x] === 1) { w[y][x] = 0; this.drop(x, y); loc[lastI][4] = 1; break; }
      }
      if (lastI > 0) loc[lastI][3] = [dx, dy];
    }
    // fogo destrói item no chão; item recém-saído de caixa (<0,6s) sobrevive
    const hit = new Set(loc.filter(c => !c[4]).map(c => this.id(c[0], c[1])));
    this.items = this.items.filter(it => !(hit.has(this.id(it.x, it.y)) && this.matchT - it.born > .6));
    const owner = this.players[b.owner], pal = owner && owner.skin >= 4 ? owner.skin - 3 : 0;
    for (const [x, y, k, end] of loc) {
      this.flames.push({ x, y, t: FL, k, end, pal, bid: b.id });
      for (const o of this.bombs) if (o !== b && o.x === x && o.y === y) o.t = Math.min(o.t, .04);
    }
  }
  // ---- morte súbita ----
  sdRings() { if (this.duel) return Math.ceil(Math.min(this.W, this.H) / 2) - 1; const { W, H } = this; let k = 1; const free = n => { let c = 0; for (let y = n; y <= H - 1 - n; y++) for (let x = n; x <= W - 1 - n; x++) if (!(x % 2 === 0 && y % 2 === 0)) c++; return c; }; while (free(k + 1) >= 10) k++; return k - 1; }
  sdOrder() {
    const { W, H } = this, out = [], rings = this.sdRings();
    if (this.duel) { // a lava entra por um ponto sorteado do anel e segue em fila até o centro
      for (let k = 1; k <= rings; k++) {
        const x0 = k, x1 = W - 1 - k, y0 = k, y1 = H - 1 - k, L = []; if (x0 > x1 || y0 > y1) break;
        for (let x = x0; x <= x1; x++) L.push([x, y0]);
        if (y1 > y0) { for (let y = y0 + 1; y <= y1; y++) L.push([x1, y]); for (let x = x1 - 1; x >= x0; x--) L.push([x, y1]); for (let y = y1 - 1; y > y0; y--) L.push([x0, y]); }
        const r = Math.floor(this.rng() * L.length); for (let i = 0; i < L.length; i++) out.push(L[(i + r) % L.length]);
      }
      return out;
    }
    for (let k = 1; k <= rings; k++) {
      const x0 = k, x1 = W - 1 - k, y0 = k, y1 = H - 1 - k, L = [];
      for (let x = x0; x <= x1; x++) L.push([x, y0]); for (let y = y0 + 1; y <= y1; y++) L.push([x1, y]); for (let x = x1 - 1; x >= x0; x--) L.push([x, y1]); for (let y = y1 - 1; y > y0; y--) L.push([x0, y]);
      const h = Math.ceil(L.length / 2); for (let i = 0; i < h; i++) { out.push(L[i]); if (L[h + i]) out.push(L[h + i]); }
    }
    return out;
  }
  land(x, y) {
    const k = this.id(x, y); this.world[y][x] = 2; this.sd.blocks.add(k); this.sd.doomed.delete(k); this.bridges.delete(k);
    this.items = this.items.filter(i => !(i.x === x && i.y === y)); this.bombs = this.bombs.filter(b => !(b.x === x && b.y === y));
    for (const p of this.players) if (p.alive) {
      const cx = Math.floor(p.x / T), cy = Math.floor(p.y / T);
      if (cx === x && cy === y) { this.kill(p); continue; }
      if (Math.abs(p.x - (x + .5) * T) < T / 2 + 15 && Math.abs(p.y - (y + .5) * T) < T / 2 + 15) { if (cx !== x) p.x = (cx + .5) * T; if (cy !== y) p.y = (cy + .5) * T; }
    }
  }
  sdUpdate(dt) {
    const sd = this.sd;
    if (!sd.on) {
      if (this.matchT >= this.sdStart) { sd.on = true; sd.order = this.sdOrder().filter(([x, y]) => this.world[y][x] !== 2); sd.doomed = new Set(sd.order.map(c => this.id(c[0], c[1]))); sd.idx = 0; sd.every = this.duel ? Math.max(.08, DUEL_DUR / Math.max(1, sd.order.length)) : Math.max(.1, SD_DUR / Math.max(1, Math.ceil(sd.order.length / 2))); sd.next = this.duel ? .6 : 1.4; }
      return;
    }
    sd.next -= dt;
    while (sd.next <= 0 && sd.idx < sd.order.length) { for (let n = 0; n < (this.duel ? 1 : 2) && sd.idx < sd.order.length; n++) { const c = sd.order[sd.idx++]; if (this.world[c[1]][c[0]] !== 2) sd.falling.push({ x: c[0], y: c[1], t: SD_WARN + SD_FALL }); } sd.next += sd.every; }
    for (const f of sd.falling.slice()) { f.t -= dt; if (f.t <= 0) { sd.falling.splice(sd.falling.indexOf(f), 1); this.land(f.x, f.y); } }
  }
  kill(p) { p.alive = false; p.deadAt = this.matchT; p.deadTick = this.tick; }
  // ---- passo da simulação ----
  step(dt) {
    if (this.ended) { for (const f of this.flames.slice()) { f.t -= dt; if (f.t <= 0) this.flames.splice(this.flames.indexOf(f), 1); } return; }
    if (this.freeze > 0) { this.freeze -= dt; for (const p of this.players) p.wantBomb = false; return; }
    this.tick++;
    for (const p of this.players) { p.cooldown = Math.max(0, p.cooldown - dt); p.inv = Math.max(0, p.inv - dt); p.curse = Math.max(0, p.curse - dt); }
    for (const p of this.players) if (p.alive) {
      this.move(p, p.dir[0], p.dir[1], dt);
      if (p.wantBomb) { this.place(p); p.wantBomb = false; }
    }
    for (const b of this.bombs.slice()) {
      b.t -= dt;
      for (const q of this.players) if ((b.pass & (1 << q.i)) && (Math.abs(q.x - (b.x + .5) * T) >= T / 2 + 15 || Math.abs(q.y - (b.y + .5) * T) >= T / 2 + 15)) b.pass &= ~(1 << q.i);
      if (b.t <= 0 && this.bombs.includes(b)) { this.bombs.splice(this.bombs.indexOf(b), 1); this.blast(b); }
    }
    for (const f of this.flames.slice()) {
      f.t -= dt;
      for (const p of this.players) if (p.alive && p.inv <= 0 && Math.abs(p.x - (f.x + .5) * T) < T * .56 && Math.abs(p.y - (f.y + .5) * T) < T * .56) {
        if (p.shield) { p.shield = 0; p.inv = 1.1; } else this.kill(p);
      }
      if (f.t <= 0) this.flames.splice(this.flames.indexOf(f), 1);
    }
    this.matchT += dt; this.sdUpdate(dt);
    const alive = this.players.filter(p => p.alive);
    if (alive.length === 1) this.finish(alive[0].i);
    else if (alive.length === 0) { // morreram no mesmo passo: duelo entre eles
      const ids = this.players.filter(p => p.deadTick === this.tick).map(p => p.i);
      if (ids.length >= 2) this.startDuel(ids); else this.finish(-1);
    } else if (!this.duel && this.matchT > MATCH_T) this.startDuel(alive.map(p => p.i)); // tempo acabou com 2+ de pé
  }
  startDuel(ids) {
    this.duel++; const { W, H } = this;
    const st = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2], [(W - 1) / 2, 1], [(W - 1) / 2, H - 2], [1, (H - 1) / 2], [W - 2, (H - 1) / 2]];
    this.bombs = []; this.flames = []; this.items = []; this.bridges = new Set();
    this.sd = { on: false, order: [], idx: 0, next: 0, every: .4, falling: [], blocks: new Set(), doomed: new Set() };
    // mapa exclusivo do duelo: lava em volta, poucos pilares e caixas, espelhado
    const w = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? 2 : 0));
    const mir = (x, y, v) => { for (const [a, b] of [[x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]]) w[b][a] = v; }, safe = new Set();
    for (const [sx, sy] of st) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) safe.add(this.id(sx + dx, sy + dy));
    for (let y = 2; y <= (H - 1) / 2; y += 2) for (let x = 2; x <= (W - 1) / 2; x += 2) if (this.rng() < .45) mir(x, y, 2);
    for (let y = 1; y <= (H - 1) / 2; y++) for (let x = 1; x <= (W - 1) / 2; x++) if (!w[y][x] && !safe.has(this.id(x, y)) && this.rng() < .12) mir(x, y, 1);
    this.world = w;
    let k = 0;
    for (const p of this.players) {
      if (ids.includes(p.i)) { const [x, y] = st[k++]; Object.assign(p, { x: (x + .5) * T, y: (y + .5) * T, alive: true, bombMax: 1, power: 2, speed: DUEL_SPEED, shield: 0, inv: 0, curse: 0, cooldown: 0, dir: [0, 0], wantBomb: false, deadAt: -1, deadTick: -1, face: 'down', mv: false }); }
      else p.alive = false;
    }
    this.matchT = 0; this.sdStart = DUEL_SD; this.freeze = DUEL_FREEZE;
  }
  finish(w) { this.ended = true; this.winner = w; }
  encWorld() { let s = ''; for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) s += this.sd.blocks.has(this.id(x, y)) ? 4 : this.world[y][x]; return s; }
  // snapshot no mesmo formato que o demo (applySnap) para o cliente reaproveitar o desenho
  snapshot() {
    return {
      t: this.freeze > 0 ? -r2(this.freeze) : r2(this.matchT), w: this.encWorld(),
      p: this.players.map(p => [r1(p.x), r1(p.y), FACES.indexOf(p.face), p.mv ? 1 : 0, p.alive ? 1 : 0, p.bombMax, p.power, p.speed, p.shield, r2(p.inv), r2(p.curse)]),
      b: this.bombs.map(b => [b.id, b.x, b.y, r2(b.t), b.owner, b.power]),
      f: this.flames.map(f => [f.x, f.y, r2(f.t), f.k, f.end ? f.end[0] : 0, f.end ? f.end[1] : 0, f.pal, f.bid]),
      it: this.items.map(i => [i.x, i.y, ITEM_KEYS.indexOf(i.kind)]),
      fl: this.sd.falling.map(f => [f.x, f.y, r2(f.t)]), sd: this.sd.on ? 1 : 0, du: this.duel, e: this.ended ? 1 : 0, wi: this.winner,
    };
  }
}
