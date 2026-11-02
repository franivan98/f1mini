// ===== Escenografía de las pistas: pianos, grava, boxes, tribunas, árboles, edificios =====
import { TRACK_W, KERB, relIdx } from './core.js';

const HALF = TRACK_W / 2;
export const THEMES = {
  campo:    { g1: '#3f7d35', g2: '#3a7431', run: '#4f8f40', wall: '#cfcfd4', tire: '#d0281f', deco: ['tree', 'tree', 'bush'] },
  quebrada: { g1: '#c79560', g2: '#c08d58', run: '#d4a874', wall: '#b9a58a', tire: '#d0281f', deco: ['cactus', 'cactus', 'rock'], hills: true },
  estadio:  { g1: '#3a7a34', g2: '#357030', run: '#4a8b3d', wall: '#d4d4da', tire: '#1d5fd1', deco: ['tree', 'bush'], stands: 'all' },
  ciudad:   { g1: '#5f5f69', g2: '#5a5a64', run: '#9a9aa3', wall: '#ececf0', tire: '#1d5fd1', deco: ['bld'] },
  sierras:  { g1: '#4c8139', g2: '#467a34', run: '#58904a', wall: '#cfcfd4', tire: '#d0281f', deco: ['tree', 'tree', 'rock', 'bush'] },
};
const CROWD = ['#e10600', '#ffffff', '#ffd84d', '#1e90ff', '#ff8700', '#00d2be', '#ff66c4', '#222', '#7cfc00'];

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const at = (tr, i, lat) => { i = ((Math.round(i) % tr.n) + tr.n) % tr.n; return { x: tr.pts[i].x + tr.nx[i] * lat, y: tr.pts[i].y + tr.ny[i] * lat }; };
function nearest(tr, x, y, skipFrom = null, skipTo = null) {
  let bd = 1e18;
  for (let i = 0; i < tr.n; i += 3) {
    if (skipFrom !== null) { const r = relIdx(tr, i); if (r >= skipFrom && r <= skipTo) continue; }
    const p = tr.pts[i], d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) bd = d;
  }
  return Math.sqrt(bd);
}

// franja a lo largo de la pista entre dos distancias laterales
function strip(tr, i0, i1, side, la, lb) {
  const P = new Path2D();
  for (let i = i0; i <= i1; i++) { const p = at(tr, i, side * la); i === i0 ? P.moveTo(p.x, p.y) : P.lineTo(p.x, p.y); }
  for (let i = i1; i >= i0; i--) { const p = at(tr, i, side * lb); P.lineTo(p.x, p.y); }
  P.closePath();
  return P;
}

