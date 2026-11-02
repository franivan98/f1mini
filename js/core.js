// ===== Núcleo del juego: pistas, física, vueltas, boxes, DRS y bots (sin DOM) =====
export const SPACING = 8;      // distancia entre muestras de la línea central
export const TRACK_W = 150;    // ancho del asfalto
export const KERB = 10;        // piano
export const SCALE = 50;       // unidades de grilla → unidades de mundo
export const CAR_R = 14;       // radio para el muro
export const CC_R = 11;        // radio de los 2 círculos de colisión entre autos
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const PIT_LIMIT = 150;  // ≈ 90 km/h
export const PIT_TIME = 2.6;   // cambio de gomas
export const PIT_DMG_TIME = 2.2; // extra si hay que cambiar alerón
const PIT_OUT = 74;            // borde externo del pit lane (desde el borde del piano)

export const PHYS = {
  maxSpeed: 560, acc: 430, brake: 950, rev: 170,
  drag: 0.12, grassDrag: 1.6, grassMax: 0.45, gravelDrag: 3.2, gravelMax: 0.3,
  grip: 7.5, grassGrip: 3.2, gravelGrip: 2.2, steer: 2.9,
};
export const WEAR = { off: 0, normal: 1, alto: 2.6 };

// Puntos: [x, y, radio?] en grilla; los vértices se redondean con arcos
export const TRACKS = [
  { id: 'cba', name: 'Autódromo de Córdoba', r: 5, theme: 'campo', pts: [
    [0,0],[60,0],[70,8],[66,18,3],[72,26,3],[72,44],[60,52],[44,46],[36,54,3],[20,54],[8,44],[14,32],[4,22],[-2,10]] },
  { id: 'jujuy', name: 'Quebrada de Jujuy', r: 4, theme: 'quebrada', pts: [
    [0,0],[30,-6],[44,4],[40,18],[52,26],[66,14],[80,18],[84,34],[72,46],[78,58],[64,68],[44,62],[34,70],[16,66],[8,52],[18,40],[6,28],[-4,16]] },
  { id: 'veloz', name: 'Speedway Veloz', r: 6, theme: 'estadio', pts: [
    [0,0],[70,0,2],[75,6,2],[81,0,2],[112,0],[124,10],[120,26],[102,30,3],[96,38,2],[102,45,2],[112,50],[106,62],[20,62],[6,54],[10,40,3],[0,30,3],[-6,12]] },
  { id: 'callejero', name: 'Callejero Nueva Córdoba', r: 2.6, theme: 'ciudad', runoff: 34, pts: [
    [0,0],[40,0],[40,16],[60,16],[60,0],[84,0],[84,44],[66,44],[66,60],[84,60],[84,76],[0,76],[0,52],[20,52],[20,34],[0,34]] },
  { id: 'sierras', name: 'Las Sierras', r: 6, theme: 'sierras', pts: [
    [0,0],[24,-8],[50,-4],[64,8],[60,26],[76,36],[70,54],[48,56,5],[38,44,4],[24,50,5],[8,42],[-4,24]] },
  { id: 'rafaela', name: 'Óvalo de Rafaela', r: 13, theme: 'estadio', pts: [
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
  const straightAt = (an, i) => Math.abs(wrapA(an[(i + 1) % N] - an[i])) < 0.003;
  // largada: 70% de la recta más larga
  let best = 0, bestStart = 0;
  { let s0 = 0; while (s0 < N && straightAt(ang, s0)) s0++; if (s0 >= N) s0 = 0;
    for (let k = 0, run = 0, rs = 0; k < N * 2; k++) {
      const i = (s0 + k) % N;
      if (straightAt(ang, i)) { if (run === 0) rs = i; run++; if (run > best && run <= N) { best = run; bestStart = rs; } }
      else run = 0;
    } }
  const start = (bestStart + Math.floor(best * 0.7)) % N;
  pts = pts.slice(start).concat(pts.slice(0, start));
  ang = ang.slice(start).concat(ang.slice(0, start));
  const nx = ang.map(a => -Math.sin(a)), ny = ang.map(a => Math.cos(a));
  const cs = ang.map((a, i) => wrapA(ang[(i + 6) % N] - ang[(i - 6 + N) % N]) / (12 * sp)); // curvatura con signo
  const curv = cs.map(Math.abs);
  const runoff = def.runoff ?? 85, half = TRACK_W / 2;
  // pianos en curvas, grava afuera de curvas cerradas
  const kerb = new Uint8Array(N), gravel = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    if (curv[i] > 0.0011) for (let k = -7; k <= 7; k++) kerb[(i + k + N) % N] = 1;
    if (!def.runoff && curv[i] > 0.0017) for (let k = -12; k <= 16; k++) gravel[(i + k + N) % N] = -Math.sign(cs[i]);
  }
  // rectas → zonas DRS
  const runs = [];
  { let s0 = 0; while (s0 < N && straightAt(ang, s0)) s0++;
    for (let k = 0, run = 0, rs = 0; k <= N; k++) {
      const i = (s0 + k) % N;
      if (k < N && straightAt(ang, i)) { if (run === 0) rs = i; run++; }
      else { if (run) runs.push({ s: rs, len: run }); run = 0; }
    } }
  const drs = new Int16Array(N).fill(-1), drsZones = [];
  for (const r of runs) {
    if (r.len * sp < 1100) continue;
    const a = r.s + Math.floor(r.len * 0.15), b = r.s + Math.floor(r.len * 0.85);
    const id = drsZones.length; drsZones.push({ a: a % N, b: b % N });
    for (let i = a; i <= b; i++) { drs[i % N] = id; gravel[i % N] = 0; }
  }
  // boxes en la recta principal, del lado de adentro del circuito
  let cx = 0, cy = 0; for (const p of pts) { cx += p.x; cy += p.y; } cx /= N; cy /= N;
  const side = ((cx - pts[0].x) * nx[0] + (cy - pts[0].y) * ny[0]) > 0 ? 1 : -1;
  const pit = { side, from: -Math.min(Math.floor(best * 0.62), 80), to: Math.min(Math.floor(best * 0.27), 36),
    boxFrom: -Math.min(Math.floor(best * 0.36), 46), boxTo: -Math.min(Math.floor(best * 0.08), 10),
    lat: side * (half + KERB + PIT_OUT / 2 + 3), inner: half + KERB + 3, outer: half + KERB + PIT_OUT };
  for (let r = pit.from - 10; r <= pit.to + 10; r++) { const i = (r + N) % N; if (gravel[i] === side) gravel[i] = 0; }
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of pts) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
  return { id: def.id, name: def.name, theme: def.theme, street: !!def.runoff, runoff, pts, ang, nx, ny, cs, curv, kerb, gravel,
    drs, drsZones, pit, mainLen: best, n: N, sp, len: L, center: { x: cx, y: cy }, box: { minx, miny, maxx, maxy } };
}

