RUN: 20261028-0316-bible-quote-quiz
WORKSTREAM: WS-4: Host screen

OBJECTIVE
The host screen is what the whole room watches on the TV and what the host drives from a laptop, so it carries the Kahoot feel: big readable quotes, colourful answer tiles, a countdown, dramatic reveals, a leaderboard and a podium.

TASK
Build the host page: `public/host.html`, `public/host.js`, `public/host.css`, `public/music.js` (adapted from Nic Quiz) and `public/shared.css` (shared base styles and tokens; the phone page will NOT depend on it, it has its own copy of the tokens).

CONTEXT
SHARED UI CONTEXT (identical in WS-4 host brief and WS-5 phone brief)

Game: "Bible or Not?", a Kahoot-style party game for a church or family group (up to 50 players). One laptop drives a TV (the host page); players use their own phones (the phone page) after scanning a QR code. Rounds 1-6: one quote, "Is this from the Bible?" (answer Bible / Not the Bible, 15 s). Then a section slide "Round 2: Find the Bible verse". Rounds 7-15: four quotes, pick the one from the Bible (25 s). Correct answers score 500 + up to 500 for speed; rounds 13-15 score double. After each question: reveal (correct answer + verse reference or real source + fun note + how many picked each option), then leaderboard, then next. The game ends on a podium.

Architecture (locked): the server (a Cloudflare Durable Object, built by another worker in parallel) runs the game engine `src/engine.js` and talks to each browser over ONE WebSocket. The browser is a thin view: it renders the `view` object it receives in `{type:'state', view}` messages and sends commands. The full contract is `/home/user/biblequiz/docs/protocol.md`; read ALL of it (especially sections 3, 4, 6 and 7, and the JSON examples of every view). Field names in your code must match it exactly. Do not invent server messages.

- WebSocket URL: `(location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?role=player'` for phones, `...'/ws?role=host&key=' + encodeURIComponent(key)` for the host, where the host key is read from the page URL `?key=`.
- Reconnect with backoff (e.g. 0.5 s doubling to 5 s) whenever the socket closes, except after `kicked` or `replaced`. Show a small "Reconnecting…" banner while disconnected.
- Countdown: compute `offset = view.serverNow - Date.now()` on each state message; time left = `view.deadline - (Date.now() + offset)`; animate locally with requestAnimationFrame or a 100-250 ms interval.
- Plain HTML + CSS + vanilla JS (no framework, no build step, no CDN, no external fonts, no npm packages). Scripts are classic `<script src>` files wrapped in an IIFE with 'use strict', like the reference project. Use textContent (never innerHTML with server data), since names and quotes come from the network.
- Visual identity (keep host and phone consistent): dark background like Nic Quiz (`--bg: #0c1022`, card `#1b2250`, ink `#f5f6ff`, muted `#a6aedb`, with the same soft violet/teal radial gradients), system-ui font, bold rounded buttons. Answer colours, white text, each must reach at least 4.5:1 contrast with white:
  - Four-choice tiles in shown order 0-3: 0 red `#c8102e` with ▲, 1 blue `#1260be` with ◆, 2 gold `#8a6100` with ●, 3 green `#1d6f0a` with ■ (Kahoot style: colour + shape, so colour-blind players can tell them apart).
  - Yes/no: "Bible" violet `#5b34c4` with 📖, "Not the Bible" teal `#0f6b63` with 💬.
  - Correct = `#4be38a` accents with ✓, wrong = `#ff5c6c` with ✗.
- Wording: plain, friendly, short. Never show error codes; show the protocol's `error` text.
- Accessibility: buttons are real `<button>`s with visible focus styles; colour is never the only signal; `prefers-reduced-motion` reduces animations; `lang="en"`; sensible `<title>`.

Reference project (read-only): /home/user/nic-quiz — an earlier party game by the same owner with the same host/phone structure. Reuse its look, structure and proven patterns (helpers like `h()` and `$()`, LS wrapper for localStorage, section-per-phase with `hidden`, sound effects, music, podium drumroll). Its game logic (voting, judge) does NOT apply.

Testing without the server: the real server may not exist yet when you work. Verify your page with Playwright (preinstalled: `require('playwright')` works from any directory; `chromium.launch()` needs no options; do NOT run `playwright install`). Serve `/home/user/biblequiz/public` with a tiny static server you write in your scratch directory (Node `http` module), and in the browser replace `window.WebSocket` with a fake (via `page.addInitScript`) that records sent frames and lets your script push `{type:'state', view}` frames. Generate realistic views by running the real engine in Node: `import { createEngine } from '/home/user/biblequiz/src/engine.js'` with a small question fixture, drive it through every phase, and push `engine.hostView()` / `engine.playerView(connId)` to the page. Take screenshots of every phase at the required sizes and look at them. Keep all test scripts and screenshots in your scratch directory OUTSIDE the repo (e.g. /tmp/<workstream>-check/); do not add test files to the repo.


