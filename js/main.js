import { TRACKS, buildTrack, createCar, stepCar, interact, botInput, respawn, currentLap, drsCheck, relIdx,
  TRACK_W, KERB, PHYS, POINTS, BOT_LEVELS, WEAR, PIT_LIMIT, gridSlot } from './core.js?v=7';
import { decorate, drawTrack } from './scenery.js?v=7';
import { HostNet, ClientNet } from './net.js?v=7';

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
function defaultSettings() { return { tracks: ['cba', 'jujuy', 'veloz'], laps: 5, bots: 3, level: 'normal', col: true, rev: true, wear: 'normal', drs: true, dmg: true, mand: false }; }
const SET_IDS = ['sLaps', 'sBots', 'sLevel', 'sCol', 'sRev', 'sWear', 'sDrs', 'sDmg', 'sMand'];

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
  s.wear = $('sWear').value; s.drs = $('sDrs').checked; s.dmg = $('sDmg').checked; s.mand = $('sMand').checked;
  syncBots(); broadcastRoom();
}
for (const id of SET_IDS) $(id).onchange = () => isHost && readSettings();

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
    wear: WEAR[s.wear] ?? 1, drs: s.drs !== false, dmg: s.dmg !== false, mand: !!s.mand && s.laps >= 2,
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
    net.broadcast({ t: 'ss', c, e: race.endAt ? Math.max(0, race.endAt - now) : -1 });
  }
  // fin de carrera: solo cuentan los humanos que siguen conectados (los bots nunca cortan la carrera)
  const cars = [...race.cars.values()];
  const active = cars.filter(rc => !rc.bot && (rc.local || (rc.snaps.length ? now - rc.snaps[rc.snaps.length - 1].t < 12 : now - race.lightsOut < 20)));
  const done = active.filter(rc => rc.car.fin);
  if (!race.firstHumFin && done.length) race.firstHumFin = now;
  if (active.length && done.length === active.length) { race.allFin ||= now; race.endAt = race.allFin + 5; }
  else { race.allFin = 0; race.endAt = race.firstHumFin ? race.firstHumFin + 90 : 0; }
  // resguardo: con bandera a cuadros, los doblados terminan al cruzar la línea; si alguien quedó colgado, 2 min máximo
  if (!race.firstAnyFin && cars.some(rc => rc.car.fin)) race.firstAnyFin = now;
  if (race.firstAnyFin && (!race.endAt || race.endAt > race.firstAnyFin + 120)) race.endAt = race.firstAnyFin + 120;
  if (race.endAt && now >= race.endAt) hostEndRace();
}

