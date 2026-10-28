import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine, DEFAULT_CONFIG, ERROR_CODES, errorMessage, cleanText, nameKey, scoreFor } from '../src/engine.js';

/* ---------------------------------------------------------------- fixtures */

const YESNO = Array.from({ length: 8 }, (_, i) => ({
  type: 'yesno',
  quote: `Yes/no quote ${i + 1}`,
  isBible: i % 2 === 0,
  source: `YN-SOURCE-${i + 1}`,
  note: `YN-NOTE-${i + 1}`,
}));
const CHOOSE = Array.from({ length: 10 }, (_, i) => ({
  type: 'choose',
  options: [0, 1, 2, 3].map((j) => ({
    quote: `Choice ${i + 1} option ${j + 1}`,
    isBible: j === i % 4,
    source: `CH-SOURCE-${i + 1}-${j + 1}`,
  })),
  note: `CH-NOTE-${i + 1}`,
}));
const BANK = { translation: 'KJV', yesno: YESNO, choose: CHOOSE };
const ALL_SECRET_STRINGS = [
  ...YESNO.flatMap((q) => [q.source, q.note]),
  ...CHOOSE.flatMap((q) => [q.note, ...q.options.map((o) => o.source)]),
];

function seeded(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup({ config, questions = BANK, seed = 42 } = {}) {
  const clock = { t: 1_000_000 };
  const now = () => clock.t;
  const random = seeded(seed);
  const engine = createEngine({ questions, config, now, random });
  return { engine, clock, now, random };
}

function join(engine, connId, name) {
  const res = engine.playerCommand(connId, { type: 'join', name });
  assert.equal(res.ok, true, `join ${name}: ${res.error}`);
  return res;
}

const host = (engine, type, extra = {}) => engine.hostCommand({ type, ...extra });
const okHost = (engine, type, extra) => {
  const res = host(engine, type, extra);
  assert.equal(res.ok, true, `${type}: ${res.error}`);
  return res;
};
const answer = (engine, connId, a) => engine.playerCommand(connId, { type: 'answer', answer: a });
const phase = (engine) => engine.hostView().phase;

// the correct answer as shown to players (read from the saved state, never from a view)
function correctShown(engine) {
  const r = engine.toJSON().game.round;
  return r.type === 'yesno' ? r.item.isBible : r.order.findIndex((i) => r.item.options[i].isBible);
}
const wrongShown = (engine) => {
  const c = correctShown(engine);
  return typeof c === 'boolean' ? !c : (c + 1) % 4;
};

// lobby -> intro -> question 1
function startGame(engine) {
  okHost(engine, 'start');
  okHost(engine, 'next');
  assert.equal(phase(engine), 'question');
}

// from reveal of round n to question of round n+1 (through leaderboard and, if needed, section)
function toNextQuestion(engine) {
  okHost(engine, 'next'); // leaderboard
  okHost(engine, 'next'); // section or question
  if (phase(engine) === 'section') okHost(engine, 'next');
  assert.equal(phase(engine), 'question');
}

/* ------------------------------------------------------------------ module */

test('module is dependency-free and touches no global clock, randomness, timers or network', () => {
  const src = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
  assert.equal(/\bimport\b/.test(src.replace(/import\.meta/g, '')), false);
  for (const bad of ['Date.now', 'Math.random', 'crypto', 'setTimeout', 'setInterval', 'fetch(', 'window', 'globalThis', 'require(']) {
    assert.equal(src.includes(bad), false, `engine source mentions ${bad}`);
  }
  assert.equal(typeof createEngine, 'function');
});

test('createEngine requires injected now() and random()', () => {
  assert.throws(() => createEngine({ questions: BANK, random: () => 0 }));
  assert.throws(() => createEngine({ questions: BANK, now: () => 0 }));
});

test('helpers: cleanText, nameKey, scoreFor, error messages', () => {
  assert.equal(cleanText('  a\u0000b\n\n c‮ '), 'a b c');
  assert.equal(nameKey('ＡＢ'), nameKey('ab'));
  assert.equal(scoreFor(0, 15000), 1000);
  assert.equal(scoreFor(15000, 15000), 500);
  assert.equal(scoreFor(99999, 15000), 500);
  assert.equal(scoreFor(-50, 15000), 1000);
  for (const code of ERROR_CODES) assert.notEqual(errorMessage(code), 'Something went wrong.', code);
});

/* ----------------------------------------------------------------- joining */

test('join: names are cleaned and limited to 15 code points', () => {
  const { engine } = setup();
  const r = join(engine, 'c1', '  Alice \n ');
  assert.equal(r.name, 'Alice');
  assert.match(r.token, /^[A-Za-z0-9]{32}$/);
  assert.ok(r.playerId);
  assert.equal(engine.playerCommand('c2', { type: 'join', name: '   ' }).code, 'name_empty');
  assert.equal(engine.playerCommand('c2', { type: 'join' }).code, 'name_empty');
  assert.equal(engine.playerCommand('c2', { type: 'join', name: 42 }).code, 'name_empty');
  assert.equal(engine.playerCommand('c2', { type: 'join', name: 'x'.repeat(16) }).code, 'name_too_long');
  assert.equal(engine.playerCommand('c2', { type: 'join', name: 'x'.repeat(5000) }).code, 'name_too_long');
  assert.ok(engine.playerCommand('c2', { type: 'join', name: '😀'.repeat(15) }).ok);
  assert.equal(engine.playerCommand('c3', { type: 'join', name: '😀'.repeat(16) }).code, 'name_too_long');
});

test('join: duplicate names are rejected ignoring case and look-alike forms', () => {
  const { engine } = setup();
  join(engine, 'c1', 'ab');
  for (const n of ['AB', 'Ab', 'ＡＢ', 'ａｂ']) {
    const r = engine.playerCommand('c2', { type: 'join', name: n });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'name_taken');
  }
});