export const relIdx = (tr, i) => i > tr.n / 2 ? i - tr.n : i;
export function inPitZone(tr, i) { const r = relIdx(tr, i); return r >= tr.pit.from && r <= tr.pit.to; }

export function gridSlot(tr, k) {
  const back = Math.round(4 + k * 6.5);
  const idx = ((-back % tr.n) + tr.n) % tr.n;
  const side = k % 2 ? -1 : 1, p = tr.pts[idx];
  return { x: p.x + tr.nx[idx] * 30 * side, y: p.y + tr.ny[idx] * 30 * side, a: tr.ang[idx], idx, prog: -back };
}

export function createCar(tr, slot, laps) {
  const g = gridSlot(tr, slot);
  return { x: g.x, y: g.y, a: g.a, vx: 0, vy: 0, spin: 0, idx: g.idx, prog: g.prog, lat: 0,
    cross: -1, fl: 0, lapStart: 0, best: 0, last: 0, laps, fin: false, ft: 0, off: false, surf: 0, draft: 0, maxMul: 1, slip: 0,
    wear: 0, dmg: 0, stops: 0, inPit: false, pitSide: false, pitUsed: false, service: 0, drsOn: false, drsZone: -1, hit: 0, ev: [] };
}

export function respawn(c, tr) {
  const p = tr.pts[c.idx];
  c.x = p.x; c.y = p.y; c.a = tr.ang[c.idx]; c.vx = c.vy = 0; c.spin = 0;
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

// DRS: se habilita al entrar a la zona si el de adelante está a < 1 s (desde la vuelta 2)
export function drsCheck(c, tr, gapDist, enabled) {
  const z = tr.drs[c.idx];
  if (z < 0) { c.drsZone = -1; c.drsOn = false; return; }
  if (z !== c.drsZone) {
    c.drsZone = z;
    const sp = Math.max(200, Math.hypot(c.vx, c.vy));
    c.drsOn = !!enabled && c.cross >= 1 && !c.fin && gapDist / sp < 1.0 && !c.inPit;
    if (c.drsOn) c.ev.push('drs');
  }
}

// input: { up, down, steer (-1..1) }   opt: { wear, dmg }
export function stepCar(c, inp, tr, dt, t, opt = {}) {
  const N = tr.n, half = TRACK_W / 2, pit = tr.pit;
  // parada en boxes
  if (c.service > 0) {
    c.vx = c.vy = 0; c.spin = 0; c.service -= dt;
    if (c.service <= 0) { c.service = 0; c.wear = 0; c.dmg = 0; c.stops++; c.pitUsed = true; c.ev.push('pitOut'); }
    return null;
  }
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  let vf = c.vx * fx + c.vy * fy, vl = -c.vx * fy + c.vy * fx;
  const gravel = c.surf === 2, off = c.surf >= 1;
  const health = (1 - 0.07 * c.wear) * (1 - 0.13 * c.dmg);
  const maxS = PHYS.maxSpeed * c.maxMul * health * (gravel ? PHYS.gravelMax : off ? PHYS.grassMax : 1)
    * (1 + c.draft * 0.07) * (c.drsOn ? 1.09 : 1);
  if (c.drsOn && inp.down) c.drsOn = false;
  if (inp.up) vf += PHYS.acc * dt * Math.max(0, 1 - vf / maxS);
  if (inp.down) { if (vf > 5) vf -= PHYS.brake * dt * (1 - 0.15 * c.wear); else vf = Math.max(-150, vf - PHYS.rev * dt); }
  if (!inp.up && !inp.down) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 70 * dt);
  vf -= vf * (gravel ? PHYS.gravelDrag : off ? PHYS.grassDrag : PHYS.drag * (c.drsOn ? 0.5 : 1)) * dt;
  if (vf > maxS) vf -= (vf - maxS) * 2.5 * dt;
  if (c.inPit && vf > PIT_LIMIT) vf = Math.max(PIT_LIMIT, vf - 1500 * dt);
  const sp = Math.abs(vf);
  const rate = PHYS.steer * Math.min(1, sp / 120) * (1 - 0.42 * Math.min(1, sp / PHYS.maxSpeed)) * (off ? 0.8 : 1)
    * (1 - 0.2 * c.wear) * (1 - 0.22 * c.dmg);
  c.a = wrapA(c.a + clamp(inp.steer || 0, -1, 1) * rate * dt * Math.sign(vf) + c.spin * dt);
  c.spin *= Math.exp(-4.5 * dt);
  c.slip = Math.abs(vl);
  const grip = (gravel ? PHYS.gravelGrip : off ? PHYS.grassGrip : PHYS.grip) * (1 - 0.5 * c.wear);
  vl *= Math.exp(-grip * dt);
  c.vx = vf * fx - vl * fy; c.vy = vf * fy + vl * fx;
  c.x += c.vx * dt; c.y += c.vy * dt;
  trackPos(c, tr);
  // superficie y boxes
  const zone = inPitZone(tr, c.idx), sideLat = c.lat * pit.side;
  c.inPit = zone && sideLat > pit.inner - 6;
  if (!zone) c.pitUsed = false;
  const edge = half + KERB - 4;
  c.surf = c.inPit || Math.abs(c.lat) <= edge ? 0 : (tr.gravel[c.idx] === Math.sign(c.lat) ? 2 : 1);
  if (opt.wear) c.wear = Math.min(1, c.wear + dt * opt.wear * (Math.abs(vf) * 7e-6 + c.slip * 1.6e-5 + (off ? Math.abs(vf) * 8e-6 : 0)));
  if (c.inPit && !c.pitUsed && Math.abs(vf) < 25) {
    const r = relIdx(tr, c.idx);
    if (r >= pit.boxFrom && r <= pit.boxTo) {
      c.service = PIT_TIME + (c.dmg > 0.15 ? PIT_DMG_TIME : 0);
      c.ev.push('pitIn'); c.vx = c.vy = 0;
    }
  }
  // muro de boxes (separa la pista del pit lane en el medio de la zona)
  const wr = relIdx(tr, c.idx), wallL = pit.inner - 4, sl = c.lat * pit.side;
  if (wr >= pit.from + 22 && wr <= pit.to - 14) {
    const want = c.pitSide ? wallL + CC_R : wallL - CC_R;
    if (c.pitSide ? sl < want : sl > want) {
      const corr = (want - sl) * pit.side, wx = tr.nx[c.idx], wy = tr.ny[c.idx];
      c.x += wx * corr; c.y += wy * corr; c.lat += corr;
      const vn = (c.vx * wx + c.vy * wy) * Math.sign(corr);
      if (vn < 0) { c.vx -= wx * Math.sign(corr) * vn * 1.3; c.vy -= wy * Math.sign(corr) * vn * 1.3; }
      if (-vn > 90) { c.hit = Math.max(c.hit, -vn); c.ev.push('wall'); if (opt.dmg) c.dmg = Math.min(1, c.dmg - vn / 2200); }
    }
  } else c.pitSide = sl > wallL;
  // muros
  let lim = half + KERB + tr.runoff - CAR_R;
  if (zone && Math.sign(c.lat) === pit.side) lim = Math.max(lim, pit.outer - CAR_R);
  c.hit = Math.max(0, c.hit - dt * 3);
  if (Math.abs(c.lat) > lim) {
    const s = Math.sign(c.lat), wx = tr.nx[c.idx] * s, wy = tr.ny[c.idx] * s, over = Math.abs(c.lat) - lim;
    c.x -= wx * over; c.y -= wy * over;
    const vn = c.vx * wx + c.vy * wy;
    if (vn > 0) {
      c.vx -= wx * vn * 1.35; c.vy -= wy * vn * 1.35;
      if (vn > 70) {
        const loss = clamp(vn / 1100, 0, 0.45);
        c.vx *= 1 - loss; c.vy *= 1 - loss;
        const turn = Math.sign(fx * wy - fy * wx);
        c.spin -= turn * clamp(vn * 0.012, 0, 6);
        if (opt.dmg) c.dmg = Math.min(1, c.dmg + vn / 2200);
        c.hit = Math.max(c.hit, vn); c.ev.push('wall');
      }
    }
    c.lat = lim * s;
  }
  // vueltas
  const cr = Math.floor(c.prog / N);
  let event = null;
  if (cr > c.cross) {
    c.cross = cr;
    if (cr >= 1 && !c.fin) {
      c.last = t - c.lapStart; c.lapStart = t;
      if (!c.best || c.last < c.best) { c.best = c.last; event = 'best'; } else event = 'lap';
      if (cr >= c.laps) { c.fin = true; c.ft = t; c.fl = cr; event = 'fin'; }
    }
  }
  return event;
}