function hostEndRace() {
  const tr = race.tr, laps = race.m.laps, ch = room.champ;
  const list = [...race.cars.values()].map(rc => ({ id: rc.id, name: rc.name, color: rc.color, bot: rc.bot,
    fin: rc.car.fin, ft: rc.car.ft, fl: rc.car.fl, prog: rc.car.prog, best: rc.car.best, stops: rc.car.stops }));
  for (const r of list) if (race.m.mand && r.fin && !r.stops) { r.ft += 20; r.pen = true; }
  list.sort((a, b) => (b.fin - a.fin) || (a.fin ? (b.fl - a.fl) || (a.ft - b.ft) : b.prog - a.prog));
  const w = list[0];
  let fl = null;
  for (const r of list) if (r.best && (!fl || r.best < fl.best)) fl = r;
  list.forEach((r, i) => {
    r.pos = i + 1; r.pts = POINTS[i] || 0;
    if (r === fl && r.pos <= 10) { r.pts += 1; r.fl = true; }
    r.gap = r.fin ? (i === 0 ? fmt(r.ft) : r.fl < w.fl ? `+${w.fl - r.fl} V` : '+' + (r.ft - w.ft).toFixed(3)) : `+${Math.max(1, Math.ceil((laps * tr.n - r.prog) / tr.n))} V`;
    if (r.pen) r.gap += ' (+20s sin parada)';
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
      if (race && !race.demo) race.endAt = m.e >= 0 ? nowS() + m.e : 0;
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
  $('sWear').value = s.wear || 'normal'; $('sDrs').checked = s.drs !== false; $('sDmg').checked = s.dmg !== false; $('sMand').checked = !!s.mand;
  for (const id of SET_IDS) $(id).disabled = !isHost;
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
    skids: [], sparks: [], shake: 0, msg: null, cam: null, endAt: 0, firstHumFin: 0, allFin: 0, checkered: false, warned: {} };
  m.grid.forEach((p, k) => {
    const car = createCar(tr, k, m.laps);
    const rc = { id: p.id, name: p.name, color: p.color, bot: p.bot, car, local: false, snaps: [], stuck: 0, freeze: 0 };
    if (p.bot && (isHost || race.demo)) {
      rc.local = true; rc.ai = { skill: p.skill, lane: (Math.random() - 0.5) * 50, pit: false, wearPit: 0.5 + Math.random() * 0.2 }; car.maxMul = p.skill;
    }
    if (!race.demo && p.id === myId) { rc.local = true; race.mine = rc; }
    race.cars.set(p.id, rc);
  });
  if (!race.demo) {
    show(null);
    const extra = [m.mand && 'parada obligatoria', m.wear > 1.5 && 'desgaste alto'].filter(Boolean).join(' · ');
    setMsg(`${tr.name} · ${m.laps} vueltas${extra ? ' · ' + extra : ''}`, 4);
  }
}

function startDemo() {
  const ids = TRACKS.map(d => d.id);
  beginRace({ demo: true, trackId: ids[Math.floor(Math.random() * ids.length)], laps: 9999, delay: 0, col: true, wear: 0, drs: true, dmg: false,
    grid: BOT_NAMES.slice(0, 6).map((n, i) => ({ id: 'D' + i, name: n, color: COLORS[i * 2], bot: true, skill: 0.9 + i * 0.012 })) });
}

// estado compacto que viaja por la red
function pack(c) {
  return [r1(c.x), r1(c.y), r3(c.a), r1(c.vx), r1(c.vy), r1(c.prog), c.fin ? 1 : 0, r3(c.ft), r3(c.best), r3(c.last),
    c.stops, (c.inPit ? 1 : 0) | (c.drsOn ? 2 : 0) | (c.service > 0 ? 4 : 0), c.fl, Math.round(c.wear * 100), Math.round(c.dmg * 100), Math.round(c.hit)];
}
function pushSnap(rc, d) {
  rc.snaps.push({ t: nowS(), d });
  if (rc.snaps.length > 12) rc.snaps.shift();
  const c = rc.car;
  c.prog = d[5]; c.fin = !!d[6]; c.ft = d[7]; c.best = d[8]; c.last = d[9];
  c.stops = d[10] | 0; c.inPit = !!(d[11] & 1); c.drsOn = !!(d[11] & 2); c.service = d[11] & 4 ? 1 : 0;
  c.fl = d[12] | 0; c.wear = (d[13] | 0) / 100; c.dmg = (d[14] | 0) / 100;
  if ((d[15] | 0) > 120 && (d[15] | 0) > (rc.lastHit || 0) + 40 && race) spark(d[0], d[1], d[15]);
  rc.lastHit = d[15] | 0;
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
  return { x: d[0] + d[3] * dt, y: d[1] + d[4] * dt, a: d[2], vx: d[3], vy: d[4] };
}

const dz = (v, d = 0.12) => Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);
function readInput() {
  let steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), thr = keys.up ? 1 : 0, brk = keys.down ? 1 : 0;
  if (joy.id !== null) steer = joy.v;
  return { up: thr > 0.05, down: brk > 0.05, thr, brk, steer: Math.max(-1, Math.min(1, steer)) };
}

function setMsg(text, dur = 2, color = '#fff') { if (race) race.msg = { text, until: nowS() + dur, color }; }
function spark(x, y, power) {
  if (!race) return;
  const n = Math.min(26, 6 + power / 18);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = 60 + Math.random() * power * 0.8;
    race.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.4, c: Math.random() < 0.5 ? '#ffd84d' : '#ff8a1f' });
  }
  if (race.sparks.length > 400) race.sparks.splice(0, race.sparks.length - 400);
}

function gapAhead(rc, cars, N) {
  let best = 1e9;
  for (const o of cars) {
    if (o === rc) continue;
    const d = (((o.car.prog - rc.car.prog) % N) + N) % N;
    if (d > 0 && d < best) best = d;
  }
  return best * race.tr.sp;
}