Host page specifics:
- Served at `/host?key=...` (the server serves `public/host.html` there after checking the key). Read the key from `location.search`. If the WebSocket is refused (closes before any state arrives) show "This host link is not right. Check the key at the end of the address." 
- Screens (one section per phase, like Nic Quiz's `views/host.html`): connecting; lobby (big QR code image `<img src="/qr.svg">`, the join address in large text = `location.origin + '/'`, "N players joined", player chips that pop in, Start button disabled until a player joins); intro "How to play" slide (text from `view.intro`: two kinds of rounds, timers, speed points, double points from round 13); question (round label "Question 3 of 15", "Is this from the Bible?" or "Which one is from the Bible?", the quote(s) in large type, countdown ring or bar, "N of M answered"; yes/no shows the quote plus the two answer areas Bible/Not the Bible; choose shows four coloured shaped tiles each with its quote text); reveal (correct answer highlighted, wrong ones dimmed, the reference or real source under EVERY quote for choose questions, the `note`, bars with counts per option, short "Fastest correct: Name" if derivable from `view.results`); leaderboard (top 5 with score and up/down movement from `prevRank`, animated); section slide ("Round 2: Find the Bible verse", "Four quotes, one is from the Bible. Find it!"); podium (reveal 3rd, then 2nd, then 1st with a drumroll and confetti, tied players share a step; a Skip ahead button; then full standings).
- Typography: readable from 3 m at 1920×1080: quote text at least 40 px for yes/no and at least 28 px on four-choice tiles (fit long quotes by scaling down within a minimum of 24 px rather than overflowing); round label at least 28 px.
- Controls (top bar or side panel, like Nic Quiz): main button (Start / Start question 1 / Next / Show leaderboard / Next question / Show the podium, label depends on phase), End timer early, +15 seconds, Skip question (disabled when `view.canSkip` is false), Reset (with a confirm dialog), Players panel toggle showing every player with online dot, score and a ✕ remove button (sends `kick` with `playerId`, confirm first), full-screen button, music on/off, music volume slider, quiet-music (duck) button, sound effects on/off. Keyboard shortcuts: Space = main button, E = end early, T = +15 s, S = skip, M = quiet the music; show them on the buttons. Show ack errors (`ok:false`) as a short toast.
- Music and sound: copy /home/user/nic-quiz/public/music.js into `public/music.js` and adapt it: expose the same object under a new name (e.g. `window.BQMusic`), map phases lobby/intro → lobby tune, question → answering tune (urgent in the last 5 s), reveal/leaderboard/section → relaxed tune, podium → silent (podium has its own drumroll/fanfare SFX). Remove the voting tune if unused. Sound effects (Web Audio, no files): tick in last 5 s, answer-received blip, reveal sting, drumroll + fanfare on podium. Audio starts only after the first click on the page (browser autoplay rules); show a hint "Click anywhere to enable sound" until then.
- Keep state across reconnects: the page simply re-renders from the next `state` message.

INPUTS
- /home/user/biblequiz/docs/protocol.md (whole file)
- /home/user/biblequiz/src/engine.js (for generating test views; read-only)
- /home/user/nic-quiz/views/host.html, /home/user/nic-quiz/public/host.js, /home/user/nic-quiz/public/shared.css, /home/user/nic-quiz/public/music.js

SCOPE
Writable: /home/user/biblequiz/public/host.html, /home/user/biblequiz/public/host.js, /home/user/biblequiz/public/host.css, /home/user/biblequiz/public/music.js, /home/user/biblequiz/public/shared.css, and your own scratch directory outside the repo
Read-only: everything else (including public/index.html, public/phone.js, public/phone.css, which another worker writes in parallel, and all of src/, docs/, test/)
Permitted special actions: run node scripts and Playwright from your scratch directory; start a temporary static server on a free port and stop it afterwards. No npm install, no git commands.

OUTPUT
The five files above, plus screenshots in your scratch directory listed in the report.

ACCEPTANCE CRITERIA
1. Host page renders every phase from the protocol (connecting, lobby, intro, question yes/no, question choose, reveal yes/no, reveal choose, leaderboard, section, podium) from real engine views, with quote text at least 40 px (yes/no) / at least 24 px (choose tiles) at 1920×1080 and no overflow or horizontal scroll at 1920×1080 and at 1280×720.
2. Lobby shows the QR code image, the join link, the player list with remove buttons and Start; the controls send the right protocol messages (verified by recorded frames): start, next, endEarly, addTime, skip, kick {playerId}, reset; keyboard shortcuts Space/E/T/S/M work.
3. Yes/no rounds show the quote with "Bible" / "Not the Bible" areas; four-choice rounds show four coloured, shaped tiles in the shown order. The reveal shows the correct answer, its reference or real source (every option's source for choose), the note, and how many picked each option.
4. The "Round 2: Find the Bible verse" section slide renders in the `section` phase.
5. Leaderboard shows the top 5 with movement arrows from `prevRank`; the podium reveals 3rd, 2nd, 1st in order, handles ties, and Skip ahead works.
6. Music and sound effects adapted from Nic Quiz's `music.js`, with on/off, volume and duck controls; no audio plays before the first user click; no console errors in any phase (checked in Playwright).
7. During the question phase nothing on the page reveals the correct answer (it cannot, because the view has no such data; also do not style tiles differently by index).
8. Reconnect banner appears when the fake socket closes and the page reconnects.

VERIFICATION
- Your Playwright script drives the engine through a full game (2-3 fake players, at least one yes/no and one choose round, the section slide and the podium), pushes each view to the page, asserts the visible text for each phase, records frames sent by the page for each control, checks console errors, and saves screenshots at 1920×1080 for every phase plus 1280×720 for the choose question and reveal. Look at every screenshot yourself and fix anything clipped or unreadable.
- `node --check public/host.js && node --check public/music.js` → no syntax errors.

STOP CONDITIONS
Stop and report BLOCKED if: docs/protocol.md is missing a field the screen needs (name the field and phase); or you would need to change any read-only file.
