/**
 * GameRoom: the one Durable Object that runs the one game.
 *
 * It is a thin layer around src/engine.js (see docs/protocol.md):
 *   - accepts WebSockets with the Hibernation API (role "host" or "player"),
 *   - gives every player socket a connection id (kept in the socket attachment),
 *   - passes phone messages to engine.playerCommand and host messages to engine.hostCommand,
 *   - replies with an ack, sends every socket its own view after every change,
 *   - saves the engine state to Durable Object storage after every change,
 *   - runs the question timer with a Durable Object alarm.
 */
import { DurableObject } from 'cloudflare:workers';
import { createEngine } from './engine.js';
import questions from '../questions.json';

export const MAX_FRAME_BYTES = 2048; // largest message a client may send
export const MAX_PLAYER_SOCKETS = 60; // open phone sockets (joined or not)
const BURST = 20; // rate limit: burst of 20 messages ...
const REFILL_PER_SEC = 10; // ... refilling 10 per second
const MAX_ID_LEN = 64;

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ helpers */

// Constant-time comparison of two strings: both are hashed first, so neither the
// content nor the length of the secret leaks through timing.
export async function keyMatches(given, secret) {
  if (typeof given !== 'string' || typeof secret !== 'string' || secret === '') return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const hostKeyOf = (env) => (typeof env.HOST_KEY === 'string' ? env.HOST_KEY.trim() : '');

// Optional timer overrides from environment variables (YESNO_SECONDS, CHOOSE_SECONDS).
function envConfig(env) {
  const cfg = {};
  const num = (v) => {
    const n = Number(v);
    return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
  };
  const yes = num(env.YESNO_SECONDS);
  const choose = num(env.CHOOSE_SECONDS);
  if (yes) cfg.yesnoSeconds = yes;
  if (choose) cfg.chooseSeconds = choose;
  return cfg;
}

const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

function makeLimiter() {
  let tokens = BURST;
  let last = Date.now();
  return () => {
    const t = Date.now();
    tokens = Math.min(BURST, tokens + ((t - last) / 1000) * REFILL_PER_SEC);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const OPEN = 1; // WebSocket.OPEN

function send(ws, obj) {
  try {
    if (ws.readyState !== undefined && ws.readyState !== OPEN) return;
    ws.send(JSON.stringify(obj));
  } catch {
    // the socket is closing; the close handler cleans up
  }
}

function attachmentOf(ws) {
  try {
    return ws.deserializeAttachment() || {};
  } catch {
    return {};
  }
}

const errorFrame = (code, error) => ({ type: 'error', code, error });

/* --------------------------------------------------------------- the object */

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.limiters = new WeakMap(); // ws -> limiter (resets after hibernation, which is fine)
    this.lastSent = new Map(); // connId -> last view sent to that phone, minus clock fields (resets after hibernation, which is fine)
    this.armedFor = undefined; // the deadline the alarm is set for (undefined = unknown)
    this.engine = null;

    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('state');
      this.engine = this.makeEngine(saved);
      // Sockets survive hibernation and restarts of the object, but not a restart of the
      // whole runtime (a redeploy). Players whose socket is gone are marked offline.
      const live = new Set(
        ctx
          .getWebSockets('player')
          .map((ws) => attachmentOf(ws).connId)
          .filter(Boolean)
      );
      const before = this.engine.version;
      for (const id of this.engine.connIds()) if (!live.has(id)) this.engine.disconnect(id);
      this.engine.takeNotices();
      if (this.engine.version !== before || saved === undefined) await this.save();
      await this.arm(true);
    });
  }

  makeEngine(saved) {
    const config = envConfig(this.env);
    const base = { questions, config, now: () => Date.now(), random };
    if (saved && typeof saved === 'object') {
      try {
        // The saved state carries its own config; timer settings from the environment win,
        // so changing YESNO_SECONDS / CHOOSE_SECONDS takes effect for the next question.
        const state = { ...saved, config: { ...(saved.config || {}), ...config } };
        return createEngine({ ...base, state });
      } catch (e) {
        console.error('Saved game could not be restored; starting a new one.', e);
      }
    }
    return createEngine(base);
  }

  /* ----------------------------------------------------------- persistence */

  async save() {
    await this.ctx.storage.put('state', this.engine.toJSON());
  }

  async arm(force = false) {
    const d = this.engine.nextDeadline();
    if (!force && d === this.armedFor) return;
    if (d === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(d);
    this.armedFor = d;
  }

  /* ---------------------------------------------------------------- output */

  broadcast() {
    let hostView = null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachmentOf(ws);
      if (att.role === 'host') {
        if (!hostView) hostView = { type: 'state', view: this.engine.hostView() };
        send(ws, hostView);
      } else if (att.role === 'player' && att.connId) {
        const view = this.engine.playerView(att.connId);
        if (!view) continue;
        // Most changes (another player answering, a join) leave a phone's view as it was, apart
        // from the clock fields. Skipping those sends keeps answer bursts fast with 50 phones.
        const key = JSON.stringify({ ...view, serverNow: 0, version: 0 });
        if (this.lastSent.get(att.connId) === key) continue;
        this.lastSent.set(att.connId, key);
        send(ws, { type: 'state', view });
      }
    }
  }

  // Tell and close sockets the engine has kicked or replaced.
  handleNotices() {
    const notices = this.engine.takeNotices();
    if (!notices.length) return;
    const byConn = new Map();
    for (const ws of this.ctx.getWebSockets('player')) {
      const id = attachmentOf(ws).connId;
      if (id) byConn.set(id, ws);
    }
    for (const n of notices) {
      this.lastSent.delete(n.connId);
      const ws = byConn.get(n.connId);
      if (!ws) continue;
      send(ws, { type: n.type });
      // forget the connection id so this socket gets no more views
      try {
        ws.serializeAttachment({ role: 'player', connId: null });
      } catch {
        /* ignore */
      }
      try {
        ws.close(n.type === 'kicked' ? 4001 : 4002, n.type);
      } catch {
        /* already closing */
      }
    }
  }

  // After any engine call: notices, then views + save + alarm if something changed.
  async afterChange(before) {
    this.handleNotices();
    if (this.engine.version === before) return;
    this.broadcast();
    await this.save();
    await this.arm();
  }

  /* ------------------------------------------------------------------ HTTP */

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    const url = new URL(request.url);
    const role = url.searchParams.get('role');

    if (role === 'host') {
      if (!(await keyMatches(url.searchParams.get('key') || '', hostKeyOf(this.env)))) {
        return new Response('Wrong or missing host key.', { status: 403 });
      }
    } else if (role === 'player') {
      if (this.ctx.getWebSockets('player').length >= MAX_PLAYER_SOCKETS) {
        return new Response('The room is full.', { status: 503 });
      }
    } else {
      return new Response('Unknown role.', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, connId: role === 'player' ? crypto.randomUUID() : null });
    if (role === 'host') send(server, { type: 'state', view: this.engine.hostView() });
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ------------------------------------------------------------- WebSocket */

  async webSocketMessage(ws, message) {
    let limiter = this.limiters.get(ws);
    if (!limiter) {
      limiter = makeLimiter();
      this.limiters.set(ws, limiter);
    }
    if (!limiter()) {
      send(ws, errorFrame('rate_limited', 'Slow down a little.'));
      return;
    }
    if (typeof message !== 'string') {
      send(ws, errorFrame('bad_message', 'That message could not be understood.'));
      return;
    }
    if (message.length > MAX_FRAME_BYTES || encoder.encode(message).length > MAX_FRAME_BYTES) {
      send(ws, errorFrame('bad_message', 'That message is too long.'));
      return;
    }
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      msg = undefined;
    }
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
      send(ws, errorFrame('bad_message', 'That message could not be understood.'));
      return;
    }

    const att = attachmentOf(ws);
    const before = this.engine.version;
    let result;
    if (att.role === 'host') {
      result = this.engine.hostCommand(msg);
    } else if (att.role === 'player' && att.connId) {
      // Phones can only ever reach playerCommand: host types get "unknown_type".
      result = this.engine.playerCommand(att.connId, msg);
    } else {
      return; // a kicked / replaced socket that is closing
    }

    const ack = {
      type: 'ack',
      for: typeof msg.type === 'string' ? msg.type.slice(0, 32) : null,
      ...result,
    };
    if ((typeof msg.id === 'string' && msg.id.length <= MAX_ID_LEN) || Number.isFinite(msg.id)) ack.id = msg.id;
    send(ws, ack);
    await this.afterChange(before);
  }

  async webSocketClose(ws, code, reason) {
    await this.dropSocket(ws);
    try {
      ws.close(1000, 'bye');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws) {
    await this.dropSocket(ws);
  }

  async dropSocket(ws) {
    this.limiters.delete(ws);
    const att = attachmentOf(ws);
    if (att.role !== 'player' || !att.connId) return;
    this.lastSent.delete(att.connId);
    try {
      ws.serializeAttachment({ role: 'player', connId: null });
    } catch {
      /* closed */
    }
    const before = this.engine.version;
    this.engine.disconnect(att.connId);
    await this.afterChange(before);
  }

  /* ----------------------------------------------------------------- timer */

  async alarm() {
    this.armedFor = undefined; // the alarm has been used up
    const before = this.engine.version;
    this.engine.tick();
    await this.afterChange(before);
    await this.arm();
  }
}