function simStep(now) {
  const R = race, tr = R.tr, m = R.m;
  if (now < R.lightsOut) return;
  R.simT += STEP;
  const cars = [...R.cars.values()];
  // foto de todos antes del paso: así los choques entre autos locales (bots) son simétricos
  // (extrapolada un paso, para que los dos autos detecten el choque en el mismo instante)
  const poses = cars.map(rc => rc.local ? { x: rc.car.x + rc.car.vx * STEP, y: rc.car.y + rc.car.vy * STEP, a: rc.car.a, vx: rc.car.vx, vy: rc.car.vy } : remoteNow(rc, now));
  if (!R.checkered && cars.some(rc => rc.car.fin)) R.checkered = true;
  const opt = { wear: m.wear || 0, dmg: !!m.dmg };
  cars.forEach((rc, i) => {
    if (!rc.local) return;
    const c = rc.car;
    if (rc.ai) botStrategy(rc, m);
    let inp = rc.ai ? botInput(c, tr, rc.ai) : readInput();
    if (rc.freeze > 0) { rc.freeze -= STEP; inp = { steer: 0 }; }
    drsCheck(c, tr, gapAhead(rc, cars, tr.n), m.drs && !R.demo);
    const prevCross = c.cross;
    let ev = stepCar(c, inp, tr, STEP, R.simT, opt);
    // bandera a cuadros: el resto termina al cruzar la línea (aunque esté doblado)
    if (R.checkered && !c.fin && c.cross > prevCross && c.cross >= 1) { c.fin = true; c.ft = R.simT; c.fl = c.cross; ev = 'fin'; }
    interact(c, poses.filter((_, j) => j !== i), m.col, opt.dmg);
    if (rc.ai) {
      if (c.fin) c.maxMul = rc.ai.skill * 0.6;
      if (Math.hypot(c.vx, c.vy) < 15 && !c.service) { rc.stuck += STEP; if (rc.stuck > 2.5) { respawn(c, tr); rc.stuck = 0; } } else rc.stuck = 0;
    }
    if (c.slip > 70 || (inp.down && Math.hypot(c.vx, c.vy) > 200 && !c.surf)) {
      R.skids.push(c.x - Math.cos(c.a) * 14, c.y - Math.sin(c.a) * 14, c.a);
      if (R.skids.length > 3000) R.skids.splice(0, 3);
    }
    for (const e of c.ev) {
      if (e === 'wall' || e === 'car') {
        spark(c.x, c.y, c.hit);
        if (rc === R.mine) { R.shake = Math.min(14, Math.max(R.shake, c.hit / 35)); thud(c.hit); }
      }
      if (rc !== R.mine) continue;
      if (e === 'pitIn') setMsg(`🔧 BOXES · ${c.service.toFixed(1)} s${c.dmg > 0.15 ? ' (alerón nuevo)' : ''}`, c.service, '#ffd84d');
      if (e === 'pitOut') setMsg('¡Gomas nuevas! Salí con cuidado', 2, '#3dff6e');
      if (e === 'drs') setMsg('DRS ABIERTO', 1.2, '#3dff6e');
    }
    c.ev.length = 0;
    if (rc === R.mine && !c.fin) {
      if (c.wear > 0.6 && !R.warned.wear) { R.warned.wear = 1; setMsg('Gomas gastadas: entrá a boxes', 3, '#ffb347'); }
      if (c.wear < 0.3) R.warned.wear = 0;
      if (c.dmg > 0.4 && !R.warned.dmg) { R.warned.dmg = 1; setMsg('Auto dañado: arreglalo en boxes', 3, '#ff6b5e'); }
      if (c.dmg < 0.1) R.warned.dmg = 0;
      if (m.mand && !c.stops && c.cross === c.laps - 1 && !R.warned.mand) { R.warned.mand = 1; setMsg('¡Te falta la parada obligatoria! (+20 s)', 3, '#ff6b5e'); }
    }
    if (rc === R.mine && ev) {
      const pos = order().indexOf(rc) + 1;
      if (ev === 'fin') setMsg(`🏁 BANDERA A CUADROS · P${pos}`, 5, '#ffd84d');
      else if (ev === 'best') setMsg(`Vuelta ${c.cross} · ${fmt(c.last)} · MEJOR PERSONAL`, 2.5, '#c77dff');
      else setMsg(`Vuelta ${c.cross} · ${fmt(c.last)}`, 2.5);
      if (!c.fin && c.cross === c.laps - 1) setTimeout(() => setMsg('¡ÚLTIMA VUELTA!', 2, '#ffd84d'), 2600);
    }
  });
  for (const s of R.sparks) { s.x += s.vx * STEP; s.y += s.vy * STEP; s.vx *= 0.94; s.vy *= 0.94; s.life -= STEP; }
  if (R.sparks.length && R.sparks[0].life <= 0) R.sparks = R.sparks.filter(s => s.life > 0);
  R.shake *= 0.9;
}