export function currentLap(c) { return clamp(c.cross + 1, 1, c.laps); }

function circles(p) {
  const fx = Math.cos(p.a || 0), fy = Math.sin(p.a || 0);
  return [{ x: p.x + fx * 11, y: p.y + fy * 11, o: 11 }, { x: p.x - fx * 10, y: p.y - fy * 10, o: -10 }];
}

// rebufo y choques contra otros autos (others = [{x,y,a,vx,vy}])
export function interact(c, others, collisions, dmgOn) {
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  let draft = 0;
  for (const o of others) {
    const dx = o.x - c.x, dy = o.y - c.y;
    const fwd = dx * fx + dy * fy, side = Math.abs(-dx * fy + dy * fx);
    if (fwd > 45 && fwd < 260 && side < 26) draft = 1;
    if (!collisions || c.service > 0 || dx * dx + dy * dy > 70 * 70) continue;
    const A = circles(c), B = circles(o);
    let done = false;
    for (const a of A) for (const b of B) {
      if (done) continue;
      const ex = a.x - b.x, ey = a.y - b.y, d = Math.hypot(ex, ey);
      if (d >= CC_R * 2 || d < 0.01) continue;
      done = true;
      const nx = ex / d, ny = ey / d, over = CC_R * 2 - d;
      c.x += nx * over * 0.55; c.y += ny * over * 0.55;
      const rv = (c.vx - (o.vx || 0)) * nx + (c.vy - (o.vy || 0)) * ny;
      if (rv < 0) {
        const jmp = -(1 + 0.6) * rv / 2;
        c.vx += nx * jmp; c.vy += ny * jmp;
        // torque: el golpe fuera del centro hace girar el auto
        const rx = fx * a.o, ry = fy * a.o;
        c.spin += clamp((rx * ny - ry * nx) * jmp * 0.0016, -6, 6);
        c.vx *= 0.97; c.vy *= 0.97;
        const imp = -rv;
        if (imp > 60) { c.hit = Math.max(c.hit, imp); c.ev.push('car'); if (dmgOn) c.dmg = Math.min(1, c.dmg + imp / 2600); }
      }
    }
  }
  c.draft += ((draft ? 1 : 0) - c.draft) * 0.05;
}

