// ===== Núcleo del juego: pistas, física, vueltas y bots (sin DOM) =====
export const SPACING = 8;      // distancia entre muestras de la línea central
export const TRACK_W = 150;    // ancho del asfalto
export const KERB = 10;        // piano a cada lado
export const RUNOFF = 85;      // pasto hasta el muro
export const SCALE = 50;       // unidades de grilla → unidades de mundo
export const CAR_R = 14;       // radio de colisión
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export const PHYS = {
  maxSpeed: 560, acc: 430, brake: 950, rev: 170,
  drag: 0.12, grassDrag: 1.6, grassMax: 0.45,
  grip: 7.5, grassGrip: 3.2, steer: 2.9,
};

// Puntos: [x, y, radio?] en grilla; los vértices se redondean con arcos
export const TRACKS = [
  { id: 'cba', name: 'Autódromo de Córdoba', r: 5, pts: [
    [0,0],[60,0],[70,8],[66,18,3],[72,26,3],[72,44],[60,52],[44,46],[36,54,3],[20,54],[8,44],[14,32],[4,22],[-2,10]] },
  { id: 'jujuy', name: 'Quebrada de Jujuy', r: 4, pts: [
    [0,0],[30,-6],[44,4],[40,18],[52,26],[66,14],[80,18],[84,34],[72,46],[78,58],[64,68],[44,62],[34,70],[16,66],[8,52],[18,40],[6,28],[-4,16]] },
  { id: 'veloz', name: 'Speedway Veloz', r: 6, pts: [
    [0,0],[70,0,2],[75,6,2],[81,0,2],[112,0],[124,10],[120,26],[102,30,3],[96,38,2],[102,45,2],[112,50],[106,62],[20,62],[6,54],[10,40,3],[0,30,3],[-6,12]] },
  { id: 'callejero', name: 'Callejero Nueva Córdoba', r: 2.6, pts: [
    [0,0],[40,0],[40,16],[60,16],[60,0],[84,0],[84,44],[66,44],[66,60],[84,60],[84,76],[0,76],[0,52],[20,52],[20,34],[0,34]] },
  { id: 'sierras', name: 'Las Sierras', r: 6, pts: [
    [0,0],[24,-8],[50,-4],[64,8],[60,26],[76,36],[70,54],[48,56,5],[38,44,4],[24,50,5],[8,42],[-4,24]] },
  { id: 'rafaela', name: 'Óvalo de Rafaela', r: 13, pts: [
    [0,0],[90,0],[90,40],[0,40]] },
];

const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
export const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function buildTrack(def) {
  const P = def.pts.map(p => ({ x: p[0] * SCALE, y: p[1] * SCALE, r: (p[2] ?? def.r ?? 5) * SCALE }));
  const n = P.length, poly = [];
  for (let i = 0; i < n; i++) {
    const p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const d1 = norm(a.x - p.x, a.y - p.y), d2 = norm(b.x - p.x, b.y - p.y);
    const th = Math.acos(clamp(d1.x * d2.x + d1.y * d2.y, -1, 1));
    if (th > Math.PI - 0.01) { poly.push({ x: p.x, y: p.y }); continue; }
    let r = p.r, t = r / Math.tan(th / 2);
    const tmax = Math.min(Math.hypot(a.x - p.x, a.y - p.y), Math.hypot(b.x - p.x, b.y - p.y)) * 0.48;
    if (t > tmax) { t = tmax; r = t * Math.tan(th / 2); }
    const t1 = { x: p.x + d1.x * t, y: p.y + d1.y * t }, t2 = { x: p.x + d2.x * t, y: p.y + d2.y * t };
    const bis = norm(d1.x + d2.x, d1.y + d2.y), cd = r / Math.sin(th / 2);
    const c = { x: p.x + bis.x * cd, y: p.y + bis.y * cd };
    const a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
    const da = wrapA(Math.atan2(t2.y - c.y, t2.x - c.x) - a1);
    const steps = Math.max(2, Math.ceil(Math.abs(da) * r / 4));
    for (let k = 0; k <= steps; k++) {
      const ang = a1 + da * k / steps;
      poly.push({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
    }
  }
  // remuestreo uniforme
  const cum = [0];
  for (let i = 1; i <= poly.length; i++) {
    const A = poly[i - 1], B = poly[i % poly.length];
    cum.push(cum[i - 1] + Math.hypot(B.x - A.x, B.y - A.y));
  }
  const L = cum[cum.length - 1], N = Math.round(L / SPACING), sp = L / N;
  let pts = [], j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * sp;
    while (cum[j + 1] < s) j++;
    const A = poly[j], B = poly[(j + 1) % poly.length], f = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    pts.push({ x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f });
  }
  let ang = pts.map((p, i) => { const A = pts[(i - 1 + N) % N], B = pts[(i + 1) % N]; return Math.atan2(B.y - A.y, B.x - A.x); });
  // largada: 70% de la recta más larga
  const straight = ang.map((a, i) => Math.abs(wrapA(ang[(i + 1) % N] - a)) < 0.003);
  let best = 0, bestStart = 0;
  let s0 = straight.findIndex(v => !v); if (s0 < 0) s0 = 0;
  for (let k = 0, run = 0, rs = 0; k < N * 2; k++) {
    const i = (s0 + k) % N;
    if (straight[i]) { if (run === 0) rs = i; run++; if (run > best && run <= N) { best = run; bestStart = rs; } }
    else run = 0;
  }
  const start = (bestStart + Math.floor(best * 0.7)) % N;
  pts = pts.slice(start).concat(pts.slice(0, start));
  ang = ang.slice(start).concat(ang.slice(0, start));
  const nx = ang.map(a => -Math.sin(a)), ny = ang.map(a => Math.cos(a));
  // curvatura (rad / unidad) suavizada
  const curv = ang.map((a, i) => Math.abs(wrapA(ang[(i + 6) % N] - ang[(i - 6 + N) % N])) / (12 * sp));
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of pts) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  return { id: def.id, name: def.name, pts, ang, nx, ny, curv, n: N, sp, len: L, box: { minx, miny, maxx, maxy } };
}