test('rejoin by token keeps the player and score; the old socket is reported as replaced', () => {
  const { engine } = setup({ config: { yesnoRounds: 1, chooseRounds: 1 } });
  const a = join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  startGame(engine);
  answer(engine, 'a1', correctShown(engine));
  okHost(engine, 'endEarly');
  const score = engine.playerView('a1').me.score;
  assert.ok(score > 0);
  engine.takeNotices();
  const again = engine.playerCommand('a2', { type: 'join', token: a.token });
  assert.equal(again.ok, true);
  assert.equal(again.playerId, a.playerId);
  assert.equal(again.name, 'Alice');
  assert.equal(engine.playerView('a2').me.score, score);
  assert.equal(engine.playerView('a1'), null);
  assert.deepEqual(engine.takeNotices(), [{ connId: 'a1', type: 'replaced' }]);
  assert.equal(engine.hostView().players.length, 2);
});

test('unknown token: unknown_token without a name, a fresh join with a name', () => {
  const { engine } = setup();
  const r = engine.playerCommand('c1', { type: 'join', token: 'nope' });
  assert.equal(r.code, 'unknown_token');
  assert.equal(engine.playerCommand('c1', { type: 'join', token: 123 }).code, 'unknown_token');
  const r2 = engine.playerCommand('c1', { type: 'join', token: 'nope', name: 'Zed' });
  assert.equal(r2.ok, true);
  assert.equal(r2.name, 'Zed');
});

test('same name as an offline player takes them over (keeps score); online player blocks it', () => {
  const { engine } = setup({ config: { yesnoRounds: 1, chooseRounds: 1 } });
  const a = join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  startGame(engine);
  answer(engine, 'a1', correctShown(engine));
  okHost(engine, 'endEarly');
  const score = engine.playerView('a1').me.score;
  assert.equal(engine.playerCommand('x', { type: 'join', name: 'alice' }).code, 'name_taken');
  engine.disconnect('a1');
  const back = engine.playerCommand('a2', { type: 'join', name: 'ALICE' });
  assert.equal(back.ok, true);
  assert.equal(back.token, a.token);
  assert.equal(back.playerId, a.playerId);
  assert.equal(engine.playerView('a2').me.score, score);
  assert.equal(engine.hostView().players.length, 2);
});

test('max 50 players, then room_full', () => {
  const { engine } = setup();
  for (let i = 0; i < 50; i++) join(engine, `c${i}`, `P${i}`);
  const r = engine.playerCommand('c50', { type: 'join', name: 'Late' });
  assert.equal(r.code, 'room_full');
  assert.equal(engine.hostView().players.length, 50);
});

test('joining is closed at the podium for new names, but token rejoin still works', () => {
  const { engine } = setup({ config: { yesnoRounds: 1, chooseRounds: 0 } });
  const a = join(engine, 'a1', 'Alice');
  startGame(engine);
  okHost(engine, 'endEarly');
  okHost(engine, 'next'); // leaderboard
  okHost(engine, 'next'); // podium
  assert.equal(phase(engine), 'podium');
  assert.equal(engine.playerCommand('n1', { type: 'join', name: 'New' }).code, 'game_over');
  engine.disconnect('a1');
  assert.equal(engine.playerCommand('a2', { type: 'join', token: a.token }).ok, true);
});

test('rename only in the lobby, and not to a taken name', () => {
  const { engine } = setup();
  join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  assert.equal(engine.playerCommand('a1', { type: 'rename', name: ' Ally ' }).name, 'Ally');
  assert.equal(engine.playerCommand('a1', { type: 'rename', name: 'BOB' }).code, 'name_taken');
  assert.equal(engine.playerCommand('zz', { type: 'rename', name: 'X' }).code, 'not_joined');
  okHost(engine, 'start');
  assert.equal(engine.playerCommand('a1', { type: 'rename', name: 'Al' }).code, 'names_locked');
});

test('leave: removes the player in the lobby, marks them offline later', () => {
  const { engine } = setup();
  const a = join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  assert.equal(engine.playerCommand('a1', { type: 'leave' }).ok, true);
  assert.deepEqual(engine.hostView().players.map((p) => p.name), ['Bob']);
  assert.equal(engine.playerCommand('a1', { type: 'join', token: a.token }).code, 'unknown_token');
  join(engine, 'c1', 'Cat');
  okHost(engine, 'start');
  engine.playerCommand('c1', { type: 'leave' });
  const cat = engine.hostView().players.find((p) => p.name === 'Cat');
  assert.equal(cat.connected, false);
  assert.equal(engine.playerView('c1'), null);
});

