/**
 * "Bible or Not?" game engine.
 *
 * Pure ES module: no I/O, no globals for time or randomness, no dependencies.
 * It only knows "connection ids" (opaque strings chosen by the server).
 * Time comes from the injected now() (ms epoch) and randomness from the injected
 * random() (float in [0, 1)). The whole state is plain JSON (toJSON / fromJSON).
 *
 * Phases:
 *   lobby -> intro -> question -> reveal -> leaderboard -> question -> ...
 *   (a "section" slide comes before the first four-choice round)
 *   ... -> leaderboard (after the final round) -> podium
 *
 * See docs/protocol.md for the message protocol and the view shapes.
 */

export const SCHEMA = 1;

export const DEFAULT_CONFIG = Object.freeze({
  yesnoRounds: 6, // rounds 1..6 are "Is this from the Bible?"
  chooseRounds: 9, // rounds 7..15 are "Which one is from the Bible?"
  yesnoSeconds: 15,
  chooseSeconds: 25,
  extraSeconds: 15, // host "+15 s"
  doubleFromRound: 13, // rounds 13, 14, 15 score double
  maxPlayers: 50,
  maxNameLength: 15, // in Unicode code points
  leaderboardSize: 5, // top N on the host leaderboard slide
});

export const PHASES = Object.freeze(['lobby', 'intro', 'question', 'reveal', 'leaderboard', 'section', 'podium']);

const MIN_POINTS = 500;
const MAX_POINTS = 1000;
const MAX_RAW_NAME = 200; // raw input longer than this is rejected before cleaning
const MAX_TOKEN = 64;
const MAX_TYPE = 32;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const ERROR_CODES = Object.freeze([
  'bad_message',
  'unknown_type',
  'not_joined',
  'unknown_token',
  'name_empty',
  'name_too_long',
  'name_taken',
  'room_full',
  'game_over',
  'names_locked',
  'not_accepting',
  'stale_question',
  'bad_answer',
  'already_answered',
  'wrong_phase',
  'no_players',
  'no_questions',
  'no_spare',
  'unknown_player',
]);

export function errorMessage(code, cfg = DEFAULT_CONFIG) {
  switch (code) {
    case 'bad_message':
      return 'That message could not be understood.';
    case 'unknown_type':
      return 'Unknown message type.';
    case 'not_joined':
      return 'You are not in the game. Please join first.';
    case 'unknown_token':
      return 'Your earlier place in the game was not found. Please enter your name.';
    case 'name_empty':
      return 'Please type a name.';
    case 'name_too_long':
      return `Names can be at most ${cfg.maxNameLength} characters.`;
    case 'name_taken':
      return 'That name is taken. If it is you, close other tabs and try again in a few seconds, or pick a new name.';
    case 'room_full':
      return `The room is full (${cfg.maxPlayers} players).`;
    case 'game_over':
      return 'The game has finished. Ask the host to start a new one.';
    case 'names_locked':
      return 'Names are locked once the game has started.';
    case 'not_accepting':
      return 'Answers are not open right now.';
    case 'stale_question':
      return 'That question is no longer on screen.';
    case 'bad_answer':
      return 'That is not a valid answer.';
    case 'already_answered':
      return 'You have already answered. Your first answer counts.';
    case 'wrong_phase':
      return 'That cannot be done right now.';
    case 'no_players':
      return 'At least one player must join before the game can start.';
    case 'no_questions':
      return 'There are no questions loaded.';
    case 'no_spare':
      return 'There are no spare questions of this type left.';
    case 'unknown_player':
      return 'Player not found.';
    default:
      return 'Something went wrong.';
  }
}

/* ------------------------------------------------------------------ helpers */

// Strip control / bidi-override / zero-width characters, collapse whitespace, trim.
// (U+200D, the emoji joiner, is deliberately kept.)
const CONTROL_CHARS = new RegExp(
  '[' +
    [
      '\\u0000-\\u001F',
      '\\u007F-\\u009F',
      '\\u200B',
      '\\u200C',
      '\\u200E',
      '\\u200F',
      '\\u2028',
      '\\u2029',
      '\\u202A-\\u202E',
      '\\u2060-\\u2069',
      '\\uFEFF',
    ].join('') +
    ']',
  'g'
);