// estrategia de boxes de los bots
function botStrategy(rc, m) {
  const c = rc.car, ai = rc.ai, left = c.laps - c.cross;
  if (c.fin || c.service > 0) return;
  if (c.pitUsed) { ai.pit = false; return; }
  ai.pit = (m.wear > 0 && c.wear > ai.wearPit && left >= 2)
        || (m.dmg && c.dmg > 0.45 && left >= 2)
        || (m.mand && !c.stops && c.cross >= Math.floor((c.laps - 1) / 2) && left >= 1);
}

function order() {
  return [...race.cars.values()].sort((a, b) => {
    const A = a.car, B = b.car;
    return (B.fin - A.fin) || (A.fin ? (B.fl - A.fl) || (A.ft - B.ft) : B.prog - A.prog);
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
const pathCache = {}, DECO = {};
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
  const shx = R.shake ? (Math.random() - 0.5) * R.shake : 0, shy = R.shake ? (Math.random() - 0.5) * R.shake : 0;
  ctx.setTransform(DPR * Z, 0, 0, DPR * Z, DPR * (W / 2 - R.cam.x * Z + shx), DPR * (H / 2 - R.cam.y * Z + shy));
  const vx0 = R.cam.x - W / 2 / Z, vy0 = R.cam.y - H / 2 / Z, vx1 = R.cam.x + W / 2 / Z, vy1 = R.cam.y + H / 2 / Z;
  const deco = DECO[tr.id] ||= decorate(tr);
  drawTrack(ctx, tr, deco, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 }, Z);
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
  for (const rc of R.cars.values()) if (rc !== focus) drawCar(poses.get(rc), rc.color, rc.car);
  drawCar(fp, focus.color, focus.car);
  for (const sp of R.sparks) { ctx.fillStyle = sp.c; ctx.globalAlpha = Math.min(1, sp.life * 3); ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4); }
  ctx.globalAlpha = 1;
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

function drawCar(p, color, c) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
  if (c && c.service > 0) { ctx.fillStyle = '#ffd84d55'; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(-18, -10, 42, 24);
  ctx.fillStyle = '#121212';
  ctx.fillRect(7, -12, 9, 5); ctx.fillRect(7, 7, 9, 5); ctx.fillRect(-17, -13, 11, 6); ctx.fillRect(-17, 7, 11, 6);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(22, -2); ctx.lineTo(22, 2); ctx.lineTo(5, 4); ctx.lineTo(-3, 7); ctx.lineTo(-14, 6); ctx.lineTo(-14, -6); ctx.lineTo(-3, -7); ctx.lineTo(5, -4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(18, -11, 4, c && c.dmg > 0.4 ? 11 : 22); // alerón roto
  ctx.fillStyle = c && c.drsOn ? '#3dff6e' : '#1a1a1a'; ctx.fillRect(-21, -9, c && c.drsOn ? 3 : 5, 18);
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
    box(12, 12, 210, 152);
    ctx.fillStyle = '#e10600'; ctx.fillRect(12, 12, 6, 152);
    // gomas y daño
    const bar = (y, label, v, col) => {
      ctx.font = '700 11px system-ui'; ctx.fillStyle = '#aaa'; ctx.textAlign = 'left'; ctx.fillText(label, 28, y + 9);
      ctx.fillStyle = '#ffffff22'; ctx.fillRect(84, y, 100, 10);
      ctx.fillStyle = col; ctx.fillRect(84, y, 100 * v, 10);
      ctx.fillStyle = '#ddd'; ctx.textAlign = 'right'; ctx.fillText(Math.round(v * 100) + '%', 214, y + 9); ctx.textAlign = 'left';
    };
    const tl = 1 - c.wear;
    bar(132, 'GOMAS', tl, tl > 0.55 ? '#3dff6e' : tl > 0.3 ? '#ffd84d' : '#ff4d3d');
    bar(148, 'AUTO', 1 - c.dmg, c.dmg < 0.2 ? '#3dff6e' : c.dmg < 0.45 ? '#ffd84d' : '#ff4d3d');
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
    ctx.font = '800 15px system-ui';
    if (c.service > 0) { ctx.fillStyle = '#ffd84d'; ctx.fillText(`🔧 PARADA ${c.service.toFixed(1)} s`, bx, by - 48); }
    else if (c.inPit) { ctx.fillStyle = '#ffd84d'; ctx.fillText(`LIMITADOR ${Math.round(PIT_LIMIT * 0.6)} KM/H`, bx, by - 48); }
    else if (c.surf === 2) { ctx.fillStyle = '#ffb347'; ctx.fillText('GRAVA', bx, by - 48); }
    else if (c.surf === 1) { ctx.fillStyle = '#ffb347'; ctx.fillText('FUERA DE PISTA', bx, by - 48); }
    else if (c.draft > 0.5) { ctx.fillStyle = '#4dd2ff'; ctx.fillText('REBUFO', bx, by - 48); }
    // DRS
    if (R.m.drs && tr.drs[c.idx] >= 0) {
      const on = c.drsOn;
      ctx.fillStyle = on ? '#18c94a' : '#ffffff22'; ctx.beginPath(); ctx.roundRect(bx + 70, by - 34, 54, 26, 5); ctx.fill();
      ctx.fillStyle = on ? '#fff' : '#ffffff66'; ctx.font = 'italic 900 16px system-ui'; ctx.fillText('DRS', bx + 97, by - 15);
    }
    if (c.stops) { ctx.fillStyle = '#aaa'; ctx.font = '600 12px system-ui'; ctx.fillText(`${c.stops} parada${c.stops > 1 ? 's' : ''}`, bx - 97, by - 15); }
  }
  // torre de tiempos
  if (!small || !mine) {
    const ty = mine ? 176 : 12, rh = 22, lead = ord[0].car;
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
      if (c.inPit || c.service) { ctx.fillStyle = '#ffd84d'; ctx.font = '800 10px system-ui'; ctx.fillText('BOX', 166, y + 15); }
      else if (c.drsOn) { ctx.fillStyle = '#3dff6e'; ctx.font = '800 10px system-ui'; ctx.fillText('DRS', 166, y + 15); }
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
  if (R.endAt && !(mine && mine.car.fin)) {
    const left = Math.max(0, Math.ceil(R.endAt - now));
    ctx.textAlign = 'center'; ctx.font = '800 15px system-ui';
    const txt = `🏁 La carrera termina en ${left} s`, w = ctx.measureText(txt).width + 30;
    box(W / 2 - w / 2, 10, w, 30); ctx.fillStyle = '#ffd84d'; ctx.fillText(txt, W / 2, 31);
  }
  // mensajes
  if (R.msg && now < R.msg.until) {
    ctx.textAlign = 'center'; ctx.font = `italic 800 ${small ? 20 : 26}px system-ui`;
    const w = ctx.measureText(R.msg.text).width + 40;
    box(W / 2 - w / 2, H * 0.24, w, 46);
    ctx.fillStyle = R.msg.color; ctx.fillText(R.msg.text, W / 2, H * 0.24 + 32);
  }
  if (mine && touchMode === 'joystick' && isTouch()) {
    const bx = joy.id !== null ? joy.ox : W * 0.16, by = joy.id !== null ? joy.oy : H - 100;
    ctx.globalAlpha = joy.id !== null ? 0.9 : 0.45;
    ctx.strokeStyle = '#ffffff99'; ctx.lineWidth = 3; ctx.fillStyle = '#ffffff1a';
    ctx.beginPath(); ctx.arc(bx, by, JOY_R, 0, 7); ctx.fill(); ctx.stroke();
    const kx = bx + (joy.id !== null ? Math.max(-JOY_R, Math.min(JOY_R, joy.x - joy.ox)) : 0);
    const ky = by + (joy.id !== null ? Math.max(-JOY_R, Math.min(JOY_R, joy.y - joy.oy)) * 0.3 : 0);
    ctx.fillStyle = joy.v ? '#e10600cc' : '#ffffff88'; ctx.beginPath(); ctx.arc(kx, ky, 26, 0, 7); ctx.fill();
    if (joy.id === null) { ctx.fillStyle = '#fff'; ctx.font = '600 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('◀ apoyá el dedo ▶', bx, by + JOY_R + 18); }
    ctx.globalAlpha = 1;
  }
  if (!mine) {
    ctx.textAlign = 'center'; ctx.font = '700 16px system-ui'; ctx.fillStyle = '#fff';
    ctx.fillText('Mirando la carrera · entrás en la próxima', W / 2, H - 30);
  }
}

// ---------- input ----------
function resetCar() {
  if (race?.mine && !race.demo && nowS() > race.lightsOut && !race.mine.car.service) { respawn(race.mine.car, race.tr); race.mine.freeze = 1; setMsg('De vuelta a pista', 1.2); }
}
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyM') { muted = !muted; toast(muted ? 'Sonido apagado' : 'Sonido prendido'); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// táctil multitoque: en cada evento se miran TODOS los dedos apoyados y qué botón tiene cada uno abajo
// (así se puede acelerar y doblar a la vez, y deslizar el dedo de un botón a otro)
const tBtns = [...document.querySelectorAll('#touch button')];
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, v: 0 }, JOY_R = 60;
let touchMode = 'botones';
try { touchMode = localStorage.getItem('f1mini-touch') || 'botones'; } catch (e) {}
function applyTouchMode() {
  $('touch').classList.toggle('joymode', touchMode === 'joystick');
  for (const b of document.querySelectorAll('#touchMode button')) b.classList.toggle('sel', b.dataset.m === touchMode);
}
for (const b of document.querySelectorAll('#touchMode button')) {
  const pick = e => { e.preventDefault(); touchMode = b.dataset.m; try { localStorage.setItem('f1mini-touch', touchMode); } catch (err) {} applyTouchMode(); toast(touchMode === 'joystick' ? 'Controles: joystick' : 'Controles: botones'); };
  b.addEventListener('click', pick);
}
applyTouchMode();
function updateTouches(e) {
  if (screen !== 'race') return;
  e.preventDefault();
  const on = new Set(), list = [...e.touches];
  if (touchMode === 'joystick') {
    // el primer dedo que toca la mitad izquierda es el stick (aparece donde apoyás)
    if (joy.id !== null && !list.some(t => t.identifier === joy.id)) { joy.id = null; joy.v = 0; }
    if (joy.id === null && e.type === 'touchstart') {
      const t = [...e.changedTouches].find(t => t.clientX < innerWidth * 0.5);
      if (t) { joy.id = t.identifier; joy.ox = joy.x = t.clientX; joy.oy = joy.y = t.clientY; }
    }
    const jt = list.find(t => t.identifier === joy.id);
    if (jt) {
      let dx = jt.clientX - joy.ox, dy = jt.clientY - joy.oy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { joy.ox += dx * (1 - JOY_R / d); joy.oy += dy * (1 - JOY_R / d); dx = jt.clientX - joy.ox; dy = jt.clientY - joy.oy; } // la base sigue al dedo
      joy.x = jt.clientX; joy.y = jt.clientY;
      joy.v = dz(dx / JOY_R, 0.08);
    }
  }
  for (const t of list) {
    if (t.identifier === joy.id) continue;
    for (const b of tBtns) {
      if (touchMode === 'joystick' && (b.dataset.k === 'left' || b.dataset.k === 'right')) continue;
      const r = b.getBoundingClientRect(), pad = 18;
      if (t.clientX >= r.left - pad && t.clientX <= r.right + pad && t.clientY >= r.top - pad && t.clientY <= r.bottom + pad) on.add(b.dataset.k);
    }
  }
  for (const b of tBtns) { const k = b.dataset.k, v = on.has(k); keys[k] = v; b.classList.toggle('on', v); }
}
for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) addEventListener(ev, updateTouches, { passive: false });
addEventListener('gesturestart', e => { if (screen === 'race') e.preventDefault(); }, { passive: false }); // iOS: evita zoom con 2 dedos

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
let noiseBuf = null;
function thud(power) {
  if (!audio || muted) return;
  const ac = audio.ac;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = 700 + power * 2; g.gain.value = Math.min(0.5, power / 900);
  src.connect(f); f.connect(g); g.connect(ac.destination); src.start();
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
window.__f1 = { get race() { return race; }, get room() { return room; }, keys, toLobby: () => hostToLobby() };