export function gridSlot(tr, k) {
  const back = Math.round(4 + k * 6.5);
  const idx = ((-back % tr.n) + tr.n) % tr.n;
  const side = k % 2 ? -1 : 1, p = tr.pts[idx];
  return { x: p.x + tr.nx[idx] * 30 * side, y: p.y + tr.ny[idx] * 30 * side, a: tr.ang[idx], idx, prog: -back };
}

export function createCar(tr, slot, laps) {
  const g = gridSlot(tr, slot);
  return { x: g.x, y: g.y, a: g.a, vx: 0, vy: 0, idx: g.idx, prog: g.prog, lat: 0,
    cross: -1, lapStart: 0, best: 0, last: 0, laps, fin: false, ft: 0, off: false, draft: 0, wall: 0, maxMul: 1, slip: 0 };
}

export function respawn(c, tr) {
  const p = tr.pts[c.idx];
  c.x = p.x; c.y = p.y; c.a = tr.ang[c.idx]; c.vx = c.vy = 0;
}

function trackPos(c, tr) {
  const N = tr.n;
  let bi = c.idx, bd = 1e18;
  for (let k = -30; k <= 30; k++) {
    const i = (c.idx + k + N) % N, p = tr.pts[i], d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  let delta = bi - c.idx;
  if (delta > N / 2) delta -= N; if (delta < -N / 2) delta += N;
  c.prog += delta; c.idx = bi;
  const p = tr.pts[bi];
  c.lat = (c.x - p.x) * tr.nx[bi] + (c.y - p.y) * tr.ny[bi];
}

// input: { up, down, steer (-1..1) }
export function stepCar(c, inp, tr, dt, t) {
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  let vf = c.vx * fx + c.vy * fy, vl = -c.vx * fy + c.vy * fx;
  const maxS = PHYS.maxSpeed * c.maxMul * (c.off ? PHYS.grassMax : 1) * (1 + c.draft * 0.07);
  if (inp.up) vf += PHYS.acc * dt * Math.max(0, 1 - vf / maxS);
  if (inp.down) { if (vf > 5) vf -= PHYS.brake * dt; else vf = Math.max(-150, vf - PHYS.rev * dt); }
  if (!inp.up && !inp.down) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 70 * dt);
  vf -= vf * (c.off ? PHYS.grassDrag : PHYS.drag) * dt;
  if (vf > maxS) vf -= (vf - maxS) * 2.5 * dt;
  const sp = Math.abs(vf);
  const rate = PHYS.steer * Math.min(1, sp / 120) * (1 - 0.42 * Math.min(1, sp / PHYS.maxSpeed)) * (c.off ? 0.8 : 1);
  c.a = wrapA(c.a + clamp(inp.steer || 0, -1, 1) * rate * dt * Math.sign(vf));
  c.slip = Math.abs(vl);
  vl *= Math.exp(-(c.off ? PHYS.grassGrip : PHYS.grip) * dt);
  c.vx = vf * fx - vl * fy; c.vy = vf * fy + vl * fx;
  c.x += c.vx * dt; c.y += c.vy * dt;
  trackPos(c, tr);
  const half = TRACK_W / 2;
  c.off = Math.abs(c.lat) > half + KERB - 4;
  const lim = half + KERB + RUNOFF - CAR_R;
  c.wall = Math.max(0, c.wall - dt);
  if (Math.abs(c.lat) > lim) {
    const s = Math.sign(c.lat), nx = tr.nx[c.idx] * s, ny = tr.ny[c.idx] * s, over = Math.abs(c.lat) - lim;
    c.x -= nx * over; c.y -= ny * over;
    const vn = c.vx * nx + c.vy * ny;
    if (vn > 0) { c.vx -= nx * vn * 1.4; c.vy -= ny * vn * 1.4; }
    c.vx *= 0.97; c.vy *= 0.97;
    if (vn > 60) c.wall = 0.3;
    c.lat = lim * s;
  }
  // vueltas
  const cr = Math.floor(c.prog / tr.n);
  let event = null;
  if (cr > c.cross) {
    c.cross = cr;
    if (cr >= 1 && !c.fin) {
      c.last = t - c.lapStart; c.lapStart = t;
      if (!c.best || c.last < c.best) { c.best = c.last; event = 'best'; } else event = 'lap';
      if (cr >= c.laps) { c.fin = true; c.ft = t; event = 'fin'; }
    }
  }
  return event;
}