test('malformed and unknown messages are rejected', () => {
  const { engine } = setup();
  for (const bad of [null, 5, 'join', [], {}, { type: 7 }, { type: '' }, { type: 'x'.repeat(100) }]) {
    assert.equal(engine.playerCommand('c1', bad).code, 'bad_message');
    assert.equal(engine.hostCommand(bad).code, 'bad_message');
  }
  assert.equal(engine.playerCommand('', { type: 'join', name: 'A' }).code, 'bad_message');
  assert.equal(engine.playerCommand(null, { type: 'join', name: 'A' }).code, 'bad_message');
  assert.equal(engine.playerCommand('c1', { type: 'start' }).code, 'unknown_type');
  assert.equal(engine.hostCommand({ type: 'answer' }).code, 'unknown_type');
  assert.equal(engine.hostCommand({ type: 'kick', playerId: { x: 1 } }).code, 'bad_message');
  assert.equal(engine.hostCommand({ type: 'kick', playerId: 'nobody' }).code, 'unknown_player');
  const r = engine.hostCommand({ type: 'bogus' });
  assert.equal(typeof r.error, 'string');
});

test('version increases on every change and not on rejected commands', () => {
  const { engine } = setup();
  const v0 = engine.version;
  join(engine, 'a1', 'Alice');
  const v1 = engine.version;
  assert.ok(v1 > v0);
  engine.playerCommand('b1', { type: 'join', name: 'alice' });
  host(engine, 'next');
  assert.equal(engine.version, v1);
  engine.hostView();
  engine.playerView('a1');
  engine.tick();
  assert.equal(engine.version, v1);
  okHost(engine, 'start');
  assert.ok(engine.version > v1);
});

/* ------------------------------------------------------------------ phases */

test('start needs lobby, a player and questions', () => {
  const { engine } = setup();
  assert.equal(host(engine, 'start').code, 'no_players');
  const empty = setup({ questions: { yesno: [], choose: [] } }).engine;
  join(empty, 'a1', 'A');
  assert.equal(host(empty, 'start').code, 'no_questions');
  join(engine, 'a1', 'A');
  okHost(engine, 'start');
  assert.equal(phase(engine), 'intro');
  assert.equal(host(engine, 'start').code, 'wrong_phase');
});

test('full flow: 6 yes/no rounds, section slide, 9 choose rounds, leaderboards, podium', () => {
  const { engine } = setup();
  join(engine, 'a1', 'Alice');
  okHost(engine, 'start');
  const intro = engine.hostView();
  assert.equal(intro.phase, 'intro');
  assert.deepEqual(intro.intro, { yesnoRounds: 6, chooseRounds: 9, yesnoSeconds: 15, chooseSeconds: 25, doubleFromRound: 13 });
  okHost(engine, 'next');
  const seen = [];
  for (let no = 1; no <= 15; no++) {
    const v = engine.hostView();
    assert.equal(v.phase, 'question');
    assert.equal(v.round.no, no);
    assert.equal(v.round.of, 15);
    assert.equal(v.round.type, no <= 6 ? 'yesno' : 'choose');
    assert.equal(v.round.multiplier, no >= 13 ? 2 : 1);
    assert.equal(v.timerTotal, no <= 6 ? 15000 : 25000);
    assert.equal(host(engine, 'next').code, 'wrong_phase'); // cannot "next" past a running question
    okHost(engine, 'endEarly');
    assert.equal(phase(engine), 'reveal');
    okHost(engine, 'next');
    assert.equal(phase(engine), 'leaderboard');
    okHost(engine, 'next');
    seen.push(phase(engine));
    if (phase(engine) === 'section') {
      const s = engine.hostView().section;
      assert.equal(s.firstRound, 7);
      assert.equal(s.rounds, 9);
      assert.equal(s.title, 'Find the Bible verse');
      assert.equal(engine.playerView('a1').section.firstRound, 7);
      okHost(engine, 'next');
    }
  }
  assert.equal(seen[5], 'section');
  assert.equal(seen.filter((s) => s === 'section').length, 1);
  assert.equal(phase(engine), 'podium');
  assert.equal(host(engine, 'next').code, 'wrong_phase');
  assert.equal(engine.hostView().podium.rounds.length, 15);
  // the items used were the first 6 yes/no and the first 9 choose items
  assert.deepEqual(
    engine.hostView().podium.rounds.map((r) => r.type),
    [...Array(6).fill('yesno'), ...Array(9).fill('choose')]
  );
});

