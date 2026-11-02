import { TRACKS, buildTrack, createCar, stepCar, interact, botInput, respawn, currentLap,
  TRACK_W, KERB, RUNOFF, PHYS, POINTS, BOT_LEVELS, gridSlot } from './core.js';
import { HostNet, ClientNet } from './net.js';

// ---------- constantes ----------
const COLORS = ['#e10600', '#ff8700', '#f5d000', '#7cfc00', '#00d2be', '#1e90ff', '#3a2bd8', '#9b59b6', '#ff66c4', '#ffffff', '#8b8b99', '#1b1b1b'];
const BOT_NAMES = ['Turbo Tito', 'La Chancha', 'Ruedita', 'El Rayo', 'Pancho Pistón', 'Doña Rosa', 'Kilómetro', 'Frenazo', 'Cubierta', 'El Mecha'];
const BOT_COLORS = ['#2e8b57', '#b22222', '#4682b4', '#daa520', '#708090', '#c71585', '#20b2aa', '#cd853f', '#6a5acd', '#556b2f'];
const STEP = 1 / 60, MAX_PLAYERS = 12;
const TR = Object.fromEntries(TRACKS.map(d => [d.id, buildTrack(d)]));
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowS = () => performance.now() / 1000;
const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;

// ---------- estado ----------
let me = { name: '', color: COLORS[0] };
try { Object.assign(me, JSON.parse(localStorage.getItem('f1mini-me') || '{}')); } catch (e) {}
let net = null, isHost = false, myId = null, offline = false;
let room = null, race = null, screen = 'menu';
const keys = {};
let muted = false;