export function decorate(tr) {
  const th = THEMES[tr.theme] || THEMES.campo, R = rng(tr.id), N = tr.n, pit = tr.pit;
  const clear = HALF + KERB + Math.max(tr.runoff, 74);
  const d = { th, items: [], stands: [], gravel: [], path: null };
  // camino de la pista
  d.path = new Path2D(); tr.pts.forEach((q, i) => i ? d.path.lineTo(q.x, q.y) : d.path.moveTo(q.x, q.y)); d.path.closePath();
  // grava
  for (let i = 0; i < N;) {
    const s = tr.gravel[i]; if (!s) { i++; continue; }
    let j = i; while (j + 1 < N && tr.gravel[j + 1] === s) j++;
    d.gravel.push(strip(tr, i, j + 1, s, HALF + KERB + 2, HALF + KERB + tr.runoff - 6));
    i = j + 1;
  }
  // boxes
  d.pitLane = strip(tr, pit.from, pit.to, pit.side, pit.inner - 2, pit.outer);
  d.pitWall = strip(tr, pit.from + 22, pit.to - 14, pit.side, pit.inner - 7, pit.inner - 1);
  d.boxes = [];
  for (let r = pit.boxFrom + 3; r <= pit.boxTo - 3; r += 7) d.boxes.push({ ...at(tr, r, pit.lat), a: tr.ang[(r + N) % N] });
  {
    const a0 = pit.boxFrom - 12, a1 = pit.boxTo + 12, lat = pit.side * (pit.outer + 50);
    const segs = [];
    for (let r = a0; r < a1; r += 9) segs.push({ ...at(tr, r + 4.5, lat), a: tr.ang[((r + 4) % N + N) % N], len: 9 * tr.sp, c: CROWD[Math.floor(R() * CROWD.length)] });
    const mid = at(tr, (a0 + a1) / 2, lat);
    if (segs.every(g => nearest(tr, g.x, g.y, a0 - 90, a1 + 90) > pit.outer + 110)) d.garage = segs;
  }
  // tribunas: frente a boxes y (en estadios) en otras rectas
  const standAt = (r0, r1, side) => {
    for (let r = r0; r < r1; r += 14) {
      const lat = side * (HALF + KERB + tr.runoff + 46), c = at(tr, r + 7, lat);
      if (nearest(tr, c.x, c.y, r - 70, r + 84) < HALF + KERB + tr.runoff + 110) continue;
      const dots = [];
      for (let k = 0; k < 40; k++) dots.push([R() * 14 * tr.sp - 7 * tr.sp, (R() - 0.5) * 60, CROWD[Math.floor(R() * CROWD.length)]]);
      d.stands.push({ ...c, a: tr.ang[((r + 7) % N + N) % N], len: 14 * tr.sp - 6, dots });
    }
  };
  standAt(pit.from - 10, pit.to + 20, -pit.side);
  if (th.stands === 'all') for (const z of tr.drsZones) {
    const i = z.a, sgn = ((tr.center.x - tr.pts[i].x) * tr.nx[i] + (tr.center.y - tr.pts[i].y) * tr.ny[i]) > 0 ? -1 : 1;
    const ra = relIdx(tr, z.a), rb = ra + ((z.b - z.a + N) % N);
    if (ra <= pit.to + 20 && rb >= pit.from - 10) continue;
    standAt(ra, rb, sgn);
  }
  // cerros de colores (Quebrada)
  const b = tr.box, W = b.maxx - b.minx + 1600, H = b.maxy - b.miny + 1600;
  if (th.hills) for (let k = 0; k < 9; k++) {
    const x = b.minx - 800 + R() * W, y = b.miny - 800 + R() * H, rx = 260 + R() * 380;
    if (nearest(tr, x, y) < clear + rx + 60) continue;
    d.items.push({ t: 'hill', x, y, rx, ry: rx * (0.5 + R() * 0.3), rot: R() * 3, r: rx });
  }
  // árboles, cactus, piedras, edificios
  const tries = Math.round(W * H / (th.deco[0] === 'bld' ? 52000 : 70000));
  for (let k = 0; k < tries; k++) {
    const t = th.deco[Math.floor(R() * th.deco.length)];
    const x = b.minx - 800 + R() * W, y = b.miny - 800 + R() * H;
    let it;
    if (t === 'tree') it = { t, x, y, r: 20 + R() * 22, c: R() < 0.5 ? '#2a5e24' : '#316b29' };
    else if (t === 'bush') it = { t, x, y, r: 10 + R() * 9, c: '#3a6f2c' };
    else if (t === 'cactus') it = { t, x, y, r: 10 + R() * 8, arms: R() };
    else if (t === 'rock') it = { t, x, y, r: 14 + R() * 26, k: Math.floor(R() * 1000) };
    else if (t === 'bld') {
      const w = 90 + R() * 150, h = 90 + R() * 150;
      it = { t, x: Math.round(x / 40) * 40, y: Math.round(y / 40) * 40, w, h, r: Math.hypot(w, h) / 2,
        c: ['#b8a48c', '#a7b0bb', '#c9b9a6', '#8d99a6', '#b39a9a', '#d6cfc4'][Math.floor(R() * 6)], roof: R() };
    }
    const nd = nearest(tr, it.x, it.y);
    if (nd < clear + it.r + (t === 'bld' ? 30 : 60)) continue;
    if (d.stands.some(s => Math.hypot(s.x - it.x, s.y - it.y) < s.len / 2 + 60 + it.r)) continue;
    if (d.garage && d.garage.some(s => Math.hypot(s.x - it.x, s.y - it.y) < 120 + it.r)) continue;
    if (t === 'bld' && d.items.some(o => o.t === 'bld' && Math.abs(o.x - it.x) < (o.w + it.w) / 2 + 25 && Math.abs(o.y - it.y) < (o.h + it.h) / 2 + 25)) continue;
    d.items.push(it);
  }
  d.items.sort((p, q) => (p.t === 'hill' ? 0 : 1) - (q.t === 'hill' ? 0 : 1));
  return d;
}

