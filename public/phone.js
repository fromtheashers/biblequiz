(function () {
  'use strict';

  /* ------------------------------------------------------------ helpers */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v == null) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  const mem = {};
  const LS = {
    get(k) { try { return localStorage.getItem('bon_' + k); } catch (e) { return mem[k] || null; } },
    set(k, v) { try { localStorage.setItem('bon_' + k, v); } catch (e) { mem[k] = v; } },
    del(k) { try { localStorage.removeItem('bon_' + k); } catch (e) { delete mem[k]; } },
  };

  const ord = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const MAX_NAME = 15;
  const SHAPES = ['▲', '◆', '●', '■'];
  const squash = (t) => t.replace(/\s+/g, ' ').trim();
  const clip = (t, n) => Array.from(t).slice(0, n).join('');
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  /* -------------------------------------------------------------- state */
  let ws = null;
  let S = null; // latest player view
  let offset = 0; // serverNow - Date.now()
  let stopped = false; // kicked or replaced: do not reconnect
  let delay = 500;
  let reconnectTimer = null;
  let joinPending = null; // { auto: bool, name: string } while a join is in flight
  let renamePending = false;
  let picked = null; // { qid, answer } optimistic lock
  let qKey = '';
  let screen = '';

  function show(id) {
    for (const s of $$('main > section')) s.hidden = s.id !== 's-' + id;
    if (screen !== id) {
      screen = id;
      window.scrollTo(0, 0);
    }
  }

  /* ------------------------------------------------------------- socket */
  function send(obj) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (stopped) return;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?role=player';
    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    const mine = ws;
    mine.addEventListener('open', () => {
      if (mine !== ws) return;
      delay = 500;
      $('#conn').hidden = true;
      onOpen();
    });
    mine.addEventListener('message', (ev) => {
      if (mine !== ws) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && typeof msg === 'object') onMessage(msg);
    });
    mine.addEventListener('close', () => {
      if (mine !== ws) return;
      joinPending = null;
      if (stopped) return;
      $('#conn').hidden = false;
      scheduleReconnect();
    });
    mine.addEventListener('error', () => {});
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (stopped) return;
    $('#conn').hidden = false;
    reconnectTimer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 5000);
  }

  function onOpen() {
    const token = LS.get('token');
    if (token) {
      joinPending = { auto: true, name: '' };
      send({ type: 'join', token });
    } else if (!S) {
      showJoin('');
    }
  }

  function onMessage(msg) {
    if (msg.type === 'state') {
      if (msg.view && msg.view.role === 'player') onState(msg.view);
    } else if (msg.type === 'ack') {
      onAck(msg);
    } else if (msg.type === 'kicked') {
      stopWith('The host removed you from the game.', true);
    } else if (msg.type === 'replaced') {
      stopWith('You joined from another tab or device. This one has stopped.', false);
    } else if (msg.type === 'error') {
      if (screen === 'join') joinErr.textContent = msg.error || 'Something went wrong. Please try again.';
    }
  }

  function stopWith(text, forget) {
    stopped = true;
    clearTimeout(reconnectTimer);
    if (forget) LS.del('token');
    S = null;
    picked = null;
    qKey = '';
    $('#conn').hidden = true;
    $('#top').hidden = true;
    closeRename();
    $('#msg-text').textContent = text;
    $('#msg-btn').hidden = !forget;
    show('msg');
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  }

  $('#msg-btn').addEventListener('click', () => {
    stopped = false;
    delay = 500;
    showJoin('', LS.get('name') || '');
    connect();
  });

  /* --------------------------------------------------------------- acks */
  function onAck(a) {
    if (a.for === 'join') {
      const p = joinPending;
      joinPending = null;
      if (a.ok) {
        LS.set('token', a.token);
        LS.set('name', a.name);
        joinErr.textContent = '';
        return; // the state message follows
      }
      if (p && p.auto) {
        if (a.code === 'unknown_token') LS.del('token');
        S = null;
        showJoin(a.error || 'Could not join. Please try again.', LS.get('name') || '');
      } else {
        showJoin(a.error || 'Could not join. Please try again.', p ? p.name : '');
      }
    } else if (a.for === 'rename') {
      renamePending = false;
      renameSave.disabled = false;
      if (a.ok) {
        if (a.name) LS.set('name', a.name);
        closeRename();
      } else {
        renameErr.textContent = a.error || 'Could not change the name.';
      }
    } else if (a.for === 'answer') {
      if (!a.ok && a.code !== 'already_answered') {
        // unlock so the player can try again
        picked = null;
        qKey = '';
        if (S) render();
        $$('.q-error').forEach((e) => { e.textContent = a.error || 'That answer did not go through. Please try again.'; });
      }
    }
  }

  /* --------------------------------------------------------------- join */
  const form = $('#join-form');
  const nameInput = $('#name-input');
  const joinBtn = $('#join-btn');
  const joinErr = $('#join-error');
  const joinCount = $('#join-count');

  function showJoin(err, prefill) {
    show('join');
    $('#top').hidden = true;
    joinErr.textContent = err || '';
    const last = prefill || LS.get('name') || '';
    if (last && !nameInput.value) nameInput.value = clip(last, MAX_NAME);
    updateCount(nameInput, joinCount);
    joinBtn.disabled = false;
  }

  function limitInput(input, counter) {
    const cps = Array.from(input.value);
    if (cps.length > MAX_NAME) input.value = cps.slice(0, MAX_NAME).join('');
    counter.textContent = Math.min(cps.length, MAX_NAME) + '/' + MAX_NAME;
  }
  function updateCount(input, counter) { limitInput(input, counter); }

  nameInput.addEventListener('input', () => limitInput(nameInput, joinCount));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = squash(nameInput.value);
    if (!name) {
      joinErr.textContent = 'Please type a name.';
      return;
    }
    joinErr.textContent = '';
    joinBtn.disabled = true;
    joinPending = { auto: false, name };
    if (!send({ type: 'join', name })) {
      joinPending = null;
      joinBtn.disabled = false;
      joinErr.textContent = 'Not connected yet. Please try again in a moment.';
    }
  });

  /* ------------------------------------------------------------- rename */
  const renameBox = $('#rename');
  const renameInput = $('#rename-input');
  const renameErr = $('#rename-error');
  const renameSave = $('#rename-save');
  const renameCount = $('#rename-count');

  function openRename() {
    if (!S || S.phase !== 'lobby') return;
    renameInput.value = S.me.name;
    limitInput(renameInput, renameCount);
    renameErr.textContent = '';
    renameSave.disabled = false;
    renameBox.hidden = false;
    renameInput.focus();
    renameInput.select();
  }
  function closeRename() {
    renameBox.hidden = true;
    renamePending = false;
    renameInput.blur();
  }
  $('#me-edit').addEventListener('click', openRename);
  $('#rename-cancel').addEventListener('click', closeRename);
  renameInput.addEventListener('input', () => limitInput(renameInput, renameCount));
  $('#rename-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = squash(renameInput.value);
    if (!name) { renameErr.textContent = 'Please type a name.'; return; }
    if (S && name === S.me.name) { closeRename(); return; }
    renameErr.textContent = '';
    renameSave.disabled = true;
    renamePending = true;
    if (!send({ type: 'rename', name })) {
      renameSave.disabled = false;
      renamePending = false;
      renameErr.textContent = 'Not connected yet. Please try again in a moment.';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !renameBox.hidden) closeRename();
  });

  /* ------------------------------------------------------------- render */
  function onState(view) {
    S = view;
    offset = view.serverNow - Date.now();
    joinErr.textContent = '';
    render();
  }

  function render() {
    if (!S) return;
    const v = S;
    if (v.phase !== 'lobby' && !renameBox.hidden) closeRename();
    if (v.phase !== 'podium') confettiShown = false;
    updateTop(v);
    switch (v.phase) {
      case 'lobby': renderLobby(v); break;
      case 'intro': renderIntro(v); break;
      case 'question': renderQuestion(v); break;
      case 'reveal':
      case 'leaderboard': renderReveal(v); break;
      case 'section': renderSection(v); break;
      case 'podium': renderPodium(v); break;
      default: show('wait');
    }
    tick();
  }

  function updateTop(v) {
    $('#top').hidden = false;
    $('#me-name').textContent = v.me.name;
    const inLobby = v.phase === 'lobby';
    $('#me-edit').disabled = !inLobby;
    $('#me-pen').hidden = !inLobby;
    $('#me-edit').setAttribute('aria-label', inLobby ? 'Change your name' : 'Your name');
    $('#round').textContent = v.round ? 'Round ' + v.round.no + ' of ' + v.round.of : '';
    $('#me-score').textContent = v.me.score + ' pts';
  }

  function renderLobby(v) {
    show('lobby');
    const players = (v.lobby && v.lobby.players) || [];
    $('#lobby-count').textContent = plural(players.length, 'player', 'players') + ' so far';
    const list = $('#lobby-list');
    list.replaceChildren(...players.map((p) =>
      h('li', { class: 'chip' + (p.connected ? '' : ' off') + (p.name === v.me.name ? ' me' : '') }, p.name)));
  }

  function renderIntro(v) {
    show('intro');
    const i = v.intro || {};
    $('#intro-1').textContent = i.yesnoRounds
      ? 'First ' + plural(i.yesnoRounds, 'quote', 'quotes') + ': is it from the Bible? Tap Bible or Not the Bible. You get ' + i.yesnoSeconds + ' seconds.'
      : 'Tap the answer you think is right.';
    $('#intro-2').textContent = i.chooseRounds
      ? 'Then ' + plural(i.chooseRounds, 'round', 'rounds') + ' with four quotes. Only one is from the Bible. You get ' + i.chooseSeconds + ' seconds.'
      : 'Look at the big screen for each question.';
    $('#intro-3').textContent = 'Right answers score points. The faster you answer, the more you get.' +
      (i.doubleFromRound ? ' From round ' + i.doubleFromRound + ' points count double!' : '');
  }

  function kicker(v) {
    if (!v.round) return '';
    return 'Round ' + v.round.no + ' of ' + v.round.of + (v.round.multiplier === 2 ? ' · Double points' : '');
  }

  function renderQuestion(v) {
    const q = v.question;
    const mine = (picked && picked.qid === q.qid) ? picked.answer : (v.myAnswer == null ? null : v.myAnswer);
    if (mine !== null && mine !== undefined) {
      renderLocked(v, mine);
      return;
    }
    const key = 'q' + q.qid;
    if (q.type === 'yesno') {
      show('yesno');
      $('#yn-kicker').textContent = kicker(v);
      if (qKey !== key + 'y') {
        qKey = key + 'y';
        $('#yn-quote').textContent = q.quote;
        $$('#yn-buttons .ans').forEach((b) => { b.disabled = false; });
        $$('.q-error').forEach((e) => { e.textContent = ''; });
      }
    } else {
      show('choose');
      $('#ch-kicker').textContent = kicker(v);
      if (qKey !== key + 'c') {
        qKey = key + 'c';
        $('#ch-tiles').replaceChildren(...q.options.map((o, i) =>
          h('button', { type: 'button', class: 'tile t' + i, 'data-i': i },
            h('span', { class: 'shape', 'aria-hidden': 'true' }, SHAPES[i]),
            h('span', { class: 'txt' }, o.quote))));
        $$('.q-error').forEach((e) => { e.textContent = ''; });
      }
    }
  }

  function pickCard(type, answer, options) {
    if (type === 'yesno') {
      const yes = answer === true;
      return h('div', { class: 'ans ' + (yes ? 'yes' : 'no') },
        h('span', { class: 'shape', 'aria-hidden': 'true' }, yes ? '📖' : '💬'),
        h('span', { class: 'lbl' }, yes ? 'Bible' : 'Not the Bible'));
    }
    const text = options && options[answer] ? options[answer].quote : '';
    return h('div', { class: 'tile t' + answer },
      h('span', { class: 'shape', 'aria-hidden': 'true' }, SHAPES[answer] || ''),
      h('span', { class: 'txt' }, text));
  }

  function renderLocked(v, answer) {
    show('locked');
    $('#lk-kicker').textContent = kicker(v);
    $('#lk-pick').replaceChildren(pickCard(v.question.type, answer, v.question.options));
  }

  function answerOf(v) {
    return v.result ? v.result.answer : (v.myAnswer == null ? null : v.myAnswer);
  }

  function renderReveal(v) {
    show('reveal');
    const q = v.question || {};
    const r = v.result;
    const leaderboard = v.phase === 'leaderboard';
    $('#rv-kicker').textContent = kicker(v);

    const verdict = $('#rv-verdict');
    const mark = $('.vmark', verdict);
    const text = $('.vtext', verdict);
    verdict.classList.remove('ok', 'bad', 'none');
    if (!r) {
      verdict.classList.add('none');
      mark.textContent = '👀';
      text.textContent = 'You joined after this question';
    } else if (r.answer === null || r.answer === undefined) {
      verdict.classList.add('none');
      mark.textContent = '⏰';
      text.textContent = "Time's up, no answer";
    } else if (r.correct) {
      verdict.classList.add('ok');
      mark.textContent = '✓';
      text.textContent = 'Correct!';
    } else {
      verdict.classList.add('bad');
      mark.textContent = '✗';
      text.textContent = 'Wrong';
    }

    const pts = r ? r.points : 0;
    $('#rv-points').textContent = pts > 0 ? '+' + pts + ' points' : '0 points this round';
    $('#rv-dbl').hidden = !(v.round && v.round.multiplier === 2);
    const streak = $('#rv-streak');
    streak.hidden = !(v.me.streak >= 2);
    streak.textContent = v.me.streak >= 2 ? '🔥 ' + v.me.streak + ' correct in a row' : '';
    $('#rv-score').textContent = String(v.me.score);
    $('#rv-rank').textContent = ord(v.me.rank) + ' of ' + v.me.of;

    const move = $('#rv-move');
    move.className = 'move';
    if (leaderboard && v.me.prevRank != null) {
      const d = v.me.prevRank - v.me.rank;
      move.hidden = false;
      if (d > 0) { move.classList.add('up'); move.textContent = '▲ Up ' + plural(d, 'place', 'places') + ' (was ' + ord(v.me.prevRank) + ')'; }
      else if (d < 0) { move.classList.add('down'); move.textContent = '▼ Down ' + plural(-d, 'place', 'places') + ' (was ' + ord(v.me.prevRank) + ')'; }
      else { move.classList.add('same'); move.textContent = '● Holding steady in ' + ord(v.me.rank) + ' place'; }
    } else {
      move.hidden = true;
    }

    // the correct answer
    const mineBox = $('#rv-mine');
    mineBox.hidden = true;
    if (q.type === 'yesno') {
      $('#rv-ans-head').textContent = q.isBible ? '✓ This is from the Bible' : '✓ This is not from the Bible';
      $('#rv-ans-quote').textContent = q.quote || '';
      $('#rv-ans-source').textContent = q.source || '';
    } else if (q.type === 'choose' && q.options) {
      const ci = q.correctAnswer;
      const co = q.options[ci] || { quote: '', source: '' };
      $('#rv-ans-head').textContent = '✓ ' + SHAPES[ci] + ' From the Bible';
      $('#rv-ans-quote').textContent = co.quote || '';
      $('#rv-ans-source').textContent = co.source || '';
      const my = answerOf(v);
      if (typeof my === 'number' && my !== ci && q.options[my]) {
        mineBox.hidden = false;
        $('#rv-mine-quote').textContent = SHAPES[my] + ' ' + q.options[my].quote;
        $('#rv-mine-source').textContent = q.options[my].source || 'Not from the Bible';
      }
    }
    $('#rv-ans-source').hidden = !$('#rv-ans-source').textContent;
    $('#rv-note').textContent = q.note || '';
    $('#rv-note').hidden = !q.note;

    const st = v.stats;
    let line = '';
    if (st) {
      if (q.type === 'yesno') {
        line = st.bible + ' said Bible · ' + st.notBible + ' said Not the Bible' + (st.noAnswer ? ' · ' + st.noAnswer + ' no answer' : '');
      } else if (st.options) {
        line = st.options.map((n, i) => SHAPES[i] + ' ' + n).join('   ') + (st.noAnswer ? '   · ' + st.noAnswer + ' no answer' : '');
      }
    }
    $('#rv-stats').textContent = line;
    $('#rv-stats').hidden = !line;
    $('#rv-next').textContent = leaderboard
      ? (v.isLastRound ? 'Final results are coming up…' : 'Next question coming up…')
      : 'The scores come next. Watch the big screen.';
  }

  function renderSection(v) {
    show('section');
    const s = v.section || {};
    $('#sec-title').textContent = 'Round ' + (s.number || 2) + ': ' + (s.title || 'Find the Bible verse');
    $('#sec-text').textContent = 'Four quotes, only one is from the Bible. Tap the one you think is real.';
  }

  function renderPodium(v) {
    show('podium');
    const rank = v.me.rank;
    const top = (v.podium && v.podium.top) || [];
    let shared = false;
    for (const place of top) if (place.rank === rank && place.players.length > 1) shared = true;
    const label = (shared ? 'Joint ' : '') + ord(rank);
    $('#pd-medal').textContent = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎉';
    if (rank <= 3) {
      $('#pd-title').textContent = 'You finished ' + label + '!';
      $('#pd-sub').textContent = rank === 1 ? 'You won! Great job.' : 'You are on the podium. Well played!';
    } else {
      $('#pd-title').textContent = 'You finished ' + ord(rank) + ' of ' + v.me.of + '.';
      $('#pd-sub').textContent = 'Thanks for playing!';
    }
    $('#pd-score').textContent = String(v.me.score);
    $('#pd-rank').textContent = label + ' of ' + v.me.of;
    if (rank <= 3 && !confettiShown) startConfetti();
    if (rank > 3) $('#confetti').replaceChildren();
  }

  let confettiShown = false;
  function startConfetti() {
    confettiShown = true;
    const colors = ['#ffd23f', '#2ee6c5', '#ff4d9d', '#7b5cff', '#4be38a', '#ff5c6c'];
    const box = $('#confetti');
    const bits = [];
    for (let i = 0; i < 48; i++) {
      const b = h('i');
      b.style.left = Math.random() * 100 + '%';
      b.style.background = colors[i % colors.length];
      b.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      b.style.animationDelay = Math.random() * 1.5 + 's';
      bits.push(b);
    }
    box.replaceChildren(...bits);
  }

  /* ----------------------------------------------------------- answering */
  function submitAnswer(answer) {
    if (!S || S.phase !== 'question') return;
    const qid = S.question.qid;
    if (picked && picked.qid === qid) return;
    picked = { qid, answer };
    try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { /* ignore */ }
    $$('#yn-buttons .ans, #ch-tiles .tile').forEach((b) => { b.disabled = true; });
    send({ type: 'answer', answer, qid });
    renderLocked(S, answer);
    tick();
  }

  $('#yn-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('button.ans');
    if (b && !b.disabled) submitAnswer(b.getAttribute('data-answer') === 'true');
  });
  $('#ch-tiles').addEventListener('click', (e) => {
    const b = e.target.closest('button.tile');
    if (b && !b.disabled) submitAnswer(Number(b.getAttribute('data-i')));
  });

  /* ---------------------------------------------------------- countdown */
  function tick() {
    if (!S || S.phase !== 'question' || S.deadline == null) return;
    const left = Math.max(0, S.deadline - (Date.now() + offset));
    const total = S.timerTotal || 1;
    const frac = Math.min(1, left / total);
    const secs = Math.ceil(left / 1000);
    for (const t of $$('.timer')) {
      if (t.closest('section').hidden) continue;
      $('.bar > i', t).style.width = (frac * 100).toFixed(1) + '%';
      $('.t-num', t).textContent = String(secs);
      t.classList.toggle('urgent', left <= 5000);
    }
  }
  setInterval(tick, 150);

  /* -------------------------------------------------------------- start */
  if (LS.get('token')) show('wait');
  else showJoin('');
  connect();
})();