export function currentLap(c) { return clamp(c.cross + 1, 1, c.laps); }

// rebufo y choques contra otros autos (o = [{x,y,vx,vy}])
export function interact(c, others, collisions) {
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  let draft = 0;
  for (const o of others) {
    const dx = o.x - c.x, dy = o.y - c.y;
    const fwd = dx * fx + dy * fy, side = Math.abs(-dx * fy + dy * fx);
    if (fwd > 45 && fwd < 260 && side < 26) draft = 1;
    if (!collisions) continue;
    const d = Math.hypot(dx, dy);
    if (d < CAR_R * 2 && d > 0.01) {
      const nx = -dx / d, ny = -dy / d, push = (CAR_R * 2 - d) * 0.6;
      c.x += nx * push; c.y += ny * push;
      const rv = (c.vx - (o.vx || 0)) * nx + (c.vy - (o.vy || 0)) * ny;
      if (rv < 0) { c.vx -= nx * rv * 0.7; c.vy -= ny * rv * 0.7; }
    }
  }
  c.draft += ((draft ? 1 : 0) - c.draft) * 0.05;
}

// ===== IA =====
export const BOT_LEVELS = { facil: 0.84, normal: 0.92, dificil: 0.985 };

export function botInput(c, tr, bot) {
  const N = tr.n, sp = Math.hypot(c.vx, c.vy);
  const look = Math.round(9 + sp * 0.04);
  const ti = (c.idx + look) % N, tp = tr.pts[ti];
  const lane = bot.lane * (1 - Math.min(1, tr.curv[ti] * 250));
  const tx = tp.x + tr.nx[ti] * lane, ty = tp.y + tr.ny[ti] * lane;
  const diff = wrapA(Math.atan2(ty - c.y, tx - c.x) - c.a);
  const steer = clamp(diff * 2.8, -1, 1);
  const aLat = 820 * bot.skill, brk = PHYS.brake * 0.75;
  const ahead = Math.min(N - 1, Math.round((sp * sp / (2 * brk) + 160) / tr.sp));
  let target = PHYS.maxSpeed * bot.skill * c.maxMul;
  for (let k = 0; k <= ahead; k += 2) {
    const i = (c.idx + k) % N, R = 1 / Math.max(1e-5, tr.curv[i]);
    const vc = Math.sqrt(aLat * R), dist = k * tr.sp;
    const allow = Math.sqrt(vc * vc + 2 * brk * dist);
    if (allow < target) target = allow;
  }
  if (c.off) target = Math.min(target, 260);
  return { up: sp < target - 8, down: sp > target + 25, steer };
}