export function drawTrack(ctx, tr, d, v, Z) {
  const th = d.th, N = tr.n, pit = tr.pit;
  const vis = (x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
  // suelo
  ctx.fillStyle = th.g1; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  const T = 240; ctx.fillStyle = th.g2;
  for (let gx = Math.floor(v.x0 / T); gx <= Math.floor(v.x1 / T); gx++)
    for (let gy = Math.floor(v.y0 / T); gy <= Math.floor(v.y1 / T); gy++)
      if ((gx + gy) & 1) ctx.fillRect(gx * T, gy * T, T, T);
  for (const it of d.items) if (it.t === 'hill' && vis(it.x, it.y, it.rx)) {
    const bands = ['#a65a4a', '#c97f4a', '#8e6aa3', '#d9b45e', '#6f9a5a', '#b5654f'];
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = bands[(k + Math.floor(it.rx)) % bands.length];
      ctx.beginPath(); ctx.ellipse(it.x, it.y, it.rx * (1 - k * 0.17), it.ry * (1 - k * 0.17), it.rot, 0, 7); ctx.fill();
    }
  }
  // muro + escapatoria
  const outer = TRACK_W + 2 * (KERB + tr.runoff);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = th.wall; ctx.lineWidth = outer + 14; ctx.stroke(d.path);
  ctx.strokeStyle = th.tire; ctx.setLineDash([26, 26]); ctx.lineWidth = outer + 8; ctx.stroke(d.path); ctx.setLineDash([]);
  ctx.strokeStyle = th.wall; ctx.lineWidth = outer + 4; ctx.stroke(d.path);
  ctx.strokeStyle = th.run; ctx.lineWidth = outer; ctx.stroke(d.path);
  // grava
  ctx.fillStyle = '#ddc896'; for (const g of d.gravel) ctx.fill(g);
  ctx.strokeStyle = '#c9b27c'; ctx.lineWidth = 3; for (const g of d.gravel) ctx.stroke(g);
  // pit lane
  ctx.fillStyle = th.wall; ctx.fill(strip(tr, pit.from, pit.to, pit.side, pit.inner, pit.outer + 7));
  ctx.fillStyle = '#44444d'; ctx.fill(d.pitLane);
  // asfalto con líneas blancas al borde
  ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = TRACK_W + 6; ctx.stroke(d.path);
  ctx.strokeStyle = '#3b3b44'; ctx.lineWidth = TRACK_W - 2; ctx.stroke(d.path);
  ctx.strokeStyle = '#ffffff14'; ctx.lineWidth = 34; ctx.stroke(d.path); // línea de goma
  // pianos (solo en curvas)
  for (let i = 0; i < N; i++) {
    if (!tr.kerb[i]) continue;
    const p = tr.pts[i]; if (!vis(p.x, p.y, 120)) continue;
    const j = (i + 1) % N;
    ctx.fillStyle = (i >> 1) & 1 ? '#e8e8e8' : '#d0281f';
    for (const s of [-1, 1]) {
      const a = HALF - 3, b = HALF + KERB + 2;
      ctx.beginPath();
      ctx.moveTo(p.x + tr.nx[i] * a * s, p.y + tr.ny[i] * a * s);
      ctx.lineTo(tr.pts[j].x + tr.nx[j] * a * s, tr.pts[j].y + tr.ny[j] * a * s);
      ctx.lineTo(tr.pts[j].x + tr.nx[j] * b * s, tr.pts[j].y + tr.ny[j] * b * s);
      ctx.lineTo(p.x + tr.nx[i] * b * s, p.y + tr.ny[i] * b * s);
      ctx.fill();
    }
  }
  // muro de boxes + marcas
  ctx.fillStyle = '#e6e6ea'; ctx.fill(d.pitWall);
  ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 3; ctx.setLineDash([18, 14]);
  ctx.beginPath();
  for (let r = pit.from; r <= pit.to; r++) { const p = at(tr, r, pit.side * (pit.outer - 8)); r === pit.from ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 3;
  for (const bx of d.boxes) {
    ctx.save(); ctx.translate(bx.x, bx.y); ctx.rotate(bx.a); ctx.strokeRect(-24, -17, 48, 34); ctx.restore();
  }
  for (const [r, txt] of [[pit.from + 4, 'PIT'], [pit.from + 12, '90'], [pit.to - 6, 'PIT']]) {
    const p = at(tr, r, pit.lat);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(tr.ang[(r + N) % N] + Math.PI / 2);
    ctx.fillStyle = txt === '90' ? '#ffd84d' : '#ffffffcc'; ctx.font = 'bold 30px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, 0, 0); ctx.restore();
  }
  // zonas DRS
  for (const z of tr.drsZones) {
    for (const [i, dash] of [[(z.a - 22 + N) % N, true], [z.a, false]]) {
      const p = tr.pts[i];
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(tr.ang[i]);
      ctx.fillStyle = dash ? '#ffffff88' : '#ffffffcc';
      if (dash) for (let k = -HALF; k < HALF; k += 20) ctx.fillRect(-2, k, 4, 10); else ctx.fillRect(-3, -HALF, 6, TRACK_W);
      if (!dash) { ctx.rotate(Math.PI / 2); ctx.font = 'bold 34px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff55'; ctx.fillText('DRS', 0, -24); }
      ctx.restore();
    }
  }
  // tribunas
  for (const s of d.stands) {
    if (!vis(s.x, s.y, s.len)) continue;
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
    ctx.fillStyle = '#00000040'; ctx.fillRect(-s.len / 2 + 8, -34, s.len, 76);
    ctx.fillStyle = '#9aa0aa'; ctx.fillRect(-s.len / 2, -38, s.len, 76);
    ctx.fillStyle = '#7d838d'; for (let k = -30; k < 38; k += 12) ctx.fillRect(-s.len / 2, k, s.len, 3);
    for (const [x, y, c] of s.dots) { ctx.fillStyle = c; ctx.fillRect(x - 3, y - 3, 6, 6); }
    ctx.fillStyle = '#e10600'; ctx.fillRect(-s.len / 2, -38, s.len, 6);
    ctx.restore();
  }
  // edificio de boxes
  if (d.garage) for (const g of d.garage) {
    if (!vis(g.x, g.y, 150)) continue;
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a);
    ctx.fillStyle = '#00000035'; ctx.fillRect(-g.len / 2 + 6, -26, g.len, 66);
    ctx.fillStyle = '#e4e4ea'; ctx.fillRect(-g.len / 2, -32, g.len + 1, 64);
    ctx.fillStyle = g.c; ctx.fillRect(-g.len / 2 + 4, -32 * Math.sign(1), g.len - 8, 10);
    ctx.fillStyle = '#2b2b33'; ctx.fillRect(-g.len / 2 + 8, -16, g.len - 16, 28);
    ctx.restore();
  }
  // objetos
  for (const it of d.items) {
    if (it.t === 'hill' || !vis(it.x, it.y, (it.r || 0) + (it.w || 0))) continue;
    if (it.t === 'tree') {
      ctx.fillStyle = '#00000030'; ctx.beginPath(); ctx.arc(it.x + 8, it.y + 8, it.r, 0, 7); ctx.fill();
      ctx.fillStyle = it.c; ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffffff14'; ctx.beginPath(); ctx.arc(it.x - it.r * 0.3, it.y - it.r * 0.3, it.r * 0.55, 0, 7); ctx.fill();
    } else if (it.t === 'bush') {
      ctx.fillStyle = it.c; ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, 7); ctx.arc(it.x + it.r * 0.8, it.y + 3, it.r * 0.7, 0, 7); ctx.fill();
    } else if (it.t === 'cactus') {
      ctx.fillStyle = '#00000030'; ctx.beginPath(); ctx.arc(it.x + 5, it.y + 5, it.r, 0, 7); ctx.fill();
      ctx.fillStyle = '#4f7d3a'; ctx.beginPath(); ctx.arc(it.x, it.y, it.r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#4f7d3a'; ctx.lineWidth = it.r * 0.7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(it.x - it.r * 2, it.y - it.r * (0.5 + it.arms)); ctx.lineTo(it.x - it.r * 2, it.y); ctx.lineTo(it.x + it.r * 2, it.y); ctx.lineTo(it.x + it.r * 2, it.y - it.r * (1.5 - it.arms)); ctx.stroke();
      ctx.fillStyle = '#6b9a4f'; ctx.beginPath(); ctx.arc(it.x, it.y, it.r * 0.45, 0, 7); ctx.fill();
    } else if (it.t === 'rock') {
      ctx.fillStyle = '#00000030'; ctx.beginPath(); ctx.ellipse(it.x + 6, it.y + 6, it.r, it.r * 0.8, it.k, 0, 7); ctx.fill();
      ctx.fillStyle = tr.theme === 'quebrada' ? '#8a6a52' : '#8c8c8c'; ctx.beginPath(); ctx.ellipse(it.x, it.y, it.r, it.r * 0.75, it.k, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffffff22'; ctx.beginPath(); ctx.ellipse(it.x - it.r * 0.25, it.y - it.r * 0.2, it.r * 0.5, it.r * 0.35, it.k, 0, 7); ctx.fill();
    } else if (it.t === 'bld') {
      ctx.fillStyle = '#00000045'; ctx.fillRect(it.x - it.w / 2 + 14, it.y - it.h / 2 + 14, it.w, it.h);
      ctx.fillStyle = it.c; ctx.fillRect(it.x - it.w / 2, it.y - it.h / 2, it.w, it.h);
      ctx.fillStyle = '#00000022'; ctx.fillRect(it.x - it.w / 2 + 10, it.y - it.h / 2 + 10, it.w - 20, it.h - 20);
      if (it.roof > 0.5) { ctx.fillStyle = '#6d7680'; ctx.fillRect(it.x - 14, it.y - 10, 28, 20); }
      if (it.roof < 0.25) { ctx.fillStyle = '#3d8a3a'; ctx.fillRect(it.x - it.w / 2 + 14, it.y - it.h / 2 + 14, it.w * 0.35, it.h * 0.35); }
    }
  }
}