// ===== IA =====
export const BOT_LEVELS = { facil: 0.84, normal: 0.92, dificil: 0.985 };

export function botInput(c, tr, bot) {
  const N = tr.n, sp = Math.hypot(c.vx, c.vy), pit = tr.pit;
  const look = Math.round(9 + sp * 0.04);
  const ti = (c.idx + look) % N, tp = tr.pts[ti];
  const r = relIdx(tr, c.idx), rt = relIdx(tr, ti);
  const goPit = bot.pit && !c.pitUsed;
  const pitAhead = (goPit && (c.inPit || (r < pit.from + 10 && rt >= pit.from - 40))) || (c.inPit && r < pit.to - 10);
  let lane = pitAhead ? pit.lat : bot.lane * (1 - Math.min(1, tr.curv[ti] * 250));
  const tx = tp.x + tr.nx[ti] * lane, ty = tp.y + tr.ny[ti] * lane;
  const diff = wrapA(Math.atan2(ty - c.y, tx - c.x) - c.a);
  const steer = clamp(diff * 2.8, -1, 1);
  const aLat = 820 * bot.skill * (1 - 0.45 * c.wear), brk = PHYS.brake * 0.75;
  const ahead = Math.min(N - 1, Math.round((sp * sp / (2 * brk) + 160) / tr.sp));
  let target = PHYS.maxSpeed * bot.skill * c.maxMul;
  for (let k = 0; k <= ahead; k += 2) {
    const i = (c.idx + k) % N, R = 1 / Math.max(1e-5, tr.curv[i]);
    const vc = Math.sqrt(aLat * R), dist = k * tr.sp;
    const allow = Math.sqrt(vc * vc + 2 * brk * dist);
    if (allow < target) target = allow;
  }
  if (goPit) {
    const toZone = ((pit.from - r) % N + N) % N;
    if (!c.inPit && toZone < N / 2) target = Math.min(target, Math.sqrt((PIT_LIMIT * 0.9) ** 2 + 2 * brk * toZone * tr.sp));
    if (c.inPit) {
      target = Math.min(target, PIT_LIMIT * 0.92);
      const d = (pit.boxFrom + 8 - r) * tr.sp;
      if (d > 0) target = Math.min(target, Math.sqrt(2 * brk * 0.5 * d));
      else if (r <= pit.boxTo) target = 0;
    }
  }
  if (c.surf) target = Math.min(target, 260);
  return { up: sp < target - 8, down: sp > target + (target < 30 ? 2 : 25), steer };
}