// ---------- utilidades UI ----------
function show(id) {
  for (const s of ['menu', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
  screen = id || 'race';
  $('touch').classList.toggle('hidden', !(screen === 'race' && isTouch()));
}
const isTouch = () => matchMedia('(pointer: coarse)').matches;
let toastT = 0;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
function fmt(t) { if (!t) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`; }
function saveMe() { try { localStorage.setItem('f1mini-me', JSON.stringify(me)); } catch (e) {} }

// ---------- menú ----------
$('name').value = me.name;
function renderColors() {
  $('colors').innerHTML = COLORS.map(c => `<span style="background:${c}" data-c="${c}" class="${c === me.color ? 'sel' : ''}"></span>`).join('');
}
renderColors();
$('colors').onclick = e => { const c = e.target.dataset.c; if (c) { me.color = c; saveMe(); renderColors(); } };
const q = new URLSearchParams(location.search);
if (q.get('sala')) $('joinCode').value = q.get('sala').toUpperCase();

function readName() {
  me.name = ($('name').value.trim() || 'Piloto ' + Math.floor(Math.random() * 90 + 10)).slice(0, 14);
  $('name').value = me.name; saveMe();
}
$('btnCreate').onclick = () => { readName(); initAudio(); hostCreate(false); };
$('btnSolo').onclick = () => { readName(); initAudio(); hostCreate(true); };
$('btnJoin').onclick = () => { readName(); initAudio(); clientJoin($('joinCode').value); };
$('joinCode').onkeydown = e => { if (e.key === 'Enter') $('btnJoin').click(); };

function leave() {
  const n = net; net = null; n?.close(); room = null; isHost = false; myId = null;
  startDemo(); show('menu');
}
$('btnLeave').onclick = leave;
$('btnCopy').onclick = async () => {
  if (!room?.code) return;
  const url = location.origin + location.pathname + '?sala=' + room.code;
  try { await navigator.clipboard.writeText(url); toast('Link copiado: mandáselo a tus amigos'); }
  catch (e) { prompt('Copiá este link:', url); }
};

// ---------- HOST ----------
function defaultSettings() { return { tracks: ['cba', 'jujuy', 'veloz'], laps: 3, bots: 3, level: 'normal', col: true, rev: true }; }

function hostCreate(off) {
  isHost = true; offline = off; myId = 'H';
  room = { code: off ? 'LOCAL' : null, phase: 'lobby', players: [{ id: 'H', name: me.name, color: me.color, host: true }], settings: defaultSettings(), champ: null };
  syncBots(); show('lobby'); renderLobby();
  if (off) return;
  $('lobbyMsg').textContent = 'Conectando con el servidor de salas…';
  net = new HostNet({ onData: hostOnData, onLeave: hostOnLeave, onError: e => console.warn(e) });
  net.start().then(code => {
    room.code = code; $('lobbyMsg').textContent = 'Pasales el código o el link a tus amigos.'; renderLobby();
  }).catch(e => {
    console.warn(e); net = null; offline = true; room.code = 'LOCAL';
    $('lobbyMsg').textContent = 'No se pudo crear la sala online (¿sin internet?). Podés correr contra bots igual.'; renderLobby();
  });
}

function syncBots() {
  const humans = room.players.filter(p => !p.bot);
  const n = Math.max(0, Math.min(room.settings.bots, MAX_PLAYERS - humans.length));
  room.players = humans.concat(Array.from({ length: n }, (_, i) => ({ id: 'B' + i, name: BOT_NAMES[i], color: BOT_COLORS[i], bot: true })));
}

function broadcastRoom() {
  net?.broadcast({ t: 'room', room });
  if (screen === 'lobby') renderLobby();
}

function hostOnData(id, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello') {
    if (room.players.some(p => p.id === id)) return;
    if (room.players.filter(p => !p.bot).length >= MAX_PLAYERS) { net.send(id, { t: 'full' }); return; }
    const p = { id, name: String(m.name || 'Piloto').slice(0, 14), color: String(m.color || '#fff').slice(0, 9) };
    const bots = room.players.filter(x => x.bot), humans = room.players.filter(x => !x.bot);
    room.players = humans.concat(p, bots);
    if (room.phase === 'lobby') syncBots();
    if (room.champ && !room.champ.standings[id]) room.champ.standings[id] = { name: p.name, color: p.color, pts: 0, wins: 0 };
    net.send(id, { t: 'welcome', id });
    broadcastRoom(); toast(p.name + ' se unió');
  } else if (m.t === 'st' && race && !race.demo) {
    const rc = race.cars.get(id);
    if (rc && !rc.local && Array.isArray(m.d)) pushSnap(rc, m.d);
  }
}
function hostOnLeave(id) {
  const p = room?.players.find(x => x.id === id);
  if (!p) return;
  room.players = room.players.filter(x => x.id !== id);
  if (room.phase === 'lobby') syncBots();
  if (race && !race.demo) race.cars.delete(id);
  broadcastRoom(); toast(p.name + ' se fue');
}

function readSettings() {
  const s = room.settings;
  s.laps = Math.max(1, Math.min(30, +$('sLaps').value || 3));
  s.bots = Math.max(0, Math.min(10, +$('sBots').value || 0));
  s.level = $('sLevel').value; s.col = $('sCol').checked; s.rev = $('sRev').checked;
  syncBots(); broadcastRoom();
}
for (const id of ['sLaps', 'sBots', 'sLevel', 'sCol', 'sRev']) $(id).onchange = () => isHost && readSettings();

$('btnStart').onclick = () => {
  if (!isHost || !room.settings.tracks.length) return;
  readSettings();
  const st = {};
  for (const p of room.players) st[p.id] = { name: p.name, color: p.color, pts: 0, wins: 0, bot: !!p.bot };
  room.champ = { round: 0, calendar: room.settings.tracks.slice(), standings: st, last: null };
  hostStartRace();
};

function hostStartRace() {
  const ch = room.champ, s = room.settings;
  let grid = room.players.slice();
  if (ch.round === 0) grid.sort(() => Math.random() - 0.5);
  else {
    grid.sort((a, b) => (ch.standings[b.id]?.pts || 0) - (ch.standings[a.id]?.pts || 0));
    if (s.rev) grid.reverse();
  }
  const base = BOT_LEVELS[s.level] || 0.92;
  const m = {
    t: 'start', trackId: ch.calendar[ch.round], laps: s.laps, round: ch.round, total: ch.calendar.length, col: s.col,
    delay: 0.3 + Math.random() * 1.2,
    grid: grid.map(p => ({ id: p.id, name: p.name, color: p.color, bot: !!p.bot, skill: p.bot ? base * (0.955 + Math.random() * 0.05) : 0 })),
  };
  room.phase = 'race';
  net?.broadcast(m); broadcastRoom();
  beginRace(m);
}

function hostTick() {
  if (!isHost || !race || race.demo || room?.phase !== 'race') return;
  const now = nowS();
  if (net) {
    const c = {};
    for (const [id, rc] of race.cars) {
      if (rc.local) c[id] = pack(rc.car);
      else if (rc.snaps.length) c[id] = rc.snaps[rc.snaps.length - 1].d;
    }
    net.broadcast({ t: 'ss', c });
  }
  const cars = [...race.cars.values()], humans = cars.filter(rc => !rc.bot);
  if (!race.firstFin && cars.some(rc => rc.car.fin)) race.firstFin = now;
  if (!race.allFin && humans.every(rc => rc.car.fin)) race.allFin = now;
  if ((race.allFin && now - race.allFin > 6) || (race.firstFin && now - race.firstFin > 60)) hostEndRace();
}

function hostEndRace() {
  const tr = race.tr, laps = race.m.laps, ch = room.champ;
  const list = [...race.cars.values()].map(rc => ({ id: rc.id, name: rc.name, color: rc.color, bot: rc.bot,
    fin: rc.car.fin, ft: rc.car.ft, prog: rc.car.prog, best: rc.car.best }));
  list.sort((a, b) => (b.fin - a.fin) || (a.fin ? a.ft - b.ft : b.prog - a.prog));
  const w = list[0];
  let fl = null;
  for (const r of list) if (r.best && (!fl || r.best < fl.best)) fl = r;
  list.forEach((r, i) => {
    r.pos = i + 1; r.pts = POINTS[i] || 0;
    if (r === fl && r.pos <= 10) { r.pts += 1; r.fl = true; }
    r.gap = r.fin ? (i === 0 ? fmt(r.ft) : '+' + (r.ft - w.ft).toFixed(3)) : `+${Math.max(1, Math.ceil((laps * tr.n - r.prog) / tr.n))} V`;
    const st = ch.standings[r.id] ||= { name: r.name, color: r.color, pts: 0, wins: 0, bot: r.bot };
    st.pts += r.pts; if (r.pos === 1) st.wins++;
  });
  const final = ch.round >= ch.calendar.length - 1;
  ch.last = { trackId: race.m.trackId, round: ch.round, total: ch.calendar.length, list };
  room.phase = final ? 'final' : 'results';
  net?.broadcast({ t: 'results', room });
  showResults();
}

$('btnNext').onclick = () => {
  if (!isHost) return;
  if (room.phase === 'final') return hostToLobby();
  room.champ.round++; hostStartRace();
};
$('btnLobby').onclick = () => isHost && hostToLobby();
function hostToLobby() {
  room.champ = null; room.phase = 'lobby'; syncBots();
  net?.broadcast({ t: 'lobby' }); broadcastRoom();
  startDemo(); show('lobby'); renderLobby();
}

// ---------- CLIENTE ----------
function clientJoin(code) {
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 5) { $('menuMsg').textContent = 'El código tiene 5 caracteres.'; return; }
  $('menuMsg').textContent = 'Conectando…';
  isHost = false;
  net = new ClientNet({ onData: clientOnData, onClose: () => { if (net) { toast('Se cortó la conexión con el host'); leave(); } } });
  net.join(code).then(() => {
    net.send({ t: 'hello', name: me.name, color: me.color });
    $('menuMsg').textContent = '';
  }).catch(e => {
    console.warn(e); net?.close(); net = null;
    $('menuMsg').textContent = e?.type === 'peer-unavailable' ? 'No existe esa sala (o el host cerró).' : 'No se pudo conectar. Revisá el código o tu internet.';
  });
}
function clientOnData(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'welcome': myId = m.id; break;
    case 'full': toast('La sala está llena'); leave(); break;
    case 'room':
      room = m.room;
      if (screen === 'menu') show('lobby');
      if (screen === 'lobby') renderLobby();
      break;
    case 'start': beginRace(m); break;
    case 'ss':
      if (race && !race.demo) for (const id in m.c) {
        const rc = race.cars.get(id);
        if (rc && id !== myId) pushSnap(rc, m.c[id]);
      }
      break;
    case 'results': room = m.room; showResults(); break;
    case 'lobby': startDemo(); show('lobby'); break;
  }
}
setInterval(() => {
  if (!isHost && net && race && !race.demo && race.mine) net.send({ t: 'st', d: pack(race.mine.car) });
  hostTick();
}, 50);

// ---------- lobby ----------
const trackEls = TRACKS.map(def => {
  const lab = document.createElement('label');
  lab.innerHTML = `<input type="checkbox"><canvas width="180" height="96"></canvas><div><span class="num"></span>${esc(def.name)}</div>`;
  drawThumb(lab.querySelector('canvas'), TR[def.id]);
  lab.querySelector('input').onchange = e => {
    if (!isHost) { e.target.checked = !e.target.checked; return; }
    const set = new Set(room.settings.tracks);
    e.target.checked ? set.add(def.id) : set.delete(def.id);
    room.settings.tracks = TRACKS.map(d => d.id).filter(id => set.has(id));
    broadcastRoom();
  };
  $('tracks').appendChild(lab);
  return { def, lab };
});
function drawThumb(c, tr) {
  const g = c.getContext('2d'), b = tr.box, pad = 10;
  const s = Math.min((c.width - pad * 2) / (b.maxx - b.minx), (c.height - pad * 2) / (b.maxy - b.miny));
  const ox = (c.width - (b.maxx - b.minx) * s) / 2, oy = (c.height - (b.maxy - b.miny) * s) / 2;
  g.lineWidth = 5; g.strokeStyle = '#ddd'; g.lineJoin = 'round'; g.beginPath();
  tr.pts.forEach((p, i) => { const x = ox + (p.x - b.minx) * s, y = oy + (p.y - b.miny) * s; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.closePath(); g.stroke();
  const p = tr.pts[0]; g.fillStyle = '#e10600'; g.beginPath(); g.arc(ox + (p.x - b.minx) * s, oy + (p.y - b.miny) * s, 4, 0, 7); g.fill();
}

function renderLobby() {
  if (!room) return;
  $('roomCode').textContent = room.code || '…';
  $('btnCopy').disabled = !room.code || room.code === 'LOCAL';
  const humans = room.players.filter(p => !p.bot).length;
  $('pCount').textContent = `(${humans} + ${room.players.length - humans} bots)`;
  $('players').innerHTML = room.players.map(p => `<li><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}<em>${[p.id === myId && 'vos', p.host && 'host', p.bot && 'bot'].filter(Boolean).join(' · ')}</em></li>`).join('');
  const s = room.settings;
  $('sLaps').value = s.laps; $('sBots').value = s.bots; $('sLevel').value = s.level; $('sCol').checked = s.col; $('sRev').checked = s.rev;
  for (const id of ['sLaps', 'sBots', 'sLevel', 'sCol', 'sRev']) $(id).disabled = !isHost;
  for (const { def, lab } of trackEls) {
    const i = s.tracks.indexOf(def.id);
    lab.classList.toggle('on', i >= 0); lab.querySelector('input').checked = i >= 0;
    lab.querySelector('.num').textContent = i >= 0 ? i + 1 : '';
    lab.querySelector('.num').style.display = i >= 0 ? '' : 'none';
    lab.style.cursor = isHost ? 'pointer' : 'default';
  }
  $('btnStart').classList.toggle('hidden', !isHost);
  $('btnStart').disabled = !s.tracks.length;
  $('waitHost').classList.toggle('hidden', isHost);
  if (!isHost && room.phase !== 'lobby') $('lobbyMsg').textContent = 'Hay una carrera en curso: entrás en la próxima.';
  else if (!isHost) $('lobbyMsg').textContent = '';
}

// ---------- resultados ----------
function showResults() {
  const ch = room.champ, last = ch?.last;
  if (!last) return;
  const final = room.phase === 'final';
  $('resTitle').textContent = final ? '🏆 Fin del campeonato' : `Carrera ${last.round + 1}/${last.total} · ${TR[last.trackId].name}`;
  $('resTable').innerHTML = '<tr><th></th><th>Piloto</th><th class="r">Tiempo</th><th class="r">Mejor</th><th class="r">Pts</th></tr>' +
    last.list.map(r => `<tr class="${r.id === myId ? 'me' : ''}"><td class="pos">${r.pos}</td><td><span class="dot" style="background:${esc(r.color)}"></span> ${esc(r.name)}</td><td class="r">${r.gap}</td><td class="r ${r.fl ? 'purple' : ''}">${fmt(r.best)}</td><td class="r">${r.pts ? '+' + r.pts : ''}</td></tr>`).join('');
  const st = standingsList();
  $('stTable').innerHTML = '<tr><th></th><th>Piloto</th><th class="r">Victorias</th><th class="r">Pts</th></tr>' +
    st.map((s, i) => `<tr class="${s.id === myId ? 'me' : ''}"><td class="pos">${i + 1}</td><td><span class="dot" style="background:${esc(s.color)}"></span> ${esc(s.name)}</td><td class="r">${s.wins}</td><td class="r"><b>${s.pts}</b></td></tr>`).join('');
  $('podium').classList.toggle('hidden', !final);
  if (final) {
    const p = st.slice(0, 3);
    $('podium').innerHTML = [1, 0, 2].filter(i => p[i]).map(i => `<div class="p${i + 1}"><b>${i + 1}°</b><span class="dot" style="background:${esc(p[i].color)}"></span> ${esc(p[i].name)}<br><small>${p[i].pts} pts</small></div>`).join('');
    $('resTitle').textContent = `🏆 ¡${st[0]?.name} campeón!`;
  }
  $('btnNext').textContent = final ? 'Volver al lobby' : 'Siguiente carrera';
  $('btnNext').classList.toggle('hidden', !isHost);
  $('btnLobby').classList.toggle('hidden', !isHost || final);
  $('resWait').classList.toggle('hidden', isHost);
  show('results');
}
function standingsList() {
  return Object.entries(room.champ.standings).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.pts - a.pts || b.wins - a.wins);
}

// ---------- carrera ----------
function beginRace(m) {
  const tr = TR[m.trackId], t = nowS();
  race = { m, tr, demo: !!m.demo, cars: new Map(), mine: null, simT: 0,
    lightsStart: t + 0.8, lightsOut: m.demo ? t - 1 : t + 0.8 + 5 + m.delay,
    skids: [], msg: null, cam: null, firstFin: 0, allFin: 0 };
  m.grid.forEach((p, k) => {
    const car = createCar(tr, k, m.laps);
    const rc = { id: p.id, name: p.name, color: p.color, bot: p.bot, car, local: false, snaps: [], stuck: 0, freeze: 0 };
    if (p.bot && (isHost || race.demo)) {
      rc.local = true; rc.ai = { skill: p.skill, lane: (Math.random() - 0.5) * 50 }; car.maxMul = p.skill;
    }
    if (!race.demo && p.id === myId) { rc.local = true; race.mine = rc; }
    race.cars.set(p.id, rc);
  });
  if (!race.demo) { show(null); setMsg(`${tr.name} · ${m.laps} vueltas`, 4); }
}

function startDemo() {
  const ids = TRACKS.map(d => d.id);
  beginRace({ demo: true, trackId: ids[Math.floor(Math.random() * ids.length)], laps: 9999, delay: 0, col: true,
    grid: BOT_NAMES.slice(0, 6).map((n, i) => ({ id: 'D' + i, name: n, color: COLORS[i * 2], bot: true, skill: 0.9 + i * 0.012 })) });
}

function pack(c) { return [r1(c.x), r1(c.y), r3(c.a), r1(c.vx), r1(c.vy), r1(c.prog), c.fin ? 1 : 0, r3(c.ft), r3(c.best), r3(c.last)]; }
function pushSnap(rc, d) {
  rc.snaps.push({ t: nowS(), d });
  if (rc.snaps.length > 12) rc.snaps.shift();
  const c = rc.car;
  c.prog = d[5]; c.fin = !!d[6]; c.ft = d[7]; c.best = d[8]; c.last = d[9];
  c.cross = Math.floor(c.prog / race.tr.n);
}
// posición para dibujar (interpolada 100 ms atrás)
function remotePose(rc, now) {
  const s = rc.snaps;
  if (!s.length) return rc.car;
  const tt = now - 0.1;
  if (tt >= s[s.length - 1].t) {
    const d = s[s.length - 1].d, dt = Math.min(0.25, tt - s[s.length - 1].t);
    return { x: d[0] + d[3] * dt, y: d[1] + d[4] * dt, a: d[2], vx: d[3], vy: d[4] };
  }
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i - 1].t <= tt) {
      const A = s[i - 1].d, B = s[i].d, f = (tt - s[i - 1].t) / ((s[i].t - s[i - 1].t) || 1);
      let da = B[2] - A[2]; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      return { x: A[0] + (B[0] - A[0]) * f, y: A[1] + (B[1] - A[1]) * f, a: A[2] + da * f, vx: B[3], vy: B[4] };
    }
  }
  const d = s[0].d; return { x: d[0], y: d[1], a: d[2], vx: d[3], vy: d[4] };
}
// posición estimada "ahora" (para choques)
function remoteNow(rc, now) {
  const s = rc.snaps[rc.snaps.length - 1];
  if (!s) return rc.car;
  const d = s.d, dt = Math.min(0.2, now - s.t);
  return { x: d[0] + d[3] * dt, y: d[1] + d[4] * dt, vx: d[3], vy: d[4] };
}

function readInput() {
  return { up: keys.up, down: keys.down, steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0) };
}

function setMsg(text, dur = 2, color = '#fff') { if (race) race.msg = { text, until: nowS() + dur, color }; }

function simStep(now) {
  const R = race, tr = R.tr;
  if (now < R.lightsOut) return;
  R.simT += STEP;
  const cars = [...R.cars.values()];
  const poses = cars.map(rc => rc.local ? rc.car : remoteNow(rc, now));
  cars.forEach((rc, i) => {
    if (!rc.local) return;
    const c = rc.car;
    let inp = rc.ai ? botInput(c, tr, rc.ai) : readInput();
    if (rc.freeze > 0) { rc.freeze -= STEP; inp = { steer: 0 }; }
    const ev = stepCar(c, inp, tr, STEP, R.simT);
    interact(c, poses.filter((_, j) => j !== i), R.m.col);
    if (rc.ai) {
      if (c.fin) c.maxMul = rc.ai.skill * 0.6;
      if (Math.hypot(c.vx, c.vy) < 15) { rc.stuck += STEP; if (rc.stuck > 2.5) { respawn(c, tr); rc.stuck = 0; } } else rc.stuck = 0;
    }
    if (c.slip > 70 || (inp.down && Math.hypot(c.vx, c.vy) > 200 && !c.off)) {
      R.skids.push(c.x - Math.cos(c.a) * 14, c.y - Math.sin(c.a) * 14, c.a);
      if (R.skids.length > 3000) R.skids.splice(0, 3);
    }
    if (rc === R.mine && ev) {
      const pos = order().indexOf(rc) + 1;
      if (ev === 'fin') setMsg(`🏁 BANDERA A CUADROS · P${pos}`, 5, '#ffd84d');
      else if (ev === 'best') setMsg(`Vuelta ${c.cross} · ${fmt(c.last)} · MEJOR PERSONAL`, 2.5, '#c77dff');
      else setMsg(`Vuelta ${c.cross} · ${fmt(c.last)}`, 2.5);
      if (!c.fin && c.cross === c.laps - 1) setTimeout(() => setMsg('¡ÚLTIMA VUELTA!', 2, '#ffd84d'), 2600);
    }
  });
}

function order() {
  return [...race.cars.values()].sort((a, b) => {
    const A = a.car, B = b.car;
    return (B.fin - A.fin) || (A.fin ? A.ft - B.ft : B.prog - A.prog);
  });
}

// ---------- loop ----------
let acc = 0, lastT = nowS();
function tick() {
  const now = nowS();
  const dt = Math.min(now - lastT, 3); lastT = now;
  if (race) {
    acc += dt; let n = 0;
    while (acc >= STEP && n < 200) { simStep(now); acc -= STEP; n++; }
    if (n >= 200) acc = 0;
  }
}
setInterval(tick, 16); // sigue simulando aunque la pestaña esté en segundo plano
function frame() { tick(); render(); updateAudio(); requestAnimationFrame(frame); }

// ---------- render ----------
const pathCache = {};
function trackPath(tr) {
  if (pathCache[tr.id]) return pathCache[tr.id];
  const p = new Path2D();
  tr.pts.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y));
  p.closePath();
  return pathCache[tr.id] = p;
}

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  if (cv.width !== Math.round(W * DPR) || cv.height !== Math.round(H * DPR)) { cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); }
}

function render() {
  resize();
  const R = race;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#3d7a33'; ctx.fillRect(0, 0, W, H);
  if (!R) return;
  const now = nowS(), tr = R.tr;
  const poses = new Map();
  for (const rc of R.cars.values()) poses.set(rc, rc.local ? rc.car : remotePose(rc, now));
  const ord = order();
  const focus = R.mine || ord[0];
  const fp = poses.get(focus);
  const spd = Math.hypot(fp.vx || 0, fp.vy || 0);
  const baseZ = Math.min(W, H) / (R.demo ? 1100 : 820);
  const z = baseZ * (1 - 0.22 * Math.min(1, spd / PHYS.maxSpeed));
  if (!R.cam) R.cam = { x: fp.x, y: fp.y, z };
  const lead = 0.25;
  R.cam.x += (fp.x + (fp.vx || 0) * lead - R.cam.x) * 0.12;
  R.cam.y += (fp.y + (fp.vy || 0) * lead - R.cam.y) * 0.12;
  R.cam.z += (z - R.cam.z) * 0.05;
  const Z = R.cam.z;
  ctx.setTransform(DPR * Z, 0, 0, DPR * Z, DPR * (W / 2 - R.cam.x * Z), DPR * (H / 2 - R.cam.y * Z));
  // pasto a cuadros
  const vx0 = R.cam.x - W / 2 / Z, vy0 = R.cam.y - H / 2 / Z, vx1 = R.cam.x + W / 2 / Z, vy1 = R.cam.y + H / 2 / Z, T = 240;
  ctx.fillStyle = '#386f2f';
  for (let gx = Math.floor(vx0 / T); gx <= Math.floor(vx1 / T); gx++)
    for (let gy = Math.floor(vy0 / T); gy <= Math.floor(vy1 / T); gy++)
      if ((gx + gy) & 1) ctx.fillRect(gx * T, gy * T, T, T);
  // pista
  const P = trackPath(tr);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const outer = TRACK_W + 2 * (KERB + RUNOFF);
  ctx.strokeStyle = '#c9c9cf'; ctx.lineWidth = outer + 12; ctx.stroke(P);
  ctx.strokeStyle = '#d0281f'; ctx.setLineDash([30, 30]); ctx.lineWidth = outer + 12; ctx.stroke(P); ctx.setLineDash([]);
  ctx.strokeStyle = '#4c8c3e'; ctx.lineWidth = outer; ctx.stroke(P);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = TRACK_W + KERB * 2; ctx.stroke(P);
  ctx.strokeStyle = '#d0281f'; ctx.setLineDash([22, 22]); ctx.stroke(P); ctx.setLineDash([]);
  ctx.strokeStyle = '#3b3b44'; ctx.lineWidth = TRACK_W; ctx.stroke(P);
  ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 2; ctx.setLineDash([40, 60]); ctx.stroke(P); ctx.setLineDash([]);
  // línea de largada a cuadros + boxes de grilla
  {
    const p = tr.pts[0], a = tr.ang[0], sq = 10;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
    for (let r = 0; r < 2; r++) for (let k = 0; k < TRACK_W / sq; k++) {
      ctx.fillStyle = (r + k) & 1 ? '#111' : '#fff'; ctx.fillRect(r * sq - sq, -TRACK_W / 2 + k * sq, sq, sq);
    }
    ctx.restore();
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 3;
    for (let k = 0; k < Math.max(R.cars.size, 6); k++) {
      const g = gridSlot(tr, k);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a);
      ctx.beginPath(); ctx.moveTo(26, -14); ctx.lineTo(26, 14); ctx.moveTo(26, -14); ctx.lineTo(16, -14); ctx.moveTo(26, 14); ctx.lineTo(16, 14); ctx.stroke();
      ctx.restore();
    }
  }
  // marcas de frenada
  ctx.fillStyle = 'rgba(20,20,20,.35)';
  const S = R.skids;
  for (let i = 0; i < S.length; i += 3) {
    if (S[i] < vx0 - 50 || S[i] > vx1 + 50 || S[i + 1] < vy0 - 50 || S[i + 1] > vy1 + 50) continue;
    const ca = Math.cos(S[i + 2]), sa = Math.sin(S[i + 2]);
    ctx.fillRect(S[i] - sa * 9 - 2, S[i + 1] + ca * 9 - 2, 4, 4);
    ctx.fillRect(S[i] + sa * 9 - 2, S[i + 1] - ca * 9 - 2, 4, 4);
  }
  // autos
  for (const rc of R.cars.values()) if (rc !== focus) drawCar(poses.get(rc), rc.color);
  drawCar(fp, focus.color);
  ctx.font = `bold ${13 / Z}px system-ui`; ctx.textAlign = 'center';
  for (const rc of R.cars.values()) {
    if (rc === R.mine) continue;
    const p = poses.get(rc);
    ctx.fillStyle = '#000a'; ctx.fillText(rc.name, p.x + 1 / Z, p.y - 30 + 1 / Z);
    ctx.fillStyle = '#fff'; ctx.fillText(rc.name, p.x, p.y - 30);
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!R.demo) drawHUD(R, ord, poses, now);
}

function drawCar(p, color) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(-18, -10, 42, 24);
  ctx.fillStyle = '#121212';
  ctx.fillRect(7, -12, 9, 5); ctx.fillRect(7, 7, 9, 5); ctx.fillRect(-17, -13, 11, 6); ctx.fillRect(-17, 7, 11, 6);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(22, -2); ctx.lineTo(22, 2); ctx.lineTo(5, 4); ctx.lineTo(-3, 7); ctx.lineTo(-14, 6); ctx.lineTo(-14, -6); ctx.lineTo(-3, -7); ctx.lineTo(5, -4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(18, -11, 4, 22); ctx.fillRect(-21, -9, 5, 18);
  ctx.fillStyle = color; ctx.fillRect(18, -11, 4, 3); ctx.fillRect(18, 8, 4, 3); ctx.fillRect(-21, -9, 5, 3); ctx.fillRect(-21, 6, 5, 3);
  ctx.fillStyle = '#0d0d0d'; ctx.beginPath(); ctx.ellipse(-2, 0, 6, 3.6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(-2, 0, 2.6, 0, 7); ctx.fill();
  ctx.restore();
}

function box(x, y, w, h, a = 0.72) { ctx.fillStyle = `rgba(14,14,22,${a})`; ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); }

function drawHUD(R, ord, poses, now) {
  const tr = R.tr, laps = R.m.laps, mine = R.mine, small = W < 700 || H < 500;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  // panel propio
  if (mine) {
    const c = mine.car, pos = ord.indexOf(mine) + 1;
    box(12, 12, 210, 118);
    ctx.fillStyle = '#e10600'; ctx.fillRect(12, 12, 6, 118);
    ctx.fillStyle = '#fff'; ctx.font = 'italic 800 38px system-ui'; ctx.fillText(`P${pos}`, 28, 52);
    const pw = ctx.measureText(`P${pos}`).width;
    ctx.font = '600 14px system-ui'; ctx.fillStyle = '#aaa'; ctx.fillText(`/${ord.length}`, 30 + pw, 52);
    ctx.font = '700 15px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
    ctx.fillText(c.fin ? 'TERMINADO' : `VUELTA ${currentLap(c)}/${laps}`, 212, 50); ctx.textAlign = 'left';
    const lapT = c.fin ? c.ft : Math.max(0, R.simT - c.lapStart);
    ctx.font = '600 14px ui-monospace, monospace';
    ctx.fillStyle = '#ddd'; ctx.fillText(`${c.fin ? 'TOTAL ' : 'ACTUAL'} ${fmt(lapT)}`, 28, 78);
    ctx.fillStyle = '#c77dff'; ctx.fillText(`MEJOR  ${fmt(c.best)}`, 28, 98);
    ctx.fillStyle = '#aaa'; ctx.fillText(`ÚLTIMA ${fmt(c.last)}`, 28, 118);
    // velocidad
    const sp = Math.hypot(c.vx, c.vy) * 0.6;
    const bx = W / 2, by = H - (isTouch() ? 120 : 30);
    ctx.textAlign = 'center';
    ctx.font = 'italic 800 44px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(Math.round(sp), bx, by);
    ctx.font = '600 12px system-ui'; ctx.fillStyle = '#ccc'; ctx.fillText('KM/H', bx, by + 15);
    if (c.draft > 0.5) { ctx.fillStyle = '#4dd2ff'; ctx.font = '800 15px system-ui'; ctx.fillText('REBUFO', bx, by - 48); }
    else if (c.off) { ctx.fillStyle = '#ffb347'; ctx.font = '800 15px system-ui'; ctx.fillText('FUERA DE PISTA', bx, by - 48); }
  }
  // torre de tiempos
  if (!small || !mine) {
    const ty = mine ? 142 : 12, rh = 22, lead = ord[0].car;
    box(12, ty, 210, 26 + ord.length * rh);
    ctx.textAlign = 'left'; ctx.font = '700 11px system-ui'; ctx.fillStyle = '#999';
    ctx.fillText(`VUELTA ${currentLap(lead)}/${laps}`, 22, ty + 17);
    ord.forEach((rc, i) => {
      const y = ty + 26 + i * rh, c = rc.car;
      if (rc === mine) { ctx.fillStyle = '#e1060044'; ctx.fillRect(12, y, 210, rh); }
      ctx.fillStyle = '#fff'; ctx.font = '800 13px system-ui'; ctx.textAlign = 'right'; ctx.fillText(i + 1, 36, y + 16);
      ctx.fillStyle = rc.color; ctx.fillRect(42, y + 4, 4, rh - 8);
      ctx.textAlign = 'left'; ctx.font = '600 13px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(rc.name.slice(0, 12), 52, y + 16);
      ctx.textAlign = 'right'; ctx.font = '600 12px ui-monospace, monospace'; ctx.fillStyle = c.fin ? '#ffd84d' : '#bbb';
      let gap;
      if (i === 0) gap = c.fin ? '🏁' : 'Líder';
      else if (c.fin && lead.fin) gap = '+' + (c.ft - lead.ft).toFixed(1);
      else { const d = lead.prog - c.prog; gap = d >= tr.n ? `+${Math.floor(d / tr.n)} V` : '+' + (d * tr.sp / 430).toFixed(1); }
      ctx.fillText(gap, 214, y + 16);
    });
  }
  // minimapa
  {
    const b = tr.box, mw = small ? 120 : 180, mh = mw * 0.7, pad = 10;
    const mx = W - mw - 12, my = small ? 12 : H - mh - 12;
    box(mx, my, mw, mh);
    const s = Math.min((mw - pad * 2) / (b.maxx - b.minx), (mh - pad * 2) / (b.maxy - b.miny));
    const ox = mx + (mw - (b.maxx - b.minx) * s) / 2, oy = my + (mh - (b.maxy - b.miny) * s) / 2;
    ctx.save(); ctx.translate(ox - b.minx * s, oy - b.miny * s); ctx.scale(s, s);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3 / s; ctx.stroke(trackPath(tr));
    for (const rc of R.cars.values()) {
      const p = poses.get(rc);
      ctx.fillStyle = rc.color; ctx.beginPath(); ctx.arc(p.x, p.y, (rc === mine ? 5 : 3.5) / s, 0, 7); ctx.fill();
      if (rc === mine) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / s; ctx.stroke(); }
    }
    ctx.restore();
  }
  // semáforo
  if (now < R.lightsOut + 1.2) {
    const lit = now < R.lightsStart ? 0 : now >= R.lightsOut ? 0 : Math.min(5, Math.floor(now - R.lightsStart) + 1);
    const cx = W / 2, y = 70, r = small ? 13 : 17, gapX = r * 2.8;
    box(cx - gapX * 2.5 - 8, y - r - 26, gapX * 5 + 16, r * 2 + 40);
    for (let i = 0; i < 5; i++) {
      const x = cx + (i - 2) * gapX;
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y - 6, r, 0, 7); ctx.fill();
      ctx.fillStyle = i < lit ? '#ff1a10' : '#2a0b0a'; ctx.beginPath(); ctx.arc(x, y + r * 0.9, r, 0, 7); ctx.fill();
      if (i < lit) { ctx.fillStyle = '#ff1a1055'; ctx.beginPath(); ctx.arc(x, y + r * 0.9, r * 1.6, 0, 7); ctx.fill(); }
    }
    if (now >= R.lightsOut) { ctx.textAlign = 'center'; ctx.font = 'italic 900 34px system-ui'; ctx.fillStyle = '#3dff6e'; ctx.fillText('¡LARGARON!', cx, y + r * 2 + 50); }
  }
  // mensajes
  if (R.msg && now < R.msg.until) {
    ctx.textAlign = 'center'; ctx.font = `italic 800 ${small ? 20 : 26}px system-ui`;
    const w = ctx.measureText(R.msg.text).width + 40;
    box(W / 2 - w / 2, H * 0.24, w, 46);
    ctx.fillStyle = R.msg.color; ctx.fillText(R.msg.text, W / 2, H * 0.24 + 32);
  }
  if (!mine) {
    ctx.textAlign = 'center'; ctx.font = '700 16px system-ui'; ctx.fillStyle = '#fff';
    ctx.fillText('Mirando la carrera · entrás en la próxima', W / 2, H - 30);
  }
}

// ---------- input ----------
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  if (e.code === 'KeyR' && race?.mine && nowS() > race.lightsOut) { respawn(race.mine.car, race.tr); race.mine.freeze = 1; setMsg('De vuelta a pista', 1.2); }
  if (e.code === 'KeyM') { muted = !muted; toast(muted ? 'Sonido apagado' : 'Sonido prendido'); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); keys[k] = true; b.classList.add('on'); };
  const off = e => { e.preventDefault(); keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
}

// ---------- sonido ----------
let audio = null;
function initAudio() {
  if (audio) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination); o1.start(); o2.start();
    audio = { ac, o1, o2, g };
  } catch (e) {}
}
function updateAudio() {
  if (!audio) return;
  const c = race?.mine?.car, on = c && screen === 'race' && !muted && !document.hidden;
  const sp = c ? Math.hypot(c.vx, c.vy) : 0, t = audio.ac.currentTime;
  const rpm = 50 + (sp % 140) * 0.9 + sp * 0.25 + (keys.up ? 12 : 0);
  audio.o1.frequency.setTargetAtTime(rpm, t, 0.05); audio.o2.frequency.setTargetAtTime(rpm * 0.5, t, 0.05);
  audio.g.gain.setTargetAtTime(on ? 0.035 : 0, t, 0.1);
}

// ---------- arranque ----------
startDemo();
show('menu');
requestAnimationFrame(frame);
window.__f1 = { get race() { return race; }, get room() { return room; }, keys };
