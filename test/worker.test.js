// End-to-end tests for the Cloudflare server (src/worker.js + src/game-room.js).
// Starts `wrangler dev` (local mode, no Cloudflare account) on free ports, plays a short
// game over real WebSockets, restarts the dev server mid-game to prove the Durable Object
// restores its saved state, and checks the security rules. Shuts the server down afterwards.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { scoreFor } from '../src/engine.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const HOST_KEY = 'test-key-123';
const YESNO_SECONDS = 4;
const HOST_HTML = '<!doctype html><title>HOST PAGE MARKER</title>';
const PHONE_HTML = '<!doctype html><title>PHONE PAGE MARKER</title>';
const SECRET_KEYS = /"(isBible|source|note|correctAnswer)"\s*:/;

let scratch, assetsDir, persistDir, port, inspectorPort, dev, devLog = '';
const base = () => `http://127.0.0.1:${port}`;
const wsBase = () => `ws://127.0.0.1:${port}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startDev() {
  dev = spawn(
    process.execPath,
    [
      WRANGLER, 'dev',
      '--ip', '127.0.0.1',
      '--port', String(port),
      '--inspector-port', String(inspectorPort),
      '--assets', assetsDir, // throwaway pages, so the test does not depend on public/
      '--persist-to', persistDir,
      '--var', `HOST_KEY:${HOST_KEY}`,
      '--var', `YESNO_SECONDS:${YESNO_SECONDS}`,
      '--show-interactive-dev-session=false',
      '--log-level', 'warn',
    ],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  dev.stdout.on('data', (d) => (devLog += d));
  dev.stderr.on('data', (d) => (devLog += d));
  const exited = new Promise((r) => dev.once('exit', r));
  dev.exitedPromise = exited;
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (dev.exitCode !== null) throw new Error('wrangler dev exited early:\n' + devLog);
    try {
      const r = await fetch(base() + '/healthz');
      if (r.ok && (await r.text()) === 'ok') return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('wrangler dev did not start in time:\n' + devLog);
}

async function stopDev() {
  if (!dev || dev.exitCode !== null) return;
  const proc = dev;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    /* gone */
  }
  const t = setTimeout(() => {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }, 5000);
  await proc.exitedPromise;
  clearTimeout(t);
}

/* --------------------------------------------------------------- WS client */

class Client {
  constructor(name, ws) {
    this.name = name;
    this.ws = ws;
    this.frames = []; // raw text of every frame received
    this.waiters = [];
    this.closed = false;
    this.seq = 0;
    ws.on('message', (data) => {
      this.frames.push(data.toString());
      this.check();
    });
    ws.on('close', (code) => {
      this.closed = true;
      this.closeCode = code;
      this.check();
    });
  }

  static open(path, name) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsBase() + path);
      const c = new Client(name, ws); // listen from the very start so no frame is missed
      ws.once('open', () => resolve(c));
      ws.once('unexpected-response', (req, res) => {
        const err = new Error(`HTTP ${res.statusCode}`);
        err.status = res.statusCode;
        res.resume();
        reject(err);
      });
      ws.once('error', (e) => reject(e));
    });
  }

  get messages() {
    return this.frames.map((f) => JSON.parse(f));
  }

  check() {
    for (const w of this.waiters.slice()) {
      const hit = this.messages.slice(w.from).find(w.pred);
      if (hit || (w.onClose && this.closed)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(hit);
      }
    }
  }

  // wait for a message (received after index `from`) that matches pred
  waitFor(pred, { from = 0, timeout = 5000, onClose = false } = {}) {
    return new Promise((resolve, reject) => {
      const w = { pred, from, resolve, onClose };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`${this.name}: timed out waiting; got ${JSON.stringify(this.messages.slice(from))}`));
      }, timeout);
      this.waiters.push(w);
      this.check();
    });
  }

  waitState(pred, opts) {
    return this.waitFor((m) => m.type === 'state' && pred(m.view), opts).then((m) => m.view);
  }

  lastState() {
    const s = this.messages.filter((m) => m.type === 'state');
    return s.length ? s[s.length - 1].view : null;
  }

  sendRaw(text) {
    this.ws.send(text);
  }

  // send a command and resolve with its ack (matched by the id the server copies back)
  async cmd(msg) {
    const id = `${this.name}-${++this.seq}`;
    const from = this.frames.length;
    this.ws.send(JSON.stringify({ ...msg, id }));
    return this.waitFor((m) => m.type === 'ack' && m.id === id, { from });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ tests */

describe('Cloudflare Worker + GameRoom Durable Object (wrangler dev)', { timeout: 240_000 }, () => {
  const clients = [];
  const track = (c) => (clients.push(c), c);
  let host, alice, bob, aliceToken, bobToken, round1;

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'bible-or-not-test-'));
    assetsDir = join(scratch, 'assets');
    persistDir = join(scratch, 'state');
    mkdirSync(assetsDir);
    writeFileSync(join(assetsDir, 'index.html'), PHONE_HTML);
    writeFileSync(join(assetsDir, 'host.html'), HOST_HTML);
    port = await freePort();
    inspectorPort = await freePort();
    await startDev();
  });

  after(async () => {
    for (const c of clients) c.close();
    await stopDev();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it('serves pages and guards the host page, questions.json and /ws', async () => {
    let r = await fetch(base() + '/');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /PHONE PAGE MARKER/);

    r = await fetch(base() + '/healthz');
    assert.equal(await r.text(), 'ok');

    for (const p of ['/questions.json', '/QUESTIONS.json', '/public/questions.json']) {
      r = await fetch(base() + p);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(await r.text(), /isBible/, p);
    }

    for (const p of ['/host', '/host?key=wrong', '/host?key=', '/host.html', `/host.html?x=${HOST_KEY}`, '/HOST.HTML', '/host/', '/%68ost']) {
      r = await fetch(base() + p, { redirect: 'manual' });
      assert.equal(r.status, 403, p);
      assert.doesNotMatch(await r.text(), /HOST PAGE MARKER/, p);
    }

    r = await fetch(base() + `/host?key=${HOST_KEY}`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /HOST PAGE MARKER/);
    assert.equal(r.headers.get('cache-control'), 'no-store');

    r = await fetch(base() + '/ws?role=player');
    assert.equal(r.status, 426);
  });

  it('GET /qr.svg is an SVG of the join URL and ignores query parameters', async () => {
    const a = await fetch(base() + '/qr.svg');
    assert.equal(a.status, 200);
    assert.match(a.headers.get('content-type'), /image\/svg\+xml/);
    const svg = await a.text();
    assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
    for (const q of ['?url=https://evil.example/', '?text=hello&data=x', '?PUBLIC_URL=https://evil.example/']) {
      const b = await fetch(base() + '/qr.svg' + q);
      assert.equal(await b.text(), svg, q);
    }
  });

  it('rejects a wrong or missing host key with 403 before the upgrade', async () => {
    for (const q of ['?role=host', '?role=host&key=wrong', `?role=host&key=${HOST_KEY}x`]) {
      await assert.rejects(Client.open('/ws' + q, 'bad-host'), (e) => e.status === 403);
    }
    await assert.rejects(Client.open('/ws?role=admin', 'bad-role'), (e) => e.status === 400);
  });

  it('host connects and two players join', async () => {
    host = track(await Client.open(`/ws?role=host&key=${HOST_KEY}`, 'host'));
    const v = await host.waitState((v) => v.role === 'host');
    assert.equal(v.phase, 'lobby');

    alice = track(await Client.open('/ws?role=player', 'alice'));
    bob = track(await Client.open('/ws?role=player', 'bob'));
    assert.equal(alice.frames.length, 0, 'a player socket gets nothing before it joins');

    const a = await alice.cmd({ type: 'join', name: 'Alice' });
    assert.equal(a.ok, true);
    assert.equal(a.for, 'join');
    assert.equal(a.name, 'Alice');
    assert.ok(a.token && a.playerId);
    aliceToken = a.token;
    const b = await bob.cmd({ type: 'join', name: 'Bob' });
    assert.equal(b.ok, true);
    bobToken = b.token;

    await alice.waitState((v) => v.role === 'player' && v.me.name === 'Alice' && v.lobby.players.length === 2);
    const hv = await host.waitState((v) => v.players.length === 2);
    assert.deepEqual(hv.players.map((p) => p.name), ['Alice', 'Bob']);
  });

  it('phones cannot use host commands; bad frames are rejected', async () => {
    for (const type of ['start', 'next', 'endEarly', 'addTime', 'skip', 'kick', 'reset']) {
      const ack = await alice.cmd({ type, playerId: 'x' });
      assert.equal(ack.ok, false, type);
      assert.equal(ack.code, 'unknown_type', type);
    }

    let from = alice.frames.length;
    alice.sendRaw('this is not json');
    let m = await alice.waitFor((m) => m.type === 'error', { from });
    assert.equal(m.code, 'bad_message');

    from = alice.frames.length;
    alice.sendRaw('[1,2,3]');
    m = await alice.waitFor((m) => m.type === 'error', { from });
    assert.equal(m.code, 'bad_message');

    // a frame over 2 KB is rejected, even if it is a valid command
    from = alice.frames.length;
    alice.sendRaw(JSON.stringify({ type: 'rename', name: 'Zed', pad: 'x'.repeat(2100) }));
    m = await alice.waitFor((m) => m.type === 'error' || m.type === 'ack', { from });
    assert.equal(m.type, 'error');
    assert.equal(m.code, 'bad_message');
    // multi-byte characters are counted in bytes: 800 x "é" is 1600 bytes, 700 x "€" is 2100 bytes
    from = alice.frames.length;
    alice.sendRaw(JSON.stringify({ type: 'leavx', pad: '€'.repeat(700) }));
    m = await alice.waitFor((m) => m.type === 'error' || m.type === 'ack', { from });
    assert.equal(m.type, 'error');

    const hv = host.lastState();
    assert.equal(hv.phase, 'lobby');
    assert.deepEqual(hv.players.map((p) => p.name), ['Alice', 'Bob']);
  });

  it('plays a yes/no question: reveal shows the right points; phones never see the answer early', async () => {
    let ack = await host.cmd({ type: 'start' });
    assert.equal(ack.ok, true);
    await host.waitState((v) => v.phase === 'intro');
    ack = await host.cmd({ type: 'next' });
    assert.equal(ack.ok, true);

    const qa = await alice.waitState((v) => v.phase === 'question');
    await bob.waitState((v) => v.phase === 'question');
    assert.equal(qa.round.type, 'yesno');
    assert.equal(qa.timerTotal, YESNO_SECONDS * 1000);

    const a = await alice.cmd({ type: 'answer', answer: true, qid: qa.question.qid });
    assert.equal(a.ok, true);
    assert.equal(a.answer, true);
    const b = await bob.cmd({ type: 'answer', answer: false, qid: qa.question.qid });
    assert.equal(b.ok, true);

    // everyone connected has answered, so the reveal comes at once
    const hv = await host.waitState((v) => v.phase === 'reveal');
    const correct = hv.question.correctAnswer;
    assert.equal(typeof correct, 'boolean');
    const winner = correct ? 'Alice' : 'Bob';
    const loser = correct ? 'Bob' : 'Alice';
    const w = hv.results.find((r) => r.name === winner);
    const l = hv.results.find((r) => r.name === loser);
    assert.equal(w.correct, true);
    assert.equal(w.points, scoreFor(w.ms, YESNO_SECONDS * 1000));
    assert.ok(w.points >= 500 && w.points <= 1000);
    assert.equal(w.score, w.points);
    assert.equal(l.correct, false);
    assert.equal(l.points, 0);
    assert.equal(l.score, 0);

    const pa = await alice.waitState((v) => v.phase === 'reveal');
    const pb = await bob.waitState((v) => v.phase === 'reveal');
    const mine = correct ? pa : pb;
    assert.equal(mine.result.points, w.points);
    assert.equal(mine.me.score, w.points);
    assert.equal(mine.me.rank, 1);
    round1 = { winner, points: w.points };

    // Secrecy: inspect every raw frame the phones received during the question phase.
    let questionFrames = 0;
    for (const c of [alice, bob]) {
      for (const raw of c.frames) {
        const m = JSON.parse(raw);
        if (m.type === 'state' && m.view.phase === 'question') {
          questionFrames++;
          assert.doesNotMatch(raw, SECRET_KEYS, `${c.name} got a secret during the question: ${raw}`);
        }
      }
    }
    assert.ok(questionFrames >= 2, 'phones received question views');
    for (const raw of host.frames) {
      const m = JSON.parse(raw);
      if (m.type === 'state' && m.view.phase === 'question') assert.doesNotMatch(raw, SECRET_KEYS);
    }
  });

  it('survives a restart of the server mid-game with scores intact', async () => {
    for (const c of [host, alice, bob]) c.close();
    await stopDev();
    await startDev(); // same --persist-to folder: the Durable Object storage is kept

    host = track(await Client.open(`/ws?role=host&key=${HOST_KEY}`, 'host2'));
    const hv = await host.waitState(() => true);
    assert.equal(hv.phase, 'reveal');
    const w = hv.players.find((p) => p.name === round1.winner);
    assert.equal(w.score, round1.points);
    assert.ok(hv.players.every((p) => p.connected === false), 'old sockets are gone, so players are offline');

    alice = track(await Client.open('/ws?role=player', 'alice2'));
    bob = track(await Client.open('/ws?role=player', 'bob2'));
    const a = await alice.cmd({ type: 'join', token: aliceToken });
    assert.equal(a.ok, true);
    assert.equal(a.name, 'Alice');
    const b = await bob.cmd({ type: 'join', token: bobToken });
    assert.equal(b.ok, true);
    const pv = await (round1.winner === 'Alice' ? alice : bob).waitState((v) => v.phase === 'reveal');
    assert.equal(pv.me.score, round1.points);
    await host.waitState((v) => v.players.every((p) => p.connected));
  });

  it('the question timer runs on a Durable Object alarm', async () => {
    await host.cmd({ type: 'next' });
    await host.waitState((v) => v.phase === 'leaderboard');
    await host.cmd({ type: 'next' });
    const q = await alice.waitState((v) => v.phase === 'question' && v.round.no === 2);
    const ack = await alice.cmd({ type: 'answer', answer: true, qid: q.question.qid });
    assert.equal(ack.ok, true);
    // Bob does not answer and the host does nothing: only the alarm can end the question.
    const hv = await host.waitState((v) => v.phase === 'reveal' && v.round.no === 2, { timeout: (YESNO_SECONDS + 10) * 1000 });
    assert.ok(Date.now() >= q.deadline - 500, 'ended by the timer, not before the deadline');
    const bobRes = hv.results.find((r) => r.name === 'Bob');
    assert.equal(bobRes.answer, null);
    assert.equal(bobRes.points, 0);
    for (const c of [alice, bob]) {
      for (const raw of c.frames) {
        const m = JSON.parse(raw);
        if (m.type === 'state' && m.view.phase === 'question') assert.doesNotMatch(raw, SECRET_KEYS);
      }
    }
  });

  it('rate-limits a burst of messages on one socket', async () => {
    const spam = track(await Client.open('/ws?role=player', 'spam'));
    for (let i = 0; i < 40; i++) spam.sendRaw(JSON.stringify({ type: 'rename', name: 'x' }));
    const m = await spam.waitFor((m) => m.type === 'error' && m.code === 'rate_limited');
    assert.equal(m.code, 'rate_limited');
    await sleep(300);
    const acks = spam.messages.filter((m) => m.type === 'ack').length;
    const limited = spam.messages.filter((m) => m.code === 'rate_limited').length;
    assert.ok(acks <= 25, `at most about the burst size is handled (got ${acks})`);
    assert.equal(acks + limited, 40);
  });

  it('accepts at most 60 player sockets (503 after that)', async () => {
    // open now: alice, bob, spam
    const extra = [];
    let refused = null;
    for (let i = 0; i < 61 && !refused; i++) {
      try {
        extra.push(track(await Client.open('/ws?role=player', `extra${i}`)));
      } catch (e) {
        refused = e;
      }
    }
    assert.ok(refused, 'one connection was refused');
    assert.equal(refused.status, 503);
    assert.equal(extra.length + 3, 60);
    // host sockets are not limited
    const host3 = track(await Client.open(`/ws?role=host&key=${HOST_KEY}`, 'host3'));
    await host3.waitState(() => true);
    for (const c of extra) c.close();
  });

  it('sends "replaced" and "kicked" notices and closes those sockets', async () => {
    const alice3 = track(await Client.open('/ws?role=player', 'alice3'));
    const from = alice.frames.length;
    const ack = await alice3.cmd({ type: 'join', token: aliceToken });
    assert.equal(ack.ok, true);
    await alice.waitFor((m) => m.type === 'replaced', { from });
    await alice.waitFor(() => false, { onClose: true });
    assert.ok(alice.closed);

    const bobId = host.lastState().players.find((p) => p.name === 'Bob').id;
    const k = await host.cmd({ type: 'kick', playerId: bobId });
    assert.equal(k.ok, true);
    await bob.waitFor((m) => m.type === 'kicked');
    await bob.waitFor(() => false, { onClose: true });
    assert.ok(bob.closed);
    const hv = await host.waitState((v) => !v.players.some((p) => p.name === 'Bob'));
    assert.equal(hv.players.length, 1);
  });
});