test('shorter question lists mean fewer rounds; no section slide without yes/no rounds', () => {
  const { engine } = setup({ questions: { yesno: YESNO.slice(0, 2), choose: CHOOSE.slice(0, 1) } });
  join(engine, 'a1', 'A');
  assert.deepEqual(engine.hostView().totals, { rounds: 3, yesno: 2, choose: 1 });
  const only = setup({ questions: { yesno: [], choose: CHOOSE.slice(0, 2) } }).engine;
  join(only, 'a1', 'A');
  startGame(only);
  assert.equal(only.hostView().round.type, 'choose');
  okHost(only, 'endEarly');
  okHost(only, 'next');
  okHost(only, 'next');
  assert.equal(phase(only), 'question');
});

test('invalid question items are ignored', () => {
  const bad = {
    yesno: [{ quote: 'ok', isBible: true }, { quote: '', isBible: true }, { quote: 'no flag' }, null],
    choose: [CHOOSE[0], { options: CHOOSE[1].options.slice(0, 3) }, { options: CHOOSE[2].options.map((o) => ({ ...o, isBible: true })) }],
  };
  const { engine } = setup({ questions: bad });
  assert.deepEqual(engine.hostView().totals, { rounds: 2, yesno: 1, choose: 1 });
});

/* ------------------------------------------------------------------ timers */

test('timer: nextDeadline and tick end the question; tick is safe early and repeatedly', () => {
  const { engine, clock } = setup();
  join(engine, 'a1', 'Alice');
  assert.equal(engine.nextDeadline(), null);
  startGame(engine);
  const v = engine.hostView();
  assert.equal(v.deadline, clock.t + 15000);
  assert.equal(v.serverNow, clock.t);
  assert.equal(engine.nextDeadline(), clock.t + 15000);
  clock.t += 14999;
  assert.equal(engine.tick(), false);
  assert.equal(phase(engine), 'question');
  clock.t += 1;
  assert.equal(engine.tick(), true);
  assert.equal(phase(engine), 'reveal');
  assert.equal(engine.tick(), false);
  assert.equal(engine.nextDeadline(), null);
  assert.equal(engine.hostView().deadline, null);
});

test('an answer after the deadline is rejected even before tick() runs', () => {
  const { engine, clock } = setup();
  join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  startGame(engine);
  clock.t += 15000;
  assert.equal(answer(engine, 'a1', true).code, 'not_accepting');
  assert.equal(phase(engine), 'reveal');
});

test('addTime adds 15 s to the deadline and the total, any number of times', () => {
  const { engine, clock } = setup();
  join(engine, 'a1', 'Alice');
  assert.equal(host(engine, 'addTime').code, 'wrong_phase');
  startGame(engine);
  const d0 = engine.nextDeadline();
  okHost(engine, 'addTime');
  okHost(engine, 'addTime');
  assert.equal(engine.nextDeadline(), d0 + 30000);
  assert.equal(engine.hostView().timerTotal, 45000);
  assert.equal(engine.playerView('a1').deadline, d0 + 30000);
  clock.t = d0 + 1;
  engine.tick();
  assert.equal(phase(engine), 'question');
});

test('endEarly ends the question immediately; only during a question', () => {
  const { engine } = setup();
  join(engine, 'a1', 'Alice');
  assert.equal(host(engine, 'endEarly').code, 'wrong_phase');
  startGame(engine);
  okHost(engine, 'endEarly');
  assert.equal(phase(engine), 'reveal');
  assert.equal(host(engine, 'endEarly').code, 'wrong_phase');
});

test('question ends as soon as every connected player has answered', () => {
  const { engine } = setup();
  join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  join(engine, 'c1', 'Cat');
  engine.disconnect('c1'); // offline players are not waited for
  startGame(engine);
  answer(engine, 'a1', true);
  assert.equal(phase(engine), 'question');
  assert.deepEqual(engine.hostView().answers, { count: 1, expected: 2 });
  answer(engine, 'b1', false);
  assert.equal(phase(engine), 'reveal');
});

test('disconnect or kick of the last player not answering ends the question', () => {
  const { engine } = setup();
  join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  const c = join(engine, 'c1', 'Cat');
  startGame(engine);
  answer(engine, 'a1', true);
  engine.disconnect('b1');
  assert.equal(phase(engine), 'question');
  okHost(engine, 'kick', { playerId: c.playerId });
  assert.equal(phase(engine), 'reveal');
  // nobody connected: the question does not end by itself
  const { engine: e2 } = setup();
  join(e2, 'a1', 'Alice');
  startGame(e2);
  e2.disconnect('a1');
  assert.equal(phase(e2), 'question');
});

/* ----------------------------------------------------------------- answers */

test('answers: first answer locks, types are checked, only during a question', () => {
  const { engine } = setup();
  join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  assert.equal(answer(engine, 'a1', true).code, 'not_accepting');
  startGame(engine);
  assert.equal(answer(engine, 'zz', true).code, 'not_joined');
  for (const bad of [1, 'true', null, undefined, {}]) assert.equal(answer(engine, 'a1', bad).code, 'bad_answer');
  assert.deepEqual(answer(engine, 'a1', true), { ok: true, answer: true });
  assert.equal(engine.playerView('a1').myAnswer, true);
  assert.equal(engine.playerView('b1').myAnswer, null);
  assert.equal(answer(engine, 'a1', false).code, 'already_answered');
  assert.equal(engine.playerView('a1').myAnswer, true);
  const qid = engine.playerView('b1').question.qid;
  assert.equal(engine.playerCommand('b1', { type: 'answer', answer: true, qid: qid + 1 }).code, 'stale_question');
  assert.equal(engine.playerCommand('b1', { type: 'answer', answer: true, qid }).ok, true);
});