export function cleanText(v) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

export const cpLen = (s) => Array.from(s).length;

// Two names count as the same if they only differ by capitals or look-alike forms (e.g. full-width letters).
export const nameKey = (s) => s.normalize('NFKC').toLocaleLowerCase('en');

// Points for a correct answer (before the double-points multiplier).
export function scoreFor(elapsedMs, totalMs) {
  const frac = totalMs > 0 ? 1 - elapsedMs / totalMs : 0;
  const pts = Math.round(MIN_POINTS + (MAX_POINTS - MIN_POINTS) * frac);
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, pts));
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepCopy = (v) => JSON.parse(JSON.stringify(v));

function normalizeConfig(input) {
  const cfg = { ...DEFAULT_CONFIG };
  if (!isPlainObject(input)) return cfg;
  const ints = ['yesnoRounds', 'chooseRounds', 'doubleFromRound', 'maxPlayers', 'maxNameLength', 'leaderboardSize'];
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    const v = input[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
    cfg[k] = ints.includes(k) ? Math.floor(v) : v;
  }
  if (cfg.yesnoSeconds <= 0) cfg.yesnoSeconds = DEFAULT_CONFIG.yesnoSeconds;
  if (cfg.chooseSeconds <= 0) cfg.chooseSeconds = DEFAULT_CONFIG.chooseSeconds;
  if (cfg.maxNameLength < 1) cfg.maxNameLength = DEFAULT_CONFIG.maxNameLength;
  return cfg;
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const optStr = (v) => (typeof v === 'string' && v ? v : null);

function validYesno(it) {
  return isPlainObject(it) && isStr(it.quote) && typeof it.isBible === 'boolean';
}
function validChoose(it) {
  return (
    isPlainObject(it) &&
    Array.isArray(it.options) &&
    it.options.length === 4 &&
    it.options.every((o) => isPlainObject(o) && isStr(o.quote) && typeof o.isBible === 'boolean') &&
    it.options.filter((o) => o.isBible).length === 1
  );
}

// Keep only well-formed items, and only the fields the engine uses.
function sanitizeBank(q) {
  const yesno = (isPlainObject(q) && Array.isArray(q.yesno) ? q.yesno : []).filter(validYesno).map((it) => ({
    quote: it.quote,
    isBible: it.isBible,
    source: optStr(it.source),
    note: optStr(it.note),
  }));
  const choose = (isPlainObject(q) && Array.isArray(q.choose) ? q.choose : []).filter(validChoose).map((it) => ({
    options: it.options.map((o) => ({ quote: o.quote, isBible: o.isBible, source: optStr(o.source) })),
    note: optStr(it.note),
  }));
  return { yesno, choose };
}

/* ------------------------------------------------------------------- engine */

/**
 * createEngine({ questions, config, now, random, state })
 *   questions: the parsed question bank ({ yesno: [...], choose: [...] })
 *   config:    overrides for DEFAULT_CONFIG (ignored when `state` is given: the saved config wins)
 *   now:       () => ms epoch
 *   random:    () => float in [0, 1)
 *   state:     optional object from engine.toJSON() to restore
 */
export function createEngine({ questions, config = {}, now, random, state } = {}) {
  if (typeof now !== 'function') throw new TypeError('createEngine: now() is required');
  if (typeof random !== 'function') throw new TypeError('createEngine: random() is required');

  const bank = sanitizeBank(questions);
  let S = null; // the whole persistent state (plain JSON)
  let notices = []; // transient: [{ connId, type: 'kicked' | 'replaced' }]

  const cfg = () => S.config;
  const totals = () => {
    const yesno = Math.min(cfg().yesnoRounds, bank.yesno.length);
    const choose = Math.min(cfg().chooseRounds, bank.choose.length);
    return { yesno, choose, rounds: yesno + choose };
  };

  function freshGame() {
    const t = totals();
    return {
      phase: 'lobby',
      roundNo: 0,
      spare: { yesno: t.yesno, choose: t.choose }, // next unused spare index per type
      round: null,
      history: [],
    };
  }

  function freshState(conf) {
    return { schema: SCHEMA, version: 0, config: conf, seq: 0, qidSeq: 0, players: [], game: null };
  }

  const bump = () => {
    S.version += 1;
  };
  const fail = (code) => ({ ok: false, code, error: errorMessage(code, cfg()) });

  /* ----------------------------------------------------------- random */

  function randInt(n) {
    const j = Math.floor(random() * n);
    return Math.min(n - 1, Math.max(0, Number.isFinite(j) ? j : 0));
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const randStr = (chars, len) => {
    let s = '';
    for (let i = 0; i < len; i++) s += chars[randInt(chars.length)];
    return s;
  };
  function newId() {
    let id;
    do id = 'p' + randStr(ID_CHARS, 9);
    while (S.players.some((p) => p.id === id));
    return id;
  }
  function newToken() {
    let t;
    do t = randStr(TOKEN_CHARS, 32);
    while (S.players.some((p) => p.token === t));
    return t;
  }

  /* ---------------------------------------------------------- players */

  const playerOf = (connId) => (connId ? S.players.find((p) => p.connId === connId) || null : null);
  const playerById = (id) => S.players.find((p) => p.id === id) || null;
  const findByName = (name) => {
    const k = nameKey(name);
    return S.players.find((p) => nameKey(p.name) === k) || null;
  };

  function parseName(raw) {
    if (typeof raw !== 'string') return { code: 'name_empty' };
    if (raw.length > MAX_RAW_NAME) return { code: 'name_too_long' };
    const name = cleanText(raw);
    if (!name) return { code: 'name_empty' };
    if (cpLen(name) > cfg().maxNameLength) return { code: 'name_too_long' };
    return { name };
  }

  function unbind(p) {
    p.connId = null;
    p.connected = false;
  }

  function bind(p, connId) {
    const prev = playerOf(connId);
    if (prev && prev !== p) unbind(prev); // this socket was someone else before
    if (p.connId && p.connId !== connId) notices.push({ connId: p.connId, type: 'replaced' });
    p.connId = connId;
    p.connected = true;
  }

  function removePlayer(p) {
    S.players = S.players.filter((x) => x !== p);
    const r = S.game.round;
    if (r) {
      delete r.answers[p.id];
      if (r.results) delete r.results[p.id];
    }
  }

  // competition ranking (1, 1, 3); ties keep join order
  function standings() {
    const list = S.players.slice().sort((a, b) => b.score - a.score || a.seq - b.seq);
    let rank = 0;
    return list.map((p, i) => {
      if (i === 0 || p.score !== list[i - 1].score) rank = i + 1;
      return { p, rank };
    });
  }
  const rankMap = () => new Map(standings().map((e) => [e.p.id, e.rank]));

  /* ----------------------------------------------------------- rounds */

  const multiplierFor = (no) => (no >= cfg().doubleFromRound ? 2 : 1);
  const typeOfRound = (no) => (no <= totals().yesno ? 'yesno' : 'choose');

  function startQuestion(no, type, itemIndex) {
    const item = bank[type][itemIndex];
    const total = Math.round((type === 'yesno' ? cfg().yesnoSeconds : cfg().chooseSeconds) * 1000);
    const startedAt = now();
    S.qidSeq += 1;
    S.game.roundNo = no;
    S.game.round = {
      no,
      type,
      qid: S.qidSeq,
      itemIndex,
      item: deepCopy(item), // the question travels with the saved state
      order: type === 'choose' ? shuffle([0, 1, 2, 3]) : null, // shown position -> original option index
      multiplier: multiplierFor(no),
      startedAt,
      total,
      deadline: startedAt + total,
      answers: {}, // playerId -> { answer, at }
      results: null, // playerId -> { answer, correct, points, ms } (from reveal on)
      stats: null,
    };
    S.game.phase = 'question';
  }

  function startRound(no) {
    const type = typeOfRound(no);
    const itemIndex = type === 'yesno' ? no - 1 : no - 1 - totals().yesno;
    startQuestion(no, type, itemIndex);
  }

  const correctShown = (r) =>
    r.type === 'yesno' ? r.item.isBible : r.order.findIndex((i) => r.item.options[i].isBible);
  const isCorrect = (r, answer) => answer === correctShown(r);

  function endQuestion() {
    const r = S.game.round;
    const before = rankMap();
    for (const p of S.players) p.prevRank = before.get(p.id) ?? null;
    const results = {};
    for (const p of S.players) {
      const a = r.answers[p.id];
      if (!a) {
        p.streak = 0;
        results[p.id] = { answer: null, correct: false, points: 0, ms: null };
        continue;
      }
      const ms = Math.max(0, a.at - r.startedAt);
      const correct = isCorrect(r, a.answer);
      const points = correct ? scoreFor(ms, r.total) * r.multiplier : 0;
      p.score += points;
      p.streak = correct ? p.streak + 1 : 0;
      results[p.id] = { answer: a.answer, correct, points, ms };
    }
    r.results = results;
    r.stats = computeStats(r);
    r.deadline = null;
    S.game.history.push({
      no: r.no,
      type: r.type,
      qid: r.qid,
      answered: Object.keys(r.answers).length,
      correct: Object.values(results).filter((x) => x.correct).length,
    });
    S.game.phase = 'reveal';
  }

  function computeStats(r) {
    const answers = Object.values(r.answers).map((a) => a.answer);
    const noAnswer = S.players.filter((p) => !r.answers[p.id]).length;
    if (r.type === 'yesno') {
      return {
        bible: answers.filter((a) => a === true).length,
        notBible: answers.filter((a) => a === false).length,
        noAnswer,
      };
    }
    return { options: [0, 1, 2, 3].map((i) => answers.filter((a) => a === i).length), noAnswer };
  }

  function maybeAutoEnd() {
    if (S.game.phase !== 'question') return false;
    const r = S.game.round;
    const online = S.players.filter((p) => p.connected);
    if (online.length > 0 && online.every((p) => r.answers[p.id])) {
      endQuestion();
      return true;
    }
    return false;
  }

  // apply an expired question timer
  function expire() {
    const g = S.game;
    if (g.phase === 'question' && g.round && now() >= g.round.deadline) {
      endQuestion();
      bump();
      return true;
    }
    return false;
  }

  const isLastRound = () => S.game.roundNo >= totals().rounds;

  /* ------------------------------------------------------ host actions */

  function hostStart() {
    if (S.game.phase !== 'lobby') return fail('wrong_phase');
    if (totals().rounds === 0) return fail('no_questions');
    if (S.players.length === 0) return fail('no_players');
    S.game.phase = 'intro';
    bump();
    return { ok: true };
  }

  function hostNext() {
    const g = S.game;
    const t = totals();
    switch (g.phase) {
      case 'intro':
        startRound(1);
        break;
      case 'reveal':
        g.phase = 'leaderboard';
        break;
      case 'leaderboard':
        if (isLastRound()) {
          g.phase = 'podium';
          g.round = null;
        } else if (g.roundNo === t.yesno && t.yesno > 0 && t.choose > 0) {
          g.phase = 'section';
        } else {
          startRound(g.roundNo + 1);
        }
        break;
      case 'section':
        startRound(g.roundNo + 1);
        break;
      default:
        return fail('wrong_phase');
    }
    bump();
    return { ok: true };
  }

  function hostEndEarly() {
    if (S.game.phase !== 'question') return fail('wrong_phase');
    endQuestion();
    bump();
    return { ok: true };
  }

  function hostAddTime() {
    if (S.game.phase !== 'question') return fail('wrong_phase');
    const r = S.game.round;
    const extra = Math.round(cfg().extraSeconds * 1000);
    r.deadline += extra;
    r.total += extra;
    bump();
    return { ok: true, deadline: r.deadline };
  }

  function hostSkip() {
    const g = S.game;
    if (g.phase !== 'question') return fail('wrong_phase');
    const r = g.round;
    const idx = g.spare[r.type];
    if (idx >= bank[r.type].length) return fail('no_spare');
    g.spare[r.type] = idx + 1;
    startQuestion(r.no, r.type, idx); // same round number, answers discarded
    bump();
    return { ok: true };
  }

  function hostKick(playerId) {
    if (typeof playerId !== 'string' || playerId.length > MAX_TOKEN) return fail('bad_message');
    const p = playerById(playerId);
    if (!p) return fail('unknown_player');
    const connId = p.connId;
    removePlayer(p);
    if (connId) notices.push({ connId, type: 'kicked' });
    maybeAutoEnd();
    bump();
    return { ok: true, kickedConnId: connId };
  }

  function hostReset() {
    S.game = freshGame();
    for (const p of S.players) {
      p.score = 0;
      p.streak = 0;
      p.prevRank = null;
    }
    bump();
    return { ok: true };
  }

  /* ------------------------------------------------------ player input */

  function playerJoin(connId, msg) {
    let p = null;
    const hasName = msg.name !== undefined && msg.name !== null;
    if (msg.token !== undefined && msg.token !== null && msg.token !== '') {
      if (typeof msg.token === 'string' && msg.token.length <= MAX_TOKEN) {
        p = S.players.find((x) => x.token === msg.token) || null;
      }
      if (!p && !hasName) return fail('unknown_token');
    }
    if (!p) {
      const parsed = parseName(msg.name);
      if (parsed.code) return fail(parsed.code);
      const existing = findByName(parsed.name);
      if (existing) {
        if (existing.connected && existing.connId !== connId) return fail('name_taken');
        p = existing; // same name, old phone offline: take over (keeps the score)
      } else {
        if (S.game.phase === 'podium') return fail('game_over');
        if (S.players.length >= cfg().maxPlayers) return fail('room_full');
        S.seq += 1;
        p = {
          id: newId(),
          token: newToken(),
          name: parsed.name,
          seq: S.seq,
          connId: null,
          connected: false,
          score: 0,
          streak: 0,
          prevRank: null,
        };
        S.players.push(p);
      }
    }
    bind(p, connId);
    maybeAutoEnd();
    bump();
    return { ok: true, token: p.token, playerId: p.id, name: p.name };
  }

  function playerRename(connId, msg) {
    const p = playerOf(connId);
    if (!p) return fail('not_joined');
    if (S.game.phase !== 'lobby') return fail('names_locked');
    const parsed = parseName(msg.name);
    if (parsed.code) return fail(parsed.code);
    const clash = findByName(parsed.name);
    if (clash && clash !== p) return fail('name_taken');
    if (parsed.name !== p.name) {
      p.name = parsed.name;
      bump();
    }
    return { ok: true, name: p.name };
  }

  function playerAnswer(connId, msg) {
    const p = playerOf(connId);
    if (!p) return fail('not_joined');
    if (S.game.phase !== 'question') return fail('not_accepting');
    const r = S.game.round;
    if (msg.qid !== undefined && msg.qid !== null && msg.qid !== r.qid) return fail('stale_question');
    const a = msg.answer;
    const valid = r.type === 'yesno' ? typeof a === 'boolean' : Number.isInteger(a) && a >= 0 && a <= 3;
    if (!valid) return fail('bad_answer');
    if (r.answers[p.id]) return fail('already_answered');
    r.answers[p.id] = { answer: a, at: now() };
    maybeAutoEnd();
    bump();
    return { ok: true, answer: a };
  }

  function playerLeave(connId) {
    const p = playerOf(connId);
    if (!p) return { ok: true };
    if (S.game.phase === 'lobby') removePlayer(p);
    else unbind(p);
    maybeAutoEnd();
    bump();
    return { ok: true };
  }

  /* -------------------------------------------------------------- views */

  function roundInfo() {
    const g = S.game;
    const r = g.round;
    if (!r || !['question', 'reveal', 'leaderboard'].includes(g.phase)) return null;
    return { no: r.no, of: totals().rounds, type: r.type, multiplier: r.multiplier, qid: r.qid };
  }

  function publicQuestion(r) {
    if (r.type === 'yesno') return { qid: r.qid, type: 'yesno', quote: r.item.quote };
    return { qid: r.qid, type: 'choose', options: r.order.map((i) => ({ quote: r.item.options[i].quote })) };
  }

  function revealedQuestion(r) {
    if (r.type === 'yesno') {
      return {
        qid: r.qid,
        type: 'yesno',
        quote: r.item.quote,
        isBible: r.item.isBible,
        source: r.item.source,
        note: r.item.note,
        correctAnswer: r.item.isBible,
      };
    }
    return {
      qid: r.qid,
      type: 'choose',
      options: r.order.map((i) => ({ ...r.item.options[i] })),
      note: r.item.note,
      correctAnswer: correctShown(r),
    };
  }

  function base(role) {
    const g = S.game;
    const r = g.round;
    const t = totals();
    const running = g.phase === 'question' && r;
    return {
      role,
      phase: g.phase,
      version: S.version,
      serverNow: now(),
      deadline: running ? r.deadline : null,
      timerTotal: running ? r.total : null,
      totals: { rounds: t.rounds, yesno: t.yesno, choose: t.choose },
      round: roundInfo(),
    };
  }

  function introInfo() {
    const t = totals();
    const c = cfg();
    return {
      yesnoRounds: t.yesno,
      chooseRounds: t.choose,
      yesnoSeconds: c.yesnoSeconds,
      chooseSeconds: c.chooseSeconds,
      doubleFromRound: c.doubleFromRound <= t.rounds ? c.doubleFromRound : null,
    };
  }

  function sectionInfo() {
    const t = totals();
    return { number: 2, title: 'Find the Bible verse', type: 'choose', firstRound: t.yesno + 1, rounds: t.choose };
  }

  function podiumTop(st) {
    const ranks = [...new Set(st.map((e) => e.rank))].filter((rk) => rk <= 3);
    return ranks.map((rank) => ({
      rank,
      players: st.filter((e) => e.rank === rank).map((e) => ({ playerId: e.p.id, name: e.p.name, score: e.p.score })),
    }));
  }

  function answeredCount(r) {
    const count = S.players.filter((p) => r.answers[p.id]).length;
    const expected = S.players.filter((p) => p.connected || r.answers[p.id]).length;
    return { count, expected };
  }

  function hostView() {
    const g = S.game;
    const r = g.round;
    const st = standings();
    const rankOf = new Map(st.map((e) => [e.p.id, e.rank]));
    const v = base('host');
    v.players = S.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: p.score,
      rank: rankOf.get(p.id),
      streak: p.streak,
    }));
    v.maxPlayers = cfg().maxPlayers;
    switch (g.phase) {
      case 'intro':
        v.intro = introInfo();
        break;
      case 'question':
        v.question = publicQuestion(r);
        v.answers = answeredCount(r);
        v.canSkip = g.spare[r.type] < bank[r.type].length;
        v.extraSeconds = cfg().extraSeconds;
        break;
      case 'reveal':
        v.question = revealedQuestion(r);
        v.stats = r.stats;
        v.results = st
          .filter((e) => r.results[e.p.id])
          .map((e) => ({
            playerId: e.p.id,
            name: e.p.name,
            ...r.results[e.p.id],
            score: e.p.score,
            streak: e.p.streak,
          }))
          .sort((a, b) => b.points - a.points);
        v.isLastRound = isLastRound();
        break;
      case 'leaderboard':
        v.leaderboard = {
          entries: st.slice(0, cfg().leaderboardSize).map((e) => ({
            rank: e.rank,
            prevRank: e.p.prevRank,
            playerId: e.p.id,
            name: e.p.name,
            score: e.p.score,
            streak: e.p.streak,
          })),
          playerCount: st.length,
          isLastRound: isLastRound(),
        };
        break;
      case 'section':
        v.section = sectionInfo();
        break;
      case 'podium':
        v.podium = {
          top: podiumTop(st),
          standings: st.map((e) => ({ rank: e.rank, playerId: e.p.id, name: e.p.name, score: e.p.score })),
          rounds: g.history.map((h) => ({ ...h })),
        };
        break;
      default:
        break;
    }
    return v;
  }

  function playerView(connId) {
    const p = playerOf(connId);
    if (!p) return null;
    const g = S.game;
    const r = g.round;
    const st = standings();
    const mine = st.find((e) => e.p === p);
    const v = base('player');
    v.me = {
      playerId: p.id,
      name: p.name,
      score: p.score,
      rank: mine.rank,
      prevRank: p.prevRank,
      of: st.length,
      streak: p.streak,
    };
    switch (g.phase) {
      case 'lobby':
        v.lobby = { players: S.players.map((x) => ({ name: x.name, connected: x.connected })) };
        break;
      case 'intro':
        v.intro = introInfo();
        break;
      case 'question':
        v.question = publicQuestion(r);
        v.myAnswer = r.answers[p.id] ? r.answers[p.id].answer : null;
        break;
      case 'reveal':
      case 'leaderboard':
        v.question = revealedQuestion(r);
        v.stats = r.stats;
        v.result = r.results[p.id] ? { ...r.results[p.id] } : null;
        v.myAnswer = v.result ? v.result.answer : null;
        v.isLastRound = isLastRound();
        break;
      case 'section':
        v.section = sectionInfo();
        break;
      case 'podium':
        v.podium = { top: podiumTop(st) };
        break;
      default:
        break;
    }
    return v;
  }

  /* -------------------------------------------------------- dispatch */

  function validMsg(msg) {
    return isPlainObject(msg) && typeof msg.type === 'string' && msg.type.length > 0 && msg.type.length <= MAX_TYPE;
  }

  function playerCommand(connId, msg) {
    if (typeof connId !== 'string' || !connId || !validMsg(msg)) return fail('bad_message');
    expire();
    switch (msg.type) {
      case 'join':
        return playerJoin(connId, msg);
      case 'rename':
        return playerRename(connId, msg);
      case 'answer':
        return playerAnswer(connId, msg);
      case 'leave':
        return playerLeave(connId);
      default:
        return fail('unknown_type');
    }
  }

  function hostCommand(msg) {
    if (!validMsg(msg)) return fail('bad_message');
    expire();
    switch (msg.type) {
      case 'start':
        return hostStart();
      case 'next':
        return hostNext();
      case 'endEarly':
        return hostEndEarly();
      case 'addTime':
        return hostAddTime();
      case 'skip':
        return hostSkip();
      case 'kick':
        return hostKick(msg.playerId);
      case 'reset':
        return hostReset();
      default:
        return fail('unknown_type');
    }
  }

  function disconnect(connId) {
    const p = playerOf(connId);
    if (!p) return;
    unbind(p);
    maybeAutoEnd();
    bump();
  }

  function fromJSON(obj) {
    if (!isPlainObject(obj) || obj.schema !== SCHEMA || !Array.isArray(obj.players) || !isPlainObject(obj.game)) {
      throw new Error('fromJSON: not a saved engine state');
    }
    if (!PHASES.includes(obj.game.phase)) throw new Error('fromJSON: unknown phase');
    S = deepCopy(obj);
    S.config = normalizeConfig(S.config);
    notices = [];
  }

  if (state !== undefined && state !== null) {
    fromJSON(state);
  } else {
    S = freshState(normalizeConfig(config));
    S.game = freshGame();
  }

  return {
    playerCommand,
    hostCommand,
    disconnect,
    hostView,
    playerView,
    nextDeadline: () => (S.game.phase === 'question' && S.game.round ? S.game.round.deadline : null),
    tick: () => expire(),
    get version() {
      return S.version;
    },
    // [{ connId, type: 'kicked' | 'replaced' }] since the last call; clears the list
    takeNotices() {
      const out = notices;
      notices = [];
      return out;
    },
    connIds: () => S.players.filter((p) => p.connId).map((p) => p.connId),
    toJSON: () => deepCopy(S),
    fromJSON,
  };
}
