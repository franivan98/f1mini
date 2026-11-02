// ===== Red P2P con PeerJS: el host hace de servidor =====
const PREFIX = 'f1mini-sala-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function peerOptions() {
  const q = new URLSearchParams(location.search), o = { debug: 0 };
  if (q.get('peerhost')) {
    o.host = q.get('peerhost'); o.port = +(q.get('peerport') || 9000);
    o.path = q.get('peerpath') || '/'; o.secure = q.get('peersecure') === '1';
  }
  return o;
}

export function randomCode() {
  let s = ''; for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}

export class HostNet {
  constructor(h) { this.h = h; this.conns = new Map(); this.peer = null; this.code = null; }
  start(tries = 0) {
    return new Promise((res, rej) => {
      this.code = randomCode();
      const peer = new Peer(PREFIX + this.code, peerOptions());
      this.peer = peer;
      let opened = false;
      peer.on('open', () => { opened = true; res(this.code); });
      peer.on('error', e => {
        if (e.type === 'unavailable-id' && tries < 4) { peer.destroy(); this.start(tries + 1).then(res, rej); return; }
        if (!opened) rej(e); else this.h.onError?.(e);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
      peer.on('connection', conn => {
        conn.on('open', () => { this.conns.set(conn.peer, conn); });
        conn.on('data', d => this.h.onData(conn.peer, d));
        const bye = () => { if (this.conns.delete(conn.peer)) this.h.onLeave(conn.peer); };
        conn.on('close', bye); conn.on('error', bye);
      });
    });
  }
  send(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  close() { this.peer?.destroy(); }
}

export class ClientNet {
  constructor(h) { this.h = h; this.peer = null; this.conn = null; }
  join(code) {
    return new Promise((res, rej) => {
      const peer = new Peer(undefined, peerOptions());
      this.peer = peer;
      let ok = false;
      const timer = setTimeout(() => { if (!ok) rej(new Error('timeout')); }, 15000);
      peer.on('open', id => {
        const conn = peer.connect(PREFIX + code.toUpperCase().trim(), { reliable: true });
        this.conn = conn;
        conn.on('open', () => { ok = true; clearTimeout(timer); res(id); });
        conn.on('data', d => this.h.onData(d));
        conn.on('close', () => this.h.onClose());
        conn.on('error', () => this.h.onClose());
      });
      peer.on('error', e => {
        if (!ok) { clearTimeout(timer); rej(e); }
        else if (e.type !== 'peer-unavailable') this.h.onError?.(e);
      });
    });
  }
  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
  close() { this.peer?.destroy(); }
}