test('choose answers are option indexes 0-3 in the shown order', () => {
  const { engine } = setup({ config: { yesnoRounds: 0 } });
  join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  startGame(engine);
  assert.equal(engine.hostView().round.type, 'choose');
  for (const bad of [true, 4, -1, 1.5, '1']) assert.equal(answer(engine, 'a1', bad).code, 'bad_answer');
  const c = correctShown(engine);
  answer(engine, 'a1', c);
  answer(engine, 'b1', (c + 1) % 4);
  const v = engine.hostView();
  assert.equal(v.phase, 'reveal');
  assert.equal(v.question.correctAnswer, c);
  assert.equal(v.question.options[c].isBible, true);
  assert.equal(v.question.options.filter((o) => o.isBible).length, 1);
  const res = Object.fromEntries(v.results.map((r) => [r.name, r]));
  assert.equal(res.Alice.correct, true);
  assert.equal(res.Bob.correct, false);
  assert.equal(v.stats.options[c], 1);
  assert.equal(v.stats.options.reduce((a, b) => a + b, 0), 2);
});

test('choose options are shuffled once per round; host and players see the same order', () => {
  const { engine } = setup({ config: { yesnoRounds: 0 }, seed: 7 });
  join(engine, 'a1', 'Alice');
  join(engine, 'b1', 'Bob');
  startGame(engine);
  const orders = [];
  for (let i = 0; i < 9; i++) {
    const h = engine.hostView().question.options.map((o) => o.quote);
    assert.deepEqual(engine.playerView('a1').question.options.map((o) => o.quote), h);
    assert.deepEqual(engine.playerView('b1').question.options.map((o) => o.quote), h);
    assert.deepEqual(engine.hostView().question.options.map((o) => o.quote), h); // stable between views
    assert.deepEqual([...h].sort(), CHOOSE[i].options.map((o) => o.quote).sort());
    orders.push(h.map((q) => Number(q.slice(-1)) - 1).join(''));
    okHost(engine, 'endEarly');
    const revealed = engine.hostView().question.options.map((o) => o.quote);
    assert.deepEqual(revealed, h); // same order at reveal
    if (i < 8) toNextQuestion(engine);
  }
  assert.ok(new Set(orders).size > 1, 'options are actually shuffled');
});

test('players who join during a question may answer it', () => {
  const { engine } = setup();
  join(engine, 'a1', 'Alice');
  startGame(engine);
  join(engine, 'b1', 'Bob');
  assert.equal(engine.playerView('b1').phase, 'question');
  assert.equal(answer(engine, 'b1', correctShown(engine)).ok, true);
  assert.equal(phase(engine), 'question'); // Alice has not answered yet
});

/* ---------------------------------------------------------------- scoring */

test('scoring: 500 + 500 * (1 - elapsed/total), rounded; wrong and missing answers score 0', () => {
  const { engine, clock } = setup();
  for (const n of ['A', 'B', 'C', 'D', 'E']) join(engine, n, n);
  startGame(engine); // 15 s yes/no
  const c = correctShown(engine);
  answer(engine, 'A', c); // 0 ms -> 1000
  clock.t += 3000;
  answer(engine, 'B', c); // 3 s -> 900
  clock.t += 1501;
  answer(engine, 'C', c); // 4.501 s -> 500 + 500 * 0.69993 = 849.97 -> 850
  clock.t += 3000;
  answer(engine, 'D', !c); // wrong -> 0
  okHost(engine, 'endEarly'); // E did not answer
  const pts = Object.fromEntries(engine.hostView().results.map((r) => [r.name, r.points]));
  assert.deepEqual(pts, { A: 1000, B: 900, C: 850, D: 0, E: 0 });
  assert.equal(engine.playerView('B').result.ms, 3000);
  assert.equal(engine.playerView('E').result.answer, null);
  assert.equal(engine.playerView('D').result.correct, false);
});

test('scoring: an answer at the very end scores 500; added time counts in the total', () => {
  const { engine, clock } = setup();
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  startGame(engine);
  const c = correctShown(engine);
  clock.t += 14999;
  answer(engine, 'A', c); // 14.999 / 15 -> 500.03 -> 500
  okHost(engine, 'addTime'); // total 30 s
  clock.t += 1; // 15 s elapsed of 30
  answer(engine, 'B', c);
  const pts = Object.fromEntries(engine.hostView().results.map((r) => [r.name, r.points]));
  // A answered before the time was added, but the total including added time is used: 14.999/30 -> 750
  assert.deepEqual(pts, { A: 750, B: 750 });
});

