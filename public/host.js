/* Bible or Not? - the host screen (the laptop that drives the TV).
 * A thin view: it renders the `view` object from `{type:'state', view}` messages
 * and sends host commands back. See docs/protocol.md.
 */
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

  const ord = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const SHAPES = ['▲', '◆', '●', '■'];
  const PHASE_NAME = {
    lobby: 'Lobby', intro: 'How to play', question: 'Question', reveal: 'Reveal',
    leaderboard: 'Leaderboard', section: 'New section', podium: 'Finale',
  };

  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    // sit just above the control bar so it never covers a button
    const bar = $('#controls');
    if (bar) t.style.bottom = Math.ceil(window.innerHeight - bar.getBoundingClientRect().top + 12) + 'px';
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  const sigs = {};
  const memo = (key, sig, fn) => {
    if (sigs[key] !== sig) {
      sigs[key] = sig;
      fn();
    }
  };

  // Long quotes get a smaller size, but never below `min`, and never overflow their box.
  function fitQuote(el, text, max, min) {
    el.textContent = text || '';
    const n = (text || '').length;
    let size = max;
    if (n > 60) size = Math.max(min, Math.round(max * 0.86));
    if (n > 120) size = Math.max(min, Math.round(max * 0.72));
    if (n > 200) size = Math.max(min, Math.round(max * 0.6));
    if (n > 320) size = min;
    el.style.fontSize = size + 'px';
    const box = el.closest('.fitbox') || el.parentElement;
    for (let i = 0; i < 24 && size > min; i++) {
      if (!box || (box.scrollHeight <= box.clientHeight + 1 && el.scrollHeight <= el.clientHeight + 1)) break;
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  }

  /* -------------------------------------------------------------- sound */
  // background music lives in /music.js; if it failed to load the game still works
  const music = window.BQMusic || {
    on: false, volume: 1, ducked: false,
    setOn() {}, setVolume() {}, setDuck() {}, setPhase() {}, setUrgent() {}, unlock() {},
  };

  const sfx = (() => {
    let ctx = null;
    let noise = null;
    let muted = false;
    let unlocked = false;
    try { muted = localStorage.getItem('bq_host_muted') === '1'; } catch (e) { /* ignore */ }

    function ensure() {
      if (muted || !unlocked) return null;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {
        ctx = null;
      }
      return ctx;
    }
    function noiseBuffer(c) {
      if (!noise) {
        noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.2), c.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return noise;
    }
    function tone(c, freq, t, dur, type, vol) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    return {
      get muted() { return muted; },
      setMuted(m) {
        muted = m;
        try { localStorage.setItem('bq_host_muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      },
      unlock() {
        unlocked = true;
        ensure();
      },
      // a blip when an answer arrives
      blip() {
        const c = ensure();
        if (!c) return;
        tone(c, 760, c.currentTime, 0.1, 'sine', 0.1);
      },
      // the reveal sting
      sting() {
        const c = ensure();
        if (!c) return;
        const t = c.currentTime;
        tone(c, 880, t, 0.25, 'sine', 0.18);
        tone(c, 1320, t + 0.09, 0.3, 'sine', 0.14);
      },
      tick() {
        const c = ensure();
        if (!c) return;
        tone(c, 1000, c.currentTime, 0.06, 'square', 0.06);
      },
      drumroll(sec) {
        const c = ensure();
        if (!c || !(sec > 0.2)) return;
        const t0 = c.currentTime;
        for (let t = 0; t < sec; t += 0.065) {
          const src = c.createBufferSource();
          src.buffer = noiseBuffer(c);
          const f = c.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 190;
          f.Q.value = 0.8;
          const g = c.createGain();
          const vol = 0.1 + 0.5 * (t / sec);
          g.gain.setValueAtTime(vol, t0 + t);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + t + 0.085);
          src.connect(f).connect(g).connect(c.destination);
          src.start(t0 + t);
          src.stop(t0 + t + 0.1);
        }
      },
      fanfare(big) {
        const c = ensure();
        if (!c) return;
        const t = c.currentTime;
        const notes = big ? [523, 659, 784, 1047, 784, 1047] : [523, 659, 784];
        notes.forEach((f, i) => tone(c, f, t + i * 0.12, big ? 0.5 : 0.3, 'sawtooth', 0.1));
      },
    };
  })();

  function confetti() {
    const box = h('div', { class: 'confetti' });
    const colors = ['#ff4d9d', '#ffd23f', '#2ee6c5', '#7b5cff', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const p = h('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      p.style.animationDelay = Math.random() * 0.8 + 's';
      p.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      box.append(p);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 6500);
  }

  /* ------------------------------------------------------------- socket */
  const hostKey = new URLSearchParams(location.search).get('key') || '';
  const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
    '/ws?role=host&key=' + encodeURIComponent(hostKey);

  let ws = null;
  let V = null; // the latest view
  let offset = 0; // serverNow - Date.now()
  let everGotState = false;
  let backoff = 500;
  let reconnectTimer = null;

  function showConnect(title, text) {
    $('#connect-title').textContent = title;
    $('#connect-text').textContent = text || '';
  }

  function connect() {
    reconnectTimer = null;
    let sock;
    try {
      sock = new WebSocket(WS_URL);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      backoff = 500;
      $('#conn-dot').classList.add('on');
      $('#reconnect').hidden = true;
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      handle(msg);
    };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      $('#conn-dot').classList.remove('on');
      $('#reconnect').hidden = false;
      if (!everGotState) {
        showConnect('This host link is not right.', 'Check the key at the end of the address.');
        showView('connect');
      }
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  }

  function handle(msg) {
    if (msg.type === 'state' && msg.view) {
      everGotState = true;
      $('#reconnect').hidden = !!(ws && ws.readyState === 1);
      const old = V;
      offset = (msg.view.serverNow || Date.now()) - Date.now();
      V = msg.view;
      playSounds(old, V);
      render();
      return;
    }
    if (msg.type === 'ack') {
      if (msg.ok === false && msg.error) toast(msg.error);
      return;
    }
    if (msg.type === 'error' && msg.error) toast(msg.error);
  }

  function act(type, data) {
    if (!ws || ws.readyState !== 1) {
      toast('Not connected to the game yet. One moment…');
      return;
    }
    try {
      ws.send(JSON.stringify(Object.assign({ type }, data || {})));
    } catch (e) {
      toast('That did not get through. Try again.');
    }
  }

  /* ------------------------------------------------------------- sounds */
  function playSounds(old, v) {
    music.setPhase(v.phase);
    if (!old || old.phase !== v.phase) {
      if (v.phase === 'reveal') sfx.sting();
    }
    if (v.phase === 'question' && old && old.phase === 'question' && old.answers && v.answers &&
        v.answers.count > old.answers.count) {
      sfx.blip();
    }
  }

  /* ------------------------------------------------------- view switching */
  const VIEWS = {
    connect: 'v-connect', lobby: 'v-lobby', intro: 'v-intro', question: 'v-question',
    reveal: 'v-reveal', leaderboard: 'v-leaderboard', section: 'v-section', podium: 'v-podium',
  };
  function showView(name) {
    for (const [k, id] of Object.entries(VIEWS)) $('#' + id).hidden = k !== name;
  }

  /* ------------------------------------------------------------- render */
  function render() {
    const v = V;
    if (!v) return;
    if (v.phase !== 'podium') resetPodium();
    const label = PHASE_NAME[v.phase] || v.phase;
    $('#phase-label').textContent = label + (v.round ? ' · Round ' + v.round.no + '/' + v.round.of : '');
    showView(VIEWS[v.phase] ? v.phase : 'connect');
    renderPanel(v);
    renderControls(v);
    switch (v.phase) {
      case 'lobby': return renderLobby(v);
      case 'intro': return renderIntro(v);
      case 'question': return renderQuestion(v);
      case 'reveal': return renderReveal(v);
      case 'leaderboard': return renderLeaderboard(v);
      case 'section': return renderSection(v);
      case 'podium': return renderPodium(v);
    }
  }

  function renderLobby(v) {
    const n = v.players.length;
    $('#joinurl').textContent = location.origin + '/';
    $('#lobby-count').textContent = n;
    $('#lobby-hint').hidden = n > 0;
    memo('lobby', JSON.stringify(v.players.map((p) => [p.name, p.connected])), () => {
      const box = $('#lobby-chips');
      const have = new Map($$('.chip', box).map((c) => [c.dataset.name, c]));
      const keep = new Set(v.players.map((p) => p.name));
      for (const [name, el] of have) if (!keep.has(name)) { el.remove(); have.delete(name); }
      v.players.forEach((p, i) => {
        let el = have.get(p.name);
        if (!el) el = h('span', { class: 'chip', 'data-name': p.name }, p.name); // only new chips animate
        el.classList.toggle('off', !p.connected);
        if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
      });
    });
  }

  function renderIntro(v) {
    const i = v.intro || {};
    memo('intro', JSON.stringify(i), () => {
      const box = $('#intro-rules');
      box.textContent = '';
      const rule = (title, text) => h('li', null, h('b', null, title), h('span', null, text));
      const qs = (n) => n + ' question' + (n === 1 ? '' : 's');
      box.append(rule(
        'Round 1: Is this from the Bible?',
        'A quote appears on this screen. Tap 📖 Bible or 💬 Not the Bible on your phone. ' +
          qs(i.yesnoRounds) + ', ' + i.yesnoSeconds + ' seconds each.'
      ));
      box.append(rule(
        'Round 2: Find the Bible verse',
        'Four quotes, one is really from the Bible. Tap the shape and colour that matches it. ' +
          qs(i.chooseRounds) + ', ' + i.chooseSeconds + ' seconds each.'
      ));
      box.append(rule('Be quick!', 'A right answer is 500 points, plus up to 500 more the faster you answer.'));
      if (i.doubleFromRound) {
        box.append(rule('Double points at the end', 'From question ' + i.doubleFromRound + ' every answer counts double.'));
      }
      box.append(rule('Play along out loud', 'Nobody sees the answers until the reveal, so guess together.'));
    });
  }

  function renderQuestion(v) {
    const q = v.question || {};
    const yesno = q.type === 'yesno';
    $('#q-round').textContent = 'Question ' + v.round.no + ' of ' + v.round.of;
    $('#q-dbl').hidden = !(v.round.multiplier > 1);
    $('#q-prompt').textContent = yesno ? 'Is this from the Bible?' : 'Which one is from the Bible?';
    $('#q-answered').textContent = v.answers ? v.answers.count : 0;
    $('#q-expected').textContent = v.answers ? v.answers.expected : 0;
    $('#q-yesno').hidden = !yesno;
    $('#q-choose').hidden = yesno;
    memo('question', JSON.stringify([q.qid, q.type, q.quote, (q.options || []).map((o) => o.quote)]), () => {
      if (yesno) {
        fitQuote($('#q-quote'), q.quote, 56, 40);
        return;
      }
      const box = $('#q-choose');
      box.textContent = '';
      (q.options || []).forEach((o, i) => {
        const txt = h('div', { class: 'txt' });
        box.append(h('div', { class: 'tile c' + i + ' fitbox' }, h('div', { class: 'sym' }, SHAPES[i]), txt));
        fitQuote(txt, o.quote, 34, 24);
      });
    });
  }

  function countRow(cls, symbol, label, count, total, correct) {
    const pct = total > 0 ? Math.round((100 * count) / total) : 0;
    const bar = h('i');
    bar.style.width = Math.max(pct, count > 0 ? 4 : 0) + '%';
    return h(
      'div',
      { class: 'crow ' + cls + (correct ? ' correct' : '') },
      h('span', { class: 'cl' }, symbol ? symbol + ' ' : '', label, correct ? ' ✓' : ''),
      h('span', { class: 'cb' }, bar),
      h('span', { class: 'cn' }, count)
    );
  }

  function renderReveal(v) {
    const q = v.question || {};
    const s = v.stats || {};
    const yesno = q.type === 'yesno';
    $('#r-round').textContent = 'Question ' + v.round.no + ' of ' + v.round.of;
    $('#r-dbl').hidden = !(v.round.multiplier > 1);
    $('#r-headline').textContent = yesno
      ? (q.correctAnswer === true ? 'Yes - this is in the Bible' : 'No - this is not in the Bible')
      : 'The Bible verse was number ' + (q.correctAnswer + 1);

    const fastest = (v.results || []).filter((r) => r.correct && r.ms != null)
      .sort((a, b) => a.ms - b.ms)[0];
    $('#r-fastest').textContent = fastest ? 'Fastest correct: ' + fastest.name : '';
    $('#r-note').textContent = q.note || '';

    memo('reveal', JSON.stringify([q, s]), () => {
      const body = $('#r-body');
      body.textContent = '';
      if (yesno) {
        const quote = h('blockquote', { class: 'bigquote' });
        body.append(h('div', { class: 'fitbox' }, quote));
        fitQuote(quote, q.quote, 48, 40);
        // the two answer areas again: the correct one marked, the other dimmed
        const yes = h('div', { class: 'yn yn-yes' + (q.correctAnswer === true ? ' right' : ' dim') },
          h('span', { class: 'sym' }, '📖'), h('span', { class: 'lab' }, 'Bible ' + (q.correctAnswer === true ? '✓' : '✗')));
        const no = h('div', { class: 'yn yn-no' + (q.correctAnswer === false ? ' right' : ' dim') },
          h('span', { class: 'sym' }, '💬'), h('span', { class: 'lab' }, 'Not the Bible ' + (q.correctAnswer === false ? '✓' : '✗')));
        body.append(h('div', { class: 'yn-row' }, yes, no));
        body.append(h(
          'div',
          { class: 'rv-card' },
          h('div', { class: 'rv-verdict right' }, (q.isBible ? '📖 In the Bible' : '💬 Not in the Bible')),
          h('div', { class: 'rv-source' }, q.source || (q.isBible ? 'The Bible' : 'Not a Bible verse'))
        ));
        const total = (s.bible || 0) + (s.notBible || 0) + (s.noAnswer || 0);
        const counts = h('div', { class: 'counts' });
        counts.append(countRow('yes', '📖', 'Bible', s.bible || 0, total, q.correctAnswer === true));
        counts.append(countRow('no', '💬', 'Not the Bible', s.notBible || 0, total, q.correctAnswer === false));
        if (s.noAnswer) counts.append(countRow('none', '…', 'No answer', s.noAnswer, total, false));
        body.append(counts);
        return;
      }
      // four-choice reveal: every option keeps its colour and shape, with its real source
      // and a bar showing how many players picked it
      const tiles = h('div', { class: 'tiles' });
      body.append(tiles); // in the document before the quotes are fitted, so they can be measured
      const opts = q.options || [];
      const optCounts = (s.options || [0, 0, 0, 0]);
      const voters = optCounts.reduce((a, b) => a + b, 0) + (s.noAnswer || 0);
      const fits = [];
      opts.forEach((o, i) => {
        const right = i === q.correctAnswer;
        const txt = h('div', { class: 'txt' });
        const count = optCounts[i] || 0;
        const bar = h('i');
        bar.style.width = (voters > 0 ? Math.max(Math.round((100 * count) / voters), count > 0 ? 5 : 0) : 0) + '%';
        const tile = h(
          'div',
          { class: 'tile c' + i + ' fitbox' + (right ? ' right' : ' dim') },
          h('div', { class: 'sym' }, SHAPES[i]),
          txt,
          h('div', { class: 'src' }, (right ? '✓ ' : '✗ ') + (o.source || (o.isBible ? 'The Bible' : 'Not a Bible verse'))),
          h('div', { class: 'pick' },
            h('span', { class: 'pb' }, bar),
            h('span', { class: 'pn' }, count + ' picked'))
        );
        tiles.append(tile);
        fits.push([tile, txt, o.quote]);
      });
      // fit once every tile exists, so the grid rows already have their real height
      for (const [tile, txt, quote] of fits) fitQuote(txt, quote, 28, 24);
      for (const [tile, txt, quote] of fits) {
        if (tile.scrollHeight <= tile.clientHeight + 1) continue;
        tile.classList.add('tight'); // very long quote: smaller source line, tighter padding
        fitQuote(txt, quote, 28, 24);
      }
      if (s.noAnswer) {
        body.append(h('p', { class: 'noanswer' }, s.noAnswer + ' player' + (s.noAnswer === 1 ? '' : 's') + ' did not answer'));
      }
    });
  }

  function renderLeaderboard(v) {
    const lb = v.leaderboard || { entries: [] };
    memo('leaderboard', JSON.stringify(lb), () => {
      const box = $('#lb-list');
      box.textContent = '';
      if (!lb.entries.length) box.append(h('p', { class: 'muted center' }, 'No scores yet.'));
      for (const e of lb.entries) {
        let mv = '–';
        let cls = 'same';
        if (e.prevRank == null) { mv = '★'; cls = 'up'; }
        else if (e.rank < e.prevRank) { mv = '▲'; cls = 'up'; }
        else if (e.rank > e.prevRank) { mv = '▼'; cls = 'down'; }
        const title = e.prevRank == null ? 'New on the leaderboard'
          : e.rank < e.prevRank ? 'Up from ' + ord(e.prevRank)
          : e.rank > e.prevRank ? 'Down from ' + ord(e.prevRank) : 'Same place';
        box.append(h(
          'div',
          { class: 'lrow' + (e.rank === 1 ? ' first' : '') },
          h('span', { class: 'lr' }, MEDAL[e.rank] || ord(e.rank)),
          h('span', { class: 'lm ' + cls, title: title }, mv),
          h('span', { class: 'ln' }, e.name, e.streak > 1 ? h('span', { class: 'streak' }, '🔥 ' + e.streak + ' in a row') : null),
          h('span', { class: 'lp' }, e.score)
        ));
      }
    });
    const extra = Math.max(0, (lb.playerCount || 0) - lb.entries.length);
    $('#lb-foot').textContent = extra ? 'and ' + extra + ' more player' + (extra === 1 ? '' : 's') : '';
  }

  function renderSection(v) {
    const s = v.section || {};
    $('#sec-kicker').textContent = 'Round ' + (s.number != null ? s.number : 2);
    $('#sec-title').textContent = s.title || 'Find the Bible verse';
    $('#sec-meta').textContent = s.rounds
      ? s.rounds + ' question' + (s.rounds === 1 ? '' : 's') + ', starting with question ' + s.firstRound
      : '';
  }

  /* -------------------------------------------------------------- podium */
  const pod = { revealed: 0, timer: null, done: false, key: '' };

  function resetPodium() {
    if (pod.timer) clearTimeout(pod.timer);
    pod.timer = null;
    pod.revealed = 0;
    pod.done = false;
    pod.key = '';
  }

  function podiumPlaces(v) {
    return (v.podium && v.podium.top) || [];
  }

  function podiumAdvance() {
    if (pod.timer) clearTimeout(pod.timer);
    pod.timer = null;
    const places = podiumPlaces(V);
    if (pod.revealed >= places.length) {
      pod.done = true;
      render();
      return;
    }
    pod.revealed += 1;
    const justShown = places[places.length - pod.revealed];
    const isWinner = justShown && justShown.rank === 1;
    sfx.fanfare(isWinner);
    if (isWinner) confetti();
    if (pod.revealed >= places.length) pod.done = true;
    render();
    schedulePodium();
  }

  function schedulePodium() {
    const places = podiumPlaces(V);
    if (pod.timer || pod.revealed >= places.length) return;
    sfx.drumroll(2.2);
    pod.timer = setTimeout(podiumAdvance, 2600);
  }

  function renderPodium(v) {
    const p = v.podium || { top: [], standings: [] };
    const places = p.top || [];
    const key = JSON.stringify(places);
    if (pod.key !== key) { // a fresh podium
      pod.key = key;
      pod.revealed = 0;
      pod.done = places.length === 0;
      if (pod.timer) clearTimeout(pod.timer);
      pod.timer = null;
      schedulePodium();
    }
    const shown = places.slice(places.length - pod.revealed);
    const nextPlace = places[places.length - pod.revealed - 1] || null;

    memo('podium', JSON.stringify([key, pod.revealed, pod.done]), () => {
      const root = $('#podium-root');
      root.textContent = '';
      const title = pod.done ? 'Final results 🏆'
        : nextPlace ? '🥁 Who finishes ' + ord(nextPlace.rank) + '?'
        : 'Congratulations!';
      root.append(h('h1', { class: 'pod-title' }, title));

      // classic layout: 2nd - 1st - 3rd, only for the places this game has
      const ranks = places.map((x) => x.rank);
      const cols = [2, 1, 3].filter((r) => ranks.includes(r));
      const board = h('div', { class: 'podium' });
      for (const rank of cols) {
        const place = shown.find((x) => x.rank === rank);
        if (place) {
          const names = place.players.map((x) => h('div', null, x.name));
          board.append(h(
            'div',
            { class: 'step' + (place.players.length > 3 ? ' many' : ''), 'data-rank': rank },
            h('div', { class: 'who' }, names),
            h('div', { class: 'block' }, h('div', null,
              h('div', { class: 'big' }, MEDAL[rank] || ord(rank)),
              h('div', { class: 'sc' }, place.players[0].score + ' pts')))
          ));
        } else {
          board.append(h(
            'div',
            { class: 'step waiting' + (nextPlace && nextPlace.rank === rank ? ' next' : ''), 'data-rank': rank },
            h('div', { class: 'who' }, ''),
            h('div', { class: 'block' }, h('div', { class: 'big' }, '?'))
          ));
        }
      }
      root.append(board);

      if (pod.done) {
        const rest = (p.standings || []);
        const box = h('div', { class: 'rest' }, h('h3', null, 'Full standings'));
        const chips = h('div', { class: 'chips' });
        for (const e of rest) chips.append(h('span', { class: 'chip' }, ord(e.rank) + ' ' + e.name + ' · ' + e.score));
        box.append(chips);
        if (rest.length) root.append(box);
      }
    });
  }

  /* -------------------------------------------------------------- panel */
  function renderPanel(v) {
    const players = v.players || [];
    $('#panel-count').textContent = '(' + players.length + '/' + (v.maxPlayers || 50) + ')';
    memo('panel', JSON.stringify(players), () => {
      const list = $('#plist');
      list.textContent = '';
      if (!players.length) list.append(h('p', { class: 'muted' }, 'Nobody has joined yet.'));
      for (const p of players) {
        list.append(h(
          'div',
          { class: 'prow' },
          h('span', { class: 'pd' + (p.connected ? ' on' : ''), title: p.connected ? 'online' : 'offline' }),
          h('span', { class: 'pn' }, p.name),
          h('span', { class: 'ps' }, p.score),
          h('button', {
            class: 'btn danger small', type: 'button', title: 'Remove ' + p.name,
            onclick: () => { if (confirm('Remove ' + p.name + ' from the game?')) act('kick', { playerId: p.id }); },
          }, '✕')
        ));
      }
    });
  }

  /* ----------------------------------------------------------- controls */
  function renderControls(v) {
    const sig = JSON.stringify([
      v.phase, (v.players || []).length, v.canSkip, v.isLastRound,
      v.leaderboard ? v.leaderboard.isLastRound : null, v.round ? v.round.no : null,
      v.section ? v.section.firstRound : null, pod.done, pod.revealed,
    ]);
    memo('controls', sig, () => {
      const box = $('#controls');
      box.textContent = '';
      // hot: keys that press this button (see the keydown handler); hint: what the button shows
      const B = (label, cls, fn, disabled, hot, hint) => h(
        'button',
        { class: 'btn ' + cls, type: 'button', onclick: fn, disabled: !!disabled, 'data-hot': hot || false },
        label, hint ? h('kbd', null, hint) : null
      );
      const resetBtn = B('↺ Reset', 'danger', () => {
        if (confirm('Reset the game? Scores go back to zero and everyone returns to the lobby.')) act('reset');
      });

      switch (v.phase) {
        case 'lobby': {
          const none = (v.players || []).length === 0;
          box.append(B('Start ▶', '', () => act('start'), none, 'space', 'Space'));
          if (none) box.append(h('span', { class: 'hint' }, 'Waiting for the first player to join…'));
          break;
        }
        case 'intro':
          box.append(B('Start question 1 ▶', '', () => act('next'), false, 'space', 'Space'), resetBtn);
          break;
        case 'question':
          box.append(
            B('⏭ End timer early', '', () => act('endEarly'), false, 'space e', 'Space / E'),
            B('＋' + (v.extraSeconds || 15) + ' seconds', 'teal', () => act('addTime'), false, 't', 'T'),
            B('Skip question', 'ghost', () => {
              if (confirm('Skip this question? Nothing from it will count.')) act('skip');
            }, !v.canSkip, 's', 'S'),
            resetBtn
          );
          break;
        case 'reveal':
          box.append(B('Show leaderboard 📊', '', () => act('next'), false, 'space', 'Space'), resetBtn);
          break;
        case 'leaderboard':
          box.append(
            B(v.leaderboard && v.leaderboard.isLastRound ? 'Show the podium 🏆' : 'Next question ▶',
              '', () => act('next'), false, 'space', 'Space'),
            resetBtn
          );
          break;
        case 'section':
          box.append(
            B('Start question ' + ((v.section && v.section.firstRound) || '') + ' ▶', '', () => act('next'), false, 'space', 'Space'),
            resetBtn
          );
          break;
        case 'podium':
          if (!pod.done) box.append(B('Skip ahead ⏩', 'teal', podiumAdvance, false, 'space', 'Space'));
          box.append(B('New game', 'ghost', () => {
            if (confirm('Start a new game? Everyone returns to the lobby with zero points.')) act('reset');
          }));
          break;
        default:
          box.append(resetBtn);
      }
    });
  }

  /* -------------------------------------------------------------- timer */
  let lastSecond = -1;
  function tick() {
    const el = $('#q-timer');
    if (!V || V.phase !== 'question' || !V.deadline) {
      el.style.visibility = 'hidden';
      lastSecond = -1;
      music.setUrgent(false);
      return;
    }
    el.style.visibility = '';
    const left = Math.max(0, V.deadline - (Date.now() + offset));
    const secs = Math.ceil(left / 1000);
    $('.t-num', el).textContent = secs;
    const used = 100 - Math.min(100, (100 * left) / (V.timerTotal || 1));
    $('.bar > i', el).style.transform = 'translateX(-' + used.toFixed(1) + '%)';
    const urgent = left <= 5000;
    el.classList.toggle('urgent', urgent);
    music.setUrgent(urgent);
    if (secs !== lastSecond && secs > 0 && secs <= 5) sfx.tick();
    lastSecond = secs;
  }
  setInterval(tick, 200);

  /* ------------------------------------------------------- top bar buttons */
  const soundBtn = $('#btn-sound');
  const paintSound = () => {
    soundBtn.textContent = sfx.muted ? '🔇' : '🔊';
    soundBtn.title = sfx.muted ? 'Sound effects are off (click to turn on)' : 'Sound effects are on (click to turn off)';
  };
  paintSound();
  soundBtn.addEventListener('click', () => {
    sfx.setMuted(!sfx.muted);
    sfx.unlock();
    paintSound();
  });

  const musicBtn = $('#btn-music');
  const paintMusic = () => {
    musicBtn.textContent = music.on ? '🎵' : '🎵✕';
    musicBtn.title = music.on ? 'Background music is on (click to turn off)' : 'Background music is off (click to turn on)';
  };
  paintMusic();
  musicBtn.addEventListener('click', () => {
    music.setOn(!music.on);
    paintMusic();
  });

  const volSlider = $('#vol-music');
  volSlider.value = Math.round(music.volume * 100);
  volSlider.addEventListener('input', () => music.setVolume(volSlider.value / 100));
  volSlider.addEventListener('change', () => volSlider.blur()); // so the shortcuts keep working

  const duckBtn = $('#btn-duck');
  function toggleDuck() {
    music.setDuck(!music.ducked);
    duckBtn.classList.toggle('on', music.ducked);
    duckBtn.title = music.ducked
      ? 'Music is quiet while you talk (click or press M to bring it back)'
      : 'Quiet the music while you talk (shortcut: M)';
  }
  duckBtn.addEventListener('click', toggleDuck);

  // on a short screen the players panel starts hidden, so the quotes get the full width
  if (window.innerHeight < 820) document.body.classList.add('nopanel');
  $('#btn-panel').addEventListener('click', () => document.body.classList.toggle('nopanel'));
  $('#btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });

  // keyboard: Space = main button, E = end early, T = +15 s, S = skip, M = quiet the music
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const name = e.key === ' ' ? 'space' : String(e.key).toLowerCase();
    if (name === 'm') {
      e.preventDefault();
      toggleDuck();
      return;
    }
    const btn = $$('#controls button[data-hot]').find((b) => !b.disabled && b.dataset.hot.split(' ').includes(name));
    if (!btn) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    btn.click();
  });

  // browsers only allow sound after a click on the page
  document.addEventListener('click', () => {
    document.body.classList.add('audio-on');
    sfx.unlock();
    music.unlock();
  }, { once: true });

  // keep the screen awake while hosting (best effort)
  async function keepAwake() {
    try {
      if (navigator.wakeLock) await navigator.wakeLock.request('screen');
    } catch (e) { /* not available */ }
  }
  keepAwake();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });

  // re-fit the quotes when the window changes size
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      sigs.question = null;
      sigs.reveal = null;
      render();
    }, 150);
  });

  showView('connect');
  showConnect('Connecting…', 'Getting the game ready.');
  connect();
})();
