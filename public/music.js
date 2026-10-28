/* Background music for the "Bible or Not?" host screen.
 * Adapted from the Nic Quiz host music. The tunes are made live with the Web Audio API
 * (original little loops, no audio files), so there is nothing to license or download.
 * Each phase gets its own loop:
 *   lobby / intro = bright and bouncy (quieter on the how-to-play slide),
 *   question      = driving and a bit tense (speeds up in the last 5 s),
 *   reveal / leaderboard / section = relaxed talking-time groove,
 *   podium        = silence (the podium has its own drumroll and fanfare).
 * Exposes window.BQMusic.
 */
(function () {
  'use strict';

  const X = null; // rest
  const MAJ = [0, 4, 7, 12];
  const MIN = [0, 3, 7, 12];
  const STEPS_PER_BAR = 16; // sixteenth notes
  const BARS = 4; // one chord per bar

  // Each pattern is one bar of 16 steps. bass: semitones above the chord root. arp: index into the chord tones.
  const TRACKS = {
    lobby: {
      bpm: 112, vol: 1, bassWave: 'triangle', arpWave: 'square', arpVol: 0.04, arpLen: 1.2,
      chords: [[48, MAJ], [45, MIN], [41, MAJ], [43, MAJ]], // C Am F G
      bass: [0, X, 12, X, 0, X, 12, X, 0, X, 12, X, 7, X, 12, X],
      arp: [0, X, 1, X, 2, X, 3, X, 2, X, 1, X, 2, X, 1, X],
      kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14],
    },
    question: {
      bpm: 128, vol: 0.95, bassWave: 'sawtooth', arpWave: 'square', arpVol: 0.035, arpLen: 0.9,
      chords: [[45, MIN], [41, MAJ], [43, MAJ], [40, MAJ]], // Am F G E
      bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12],
      arp: [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 3, 1],
      kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    },
    calm: {
      bpm: 100, vol: 0.7, bassWave: 'triangle', arpWave: 'triangle', arpVol: 0.08, arpLen: 2,
      chords: [[43, MAJ], [40, MIN], [48, MAJ], [50, MAJ]], // G Em C D
      bass: [0, X, X, X, X, X, 7, X, 0, X, X, X, X, X, 12, X],
      arp: [0, X, X, 1, X, X, 2, X, X, 3, X, X, 2, X, 1, X],
      kick: [0, 10], snare: [8], hat: [4, 12],
    },
  };

  // which track each game phase wants (anything missing = silence)
  const PHASE_TRACK = {
    lobby: 'lobby',
    intro: 'lobby',
    question: 'question',
    reveal: 'calm',
    leaderboard: 'calm',
    section: 'calm',
  };

  const KEY_ON = 'bq_host_music_on';
  let on = true;
  try { on = localStorage.getItem(KEY_ON) !== '0'; } catch (e) { /* ignore */ }

  const KEY_VOL = 'bq_host_music_vol';
  let vol = 1; // 0..1, the host's volume slider
  try {
    const v = parseFloat(localStorage.getItem(KEY_VOL));
    if (v >= 0 && v <= 1) vol = v;
  } catch (e) { /* ignore */ }
  let duck = false; // host is talking: music goes quiet
  let soft = false; // how-to-play slide: lobby tune, but quieter

  let ctx = null;
  let master = null;
  let noise = null;
  let want = null; // name of the track the game wants right now (or null for silence)
  let cur = null; // { name, t, gain }
  let step = 0;
  let nextT = 0;
  let urgent = false;
  let timerId = null;

  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // loudness of everything: on/off x slider x "host is talking"
  const masterLevel = () => (on ? 0.55 * vol * vol * (duck ? 0.25 : 1) : 0);
  const trackLevel = (tr) => tr.vol * (soft ? 0.45 : 1);
  const applyLevels = () => {
    if (!ctx) return;
    master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.08);
    if (cur) cur.gain.gain.setTargetAtTime(trackLevel(cur.t), ctx.currentTime, 0.4);
  };

  function ensure() {
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = masterLevel();
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuf() {
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  /* ---- voices (all take the time to start and the node to connect to) ---- */
  function note(freq, t, dur, type, level, dest, cutoff) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      o.connect(f);
      out = f;
    }
    out.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function kick(t, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + 0.25);
  }
  function hit(t, dest, type, freq, level, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  /* ---- sequencer ---- */
  const stepSeconds = (tr) => 60 / (tr.bpm * (urgent ? 1.18 : 1)) / 4;

  function playStep(c, i, t) {
    const tr = c.t;
    const s = i % STEPS_PER_BAR;
    const pair = tr.chords[Math.floor(i / STEPS_PER_BAR) % BARS];
    const root = pair[0];
    const tones = pair[1];
    const sec = stepSeconds(tr);
    const b = tr.bass[s];
    if (b !== X) note(hz(root + b), t, sec * 1.8, tr.bassWave, 0.2, c.gain, 700);
    const a = tr.arp[s];
    if (a !== X) note(hz(root + 24 + tones[a]), t, sec * tr.arpLen, tr.arpWave, tr.arpVol, c.gain, 3500);
    if (tr.kick.includes(s)) kick(t, c.gain);
    if (tr.snare.includes(s)) hit(t, c.gain, 'bandpass', 1900, 0.09, 0.13);
    if (tr.hat.includes(s)) hit(t, c.gain, 'highpass', 7500, 0.035, 0.04);
  }

  function pump() {
    if (!ctx || !cur) return;
    // if the page was frozen for a while, don't play a burst of old notes
    if (nextT < ctx.currentTime - 0.1) nextT = ctx.currentTime + 0.05;
    while (nextT < ctx.currentTime + 0.3) {
      playStep(cur, step, nextT);
      nextT += stepSeconds(cur.t);
      step = (step + 1) % (STEPS_PER_BAR * BARS);
    }
  }

  function stopTrack(c, fade) {
    if (!c) return;
    const now = ctx.currentTime;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setTargetAtTime(0, now, fade / 3);
    setTimeout(() => { try { c.gain.disconnect(); } catch (e) { /* already gone */ } }, fade * 1000 + 300);
  }

  function apply() {
    if (!ctx) return;
    const shouldPlay = on && want && TRACKS[want];
    if (!shouldPlay) {
      if (cur) { stopTrack(cur, 0.5); cur = null; }
      if (timerId) { clearInterval(timerId); timerId = null; }
      return;
    }
    if (!cur || cur.name !== want) {
      if (cur) stopTrack(cur, 0.4);
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(master);
      g.gain.setTargetAtTime(trackLevel(TRACKS[want]), ctx.currentTime, 0.1);
      cur = { name: want, t: TRACKS[want], gain: g };
      step = 0;
      nextT = ctx.currentTime + 0.08;
    }
    if (!timerId) timerId = setInterval(pump, 60);
    pump();
  }

  /* ---- public ---- */
  window.BQMusic = {
    get on() { return on; },
    setOn(v) {
      on = !!v;
      try { localStorage.setItem(KEY_ON, on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (ensure()) {
        applyLevels();
        apply();
      }
    },
    get volume() { return vol; },
    setVolume(v) {
      vol = Math.min(1, Math.max(0, Number(v) || 0));
      try { localStorage.setItem(KEY_VOL, String(vol)); } catch (e) { /* ignore */ }
      applyLevels();
    },
    get ducked() { return duck; },
    setDuck(v) {
      duck = !!v;
      applyLevels();
    },
    // call with the game phase: lobby | intro | question | reveal | leaderboard | section;
    // anything else (podium) is silence
    setPhase(phase) {
      const wasSoft = soft;
      soft = phase === 'intro';
      const name = PHASE_TRACK[phase] || null;
      if (soft !== wasSoft) applyLevels();
      if (name === want) return;
      want = name;
      urgent = false;
      if (ctx) apply();
    },
    // true while the last seconds of a timer are running: the music speeds up a little
    setUrgent(v) { urgent = !!v; },
    // browsers only allow sound after a click, so call this from a click handler
    unlock() {
      if (ensure()) apply();
    },
  };
})();