test('scoring: rounds 13, 14 and 15 score double', () => {
  const { engine, clock } = setup();
  join(engine, 'A', 'A');
  startGame(engine);
  const got = [];
  for (let no = 1; no <= 15; no++) {
    const before = engine.playerView('A').me.score;
    clock.t += 5000; // the clock keeps moving between rounds
    const start = engine.nextDeadline() - engine.hostView().timerTotal;
    clock.t = start + engine.hostView().timerTotal / 5; // 20% elapsed -> 900
    answer(engine, 'A', correctShown(engine));
    assert.equal(phase(engine), 'reveal');
    got.push(engine.playerView('A').me.score - before);
    if (no < 15) toNextQuestion(engine);
  }
  assert.deepEqual(got, [...Array(12).fill(900), 1800, 1800, 1800]);
  assert.equal(engine.playerView('A').me.score, 12 * 900 + 3 * 1800);
});

test('streak counts consecutive correct answers and resets on wrong or missing answers', () => {
  const { engine } = setup();
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  startGame(engine);
  const plan = ['right', 'right', 'wrong', 'right', 'none'];
  const streaks = [];
  plan.forEach((what, i) => {
    if (what === 'right') answer(engine, 'A', correctShown(engine));
    if (what === 'wrong') answer(engine, 'A', wrongShown(engine));
    okHost(engine, 'endEarly');
    streaks.push(engine.playerView('A').me.streak);
    if (i < plan.length - 1) toNextQuestion(engine);
  });
  assert.deepEqual(streaks, [1, 2, 0, 1, 0]);
});

/* ------------------------------------------------------- leaderboard, podium */

test('leaderboard: competition ranking, stable tie order by join time, previous rank, top 5', () => {
  const { engine } = setup();
  const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
  for (const n of names) join(engine, n, n);
  startGame(engine);
  // round 1: P7 and P6 right instantly (1000 each), P5 right instantly too
  for (const n of ['P5', 'P6', 'P7']) answer(engine, n, correctShown(engine));
  okHost(engine, 'endEarly');
  okHost(engine, 'next');
  const lb = engine.hostView().leaderboard;
  assert.equal(lb.entries.length, 5);
  assert.equal(lb.playerCount, 7);
  assert.equal(lb.isLastRound, false);
  assert.deepEqual(
    lb.entries.map((e) => [e.name, e.rank, e.prevRank, e.score]),
    [
      ['P5', 1, 1, 1000],
      ['P6', 1, 1, 1000],
      ['P7', 1, 1, 1000],
      ['P1', 4, 1, 0],
      ['P2', 4, 1, 0],
    ]
  );
  const p1 = engine.playerView('P1');
  assert.equal(p1.me.rank, 4);
  assert.equal(p1.me.prevRank, 1);
  assert.equal(p1.me.of, 7);
  // round 2: P7 alone scores, overtakes
  okHost(engine, 'next');
  answer(engine, 'P7', correctShown(engine));
  okHost(engine, 'endEarly');
  okHost(engine, 'next');
  const lb2 = engine.hostView().leaderboard.entries;
  assert.deepEqual(lb2.slice(0, 3).map((e) => [e.name, e.rank, e.prevRank]), [
    ['P7', 1, 1],
    ['P5', 2, 1],
    ['P6', 2, 1],
  ]);
});

test('podium: tied players share places; host gets top 3 places and full standings', () => {
  const { engine } = setup({ config: { yesnoRounds: 1, chooseRounds: 0 } });
  for (const n of ['A', 'B', 'C', 'D', 'E']) join(engine, n, n);
  startGame(engine);
  const c = correctShown(engine);
  answer(engine, 'A', c); // 1000
  answer(engine, 'B', c); // 1000
  answer(engine, 'C', !c); // 0
  answer(engine, 'D', !c); // 0
  answer(engine, 'E', !c); // 0
  okHost(engine, 'next'); // leaderboard
  assert.equal(engine.hostView().leaderboard.isLastRound, true);
  okHost(engine, 'next'); // podium
  const pd = engine.hostView().podium;
  assert.deepEqual(
    pd.top.map((s) => [s.rank, s.players.map((p) => p.name)]),
    [
      [1, ['A', 'B']],
      [3, ['C', 'D', 'E']],
    ]
  );
  assert.deepEqual(pd.standings.map((s) => [s.name, s.rank, s.score]), [
    ['A', 1, 1000],
    ['B', 1, 1000],
    ['C', 3, 0],
    ['D', 3, 0],
    ['E', 3, 0],
  ]);
  const pv = engine.playerView('C');
  assert.equal(pv.me.rank, 3);
  assert.deepEqual(pv.podium.top, pd.top);
});

/* ----------------------------------------------------------------- reveal */

test('reveal shows correctness, source, note and per-option counts to host and players', () => {
  const { engine } = setup();
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  join(engine, 'C', 'C');
  startGame(engine);
  answer(engine, 'A', true);
  answer(engine, 'B', false);
  okHost(engine, 'endEarly');
  const h = engine.hostView();
  assert.deepEqual(h.question, {
    qid: h.round.qid,
    type: 'yesno',
    quote: YESNO[0].quote,
    isBible: YESNO[0].isBible,
    source: YESNO[0].source,
    note: YESNO[0].note,
    correctAnswer: YESNO[0].isBible,
  });
  assert.deepEqual(h.stats, { bible: 1, notBible: 1, noAnswer: 1 });
  assert.equal(h.results.length, 3);
  const p = engine.playerView('A');
  assert.equal(p.question.source, YESNO[0].source);
  assert.deepEqual(p.result, { answer: true, correct: true, points: 1000, ms: 0 });
  assert.equal(p.myAnswer, true);
  okHost(engine, 'next'); // leaderboard: phones keep their round result
  assert.deepEqual(engine.playerView('A').result, p.result);
});

/* ---------------------------------------------------------------- secrecy */

const SECRET_KEYS = ['isBible', 'source', 'note', 'correctAnswer', 'correctIndex', 'correct', 'results', 'stats', 'result', 'order', 'item'];

function assertNoSecrets(json, label) {
  const obj = JSON.parse(json);
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        assert.equal(SECRET_KEYS.includes(k), false, `${label}: secret key ${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(obj, label);
  for (const k of SECRET_KEYS) assert.equal(json.includes(`"${k}"`), false, `${label} contains "${k}"`);
  for (const s of ALL_SECRET_STRINGS) assert.equal(json.includes(s), false, `${label} contains ${s}`);
}

test('secrecy: no view leaks the answer, source or note during a question (both types)', () => {
  const { engine } = setup();
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  join(engine, 'C', 'C');
  startGame(engine);
  let checkedYesno = 0;
  let checkedChoose = 0;
  for (let no = 1; no <= 15; no++) {
    const check = () => {
      assertNoSecrets(JSON.stringify(engine.hostView()), `host r${no}`);
      for (const c of ['A', 'B', 'C']) assertNoSecrets(JSON.stringify(engine.playerView(c)), `player ${c} r${no}`);
    };
    check(); // nobody answered
    answer(engine, 'A', correctShown(engine));
    check(); // one locked answer
    answer(engine, 'B', wrongShown(engine));
    check(); // two locked answers
    // host sees how many, not who
    const hv = engine.hostView();
    assert.deepEqual(hv.answers, { count: 2, expected: 3 });
    assert.equal(JSON.stringify(hv).includes('answered"'), false);
    if (engine.hostView().round.type === 'yesno') checkedYesno++;
    else checkedChoose++;
    okHost(engine, 'endEarly');
    if (no < 15) toNextQuestion(engine);
  }
  assert.equal(checkedYesno, 6);
  assert.equal(checkedChoose, 9);
});

/* ---------------------------------------------------------- host controls */

test('skip replaces the question with the next spare of the same type and discards answers', () => {
  const { engine, clock } = setup(); // 8 yes/no (2 spares), 10 choose (1 spare)
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  assert.equal(host(engine, 'skip').code, 'wrong_phase');
  startGame(engine);
  const q1 = engine.hostView().question;
  assert.equal(q1.quote, YESNO[0].quote);
  assert.equal(engine.hostView().canSkip, true);
  answer(engine, 'A', true);
  clock.t += 5000;
  okHost(engine, 'skip');
  let v = engine.hostView();
  assert.equal(v.phase, 'question');
  assert.equal(v.round.no, 1);
  assert.equal(v.question.quote, YESNO[6].quote); // first spare
  assert.notEqual(v.question.qid, q1.qid);
  assert.deepEqual(v.answers, { count: 0, expected: 2 });
  assert.equal(v.deadline, clock.t + 15000); // fresh timer
  assert.equal(engine.playerView('A').myAnswer, null);
  assert.equal(engine.playerCommand('A', { type: 'answer', answer: true, qid: q1.qid }).code, 'stale_question');
  okHost(engine, 'skip');
  assert.equal(engine.hostView().question.quote, YESNO[7].quote);
  assert.equal(engine.hostView().canSkip, false);
  assert.equal(host(engine, 'skip').code, 'no_spare');
  okHost(engine, 'endEarly');
  toNextQuestion(engine);
  assert.equal(engine.hostView().question.quote, YESNO[1].quote); // round 2 is still the planned item
});

test('skip on a choose round uses the choose spare', () => {
  const { engine } = setup({ config: { yesnoRounds: 0 } });
  join(engine, 'A', 'A');
  startGame(engine);
  okHost(engine, 'skip');
  const quotes = engine.hostView().question.options.map((o) => o.quote).sort();
  assert.deepEqual(quotes, CHOOSE[9].options.map((o) => o.quote).sort());
  assert.equal(host(engine, 'skip').code, 'no_spare');
});

test('kick: the connection is reported, the token stops working, answers are removed', () => {
  const { engine } = setup();
  join(engine, 'A', 'A');
  const b = join(engine, 'B', 'B');
  join(engine, 'C', 'C');
  startGame(engine);
  answer(engine, 'B', true);
  const res = okHost(engine, 'kick', { playerId: b.playerId });
  assert.equal(res.kickedConnId, 'B');
  assert.deepEqual(engine.takeNotices(), [{ connId: 'B', type: 'kicked' }]);
  assert.deepEqual(engine.takeNotices(), []);
  assert.equal(engine.playerView('B'), null);
  assert.deepEqual(engine.hostView().answers, { count: 0, expected: 2 });
  assert.equal(engine.playerCommand('B2', { type: 'join', token: b.token }).code, 'unknown_token');
  assert.deepEqual(engine.hostView().players.map((p) => p.name), ['A', 'C']);
  assert.equal(host(engine, 'kick', { playerId: b.playerId }).code, 'unknown_player');
});

test('reset: back to the lobby with scores, streaks and history cleared, players kept', () => {
  const { engine } = setup();
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  startGame(engine);
  answer(engine, 'A', correctShown(engine));
  okHost(engine, 'endEarly');
  okHost(engine, 'next');
  okHost(engine, 'reset');
  const v = engine.hostView();
  assert.equal(v.phase, 'lobby');
  assert.equal(v.round, null);
  assert.deepEqual(v.players.map((p) => [p.name, p.score, p.streak]), [
    ['A', 0, 0],
    ['B', 0, 0],
  ]);
  assert.equal(engine.toJSON().game.history.length, 0);
  assert.equal(engine.playerView('A').me.prevRank, null);
  startGame(engine);
  assert.equal(engine.hostView().round.no, 1);
  assert.equal(engine.hostView().question.quote, YESNO[0].quote);
});

/* ------------------------------------------------------------- save/restore */

test('toJSON/restore mid-question keeps answers and timer, and the game continues through reveal', () => {
  const { engine, clock, now } = setup({ config: { yesnoRounds: 0 } });
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  join(engine, 'C', 'C');
  startGame(engine); // choose round, 25 s
  const c = correctShown(engine);
  clock.t += 5000;
  answer(engine, 'A', c); // 5 s of 25 -> 900
  const before = engine.hostView();
  const saved = JSON.parse(JSON.stringify(engine.toJSON()));
  assert.deepEqual(saved, engine.toJSON());

  const restored = createEngine({ questions: BANK, now, random: seeded(99), state: saved });
  assert.equal(restored.version, engine.version);
  assert.deepEqual(restored.hostView(), before);
  assert.equal(restored.playerView('A').myAnswer, c);
  assert.equal(restored.nextDeadline(), engine.nextDeadline());
  assert.equal(answer(restored, 'A', c).code, 'already_answered');
  clock.t += 5000;
  answer(restored, 'B', c); // 10 s of 25 -> 800
  assert.equal(phase(restored), 'question');
  clock.t = restored.nextDeadline();
  assert.equal(restored.tick(), true);
  const v = restored.hostView();
  assert.equal(v.phase, 'reveal');
  assert.equal(v.question.correctAnswer, c);
  assert.deepEqual(Object.fromEntries(v.results.map((r) => [r.name, r.points])), { A: 900, B: 800, C: 0 });
  // and on to the next question
  okHost(restored, 'next');
  okHost(restored, 'next');
  assert.equal(phase(restored), 'question');
  assert.equal(restored.hostView().round.no, 2);
});

test('fromJSON on an existing engine restores state; bad input throws', () => {
  const a = setup();
  join(a.engine, 'A', 'Alice');
  startGame(a.engine);
  const saved = a.engine.toJSON();
  const b = setup({ seed: 5 });
  b.engine.fromJSON(saved);
  assert.deepEqual(b.engine.hostView().players.map((p) => p.name), ['Alice']);
  assert.equal(b.engine.hostView().phase, 'question');
  assert.deepEqual(b.engine.connIds(), ['A']);
  // the saved state is a copy: changing the engine does not change it
  answer(a.engine, 'A', true);
  assert.deepEqual(saved.game.round.answers, {});
  assert.throws(() => b.engine.fromJSON({}));
  assert.throws(() => b.engine.fromJSON(null));
  assert.throws(() => createEngine({ questions: BANK, now: () => 0, random: () => 0, state: { schema: 999 } }));
});

test('config overrides are applied and the saved config wins on restore', () => {
  const { engine, now } = setup({ config: { yesnoSeconds: 10, extraSeconds: 5, maxPlayers: 2, yesnoRounds: 2 } });
  join(engine, 'A', 'A');
  join(engine, 'B', 'B');
  assert.equal(engine.playerCommand('C', { type: 'join', name: 'C' }).code, 'room_full');
  assert.equal(engine.playerCommand('C', { type: 'join', name: 'C' }).error, errorMessage('room_full', { ...DEFAULT_CONFIG, maxPlayers: 2 }));
  startGame(engine);
  assert.equal(engine.hostView().timerTotal, 10000);
  okHost(engine, 'addTime');
  assert.equal(engine.hostView().timerTotal, 15000);
  const r = createEngine({ questions: BANK, now, random: () => 0, config: { yesnoSeconds: 99 }, state: engine.toJSON() });
  assert.equal(r.hostView().totals.yesno, 2);
  assert.equal(r.hostView().timerTotal, 15000);
});
