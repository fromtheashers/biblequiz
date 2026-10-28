# Executive plan: 20261028-0316-bible-quote-quiz

## Objective
Build "Bible or Not?", a Kahoot-style party game: one big host screen plus players' phones (join by QR code). Players guess whether quotes come from the Bible. Rounds 1–6 are yes/no ("Is this from the Bible?"), rounds 7–15 show four quotes and players pick the one from the Bible. It must run on Vercel, borrowing the proven host/phone/podium design of Nic Quiz.

## Success criteria
1. `npm test` passes, covering the game engine (phases, both question types, speed scoring, leaderboard, podium, reconnects) and question-bank validation.
2. A full game (lobby → 6 yes/no rounds → 9 four-choice rounds → podium) plays end to end in a headless browser with one host and at least 3 phones, using the built-in local relay (no accounts needed).
3. Phones never receive which answer is correct before the reveal (checked by inspecting every message sent to the phone role in the end-to-end test).
4. The question bank has at least 8 yes/no and 12 four-choice items (15 used + spares). Every Bible quote has a verified chapter and verse that matches the chosen translation word for word; every non-Bible quote has a named real source; each entry has a source note in `docs/sources.md`.
5. The project deploys to Vercel with zero build configuration beyond `vercel.json` and two environment variables (`HOST_KEY`, `ABLY_API_KEY`), following step-by-step instructions in `README.md` written for a non-developer.
6. Host and phone pages work at 375 px phone width and 1920×1080 TV size with no horizontal scrolling.

## Scope
In: game engine, quote bank with sources, Vercel API functions, host screen, phone screen, background music and sounds (adapted from Nic Quiz), local dev server with a local relay, tests, README with Vercel + Ably setup steps, one pull request.
Out (non-goals): user accounts, saving scores between games, multiple simultaneous games, an admin page for editing questions (you edit `questions.json`), question photos, deploying to your Vercel account for you (you click Deploy; I give the steps).

## Assumptions
- Same scale as Nic Quiz: one game at a time, up to 50 players. Safe because the Ably free tier allows 200 simultaneous connections.
- Bible translation: King James Version (KJV), unless you choose otherwise. It is public domain (no copyright issues) and its "thee/thou" style makes Shakespeare-style decoys properly tricky.
- 15 rounds: 6 yes/no, then 9 four-choice. Timers 15 s (yes/no) and 25 s (four quotes, longer to read), changeable by environment variable. Answering ends early when everyone has answered.
- Content tone suits a church or family group: decoys are proverbs, philosophers, literature, famous people, and famous "sounds biblical but isn't" sayings ("God helps those who help themselves"). No quotes from other religions' scriptures, to stay respectful.
- You will create a free Ably account (about 2 minutes) and paste its API key into Vercel. Steps will be written out.

## Workstreams
| ID | Workstream | Deliverable | Model | Reason for model | Depends on | Writable files |
|---|---|---|---|---|---|---|
| WS-1 | Game engine and realtime protocol | Pure game engine (runs in the host browser, testable in Node), realtime client wrapper with Ably and local adapters, protocol doc, engine tests | opus | Core rules, scoring, anti-cheat (answer secrecy) and the contract every other workstream builds on | none | `public/lib/engine.js`, `public/lib/realtime.js`, `docs/protocol.md`, `test/engine.test.js` |
| WS-2 | Quote bank | Fact-checked `questions.json` (KJV verses with references, decoys with real sources) and a source log | opus | Data integrity: misattributed quotes are everywhere online and a wrong "answer" ruins the game | none | `questions.json`, `docs/sources.md`, `test/questions.test.js` |
| WS-3 | Vercel backend and local dev | `vercel.json`, `package.json`, API functions (Ably token with per-role permissions, host-only question delivery, QR code), local dev server with a WebSocket relay, README deploy guide | opus | Security (host key, token capabilities so phones cannot publish game state or read answers) and deployment correctness | none | `api/**`, `vercel.json`, `package.json`, `package-lock.json`, `dev-server.js`, `README.md`, `.gitignore` |
| WS-4 | Host screen | Big-screen UI: lobby + QR, how-to-play slide, question, live answer count, reveal with source, leaderboard, podium, host controls, music and sounds | sonnet | Well-specified UI build once the protocol is fixed | WS-1, WS-3 | `public/host.html`, `public/host.js`, `public/host.css`, `public/music.js`, `public/shared.css` |
| WS-5 | Phone screen | Join, waiting, yes/no buttons, four coloured quote tiles, answered/locked state, result (correct, points, rank), final placing, auto-rejoin | sonnet | Well-specified UI build once the protocol is fixed | WS-1, WS-3 | `public/index.html`, `public/phone.js`, `public/phone.css` |

## Execution order
Wave 1: WS-1, WS-2, WS-3 (parallel; writable files do not overlap). The question schema and endpoint/adapter interfaces are fixed in this plan so the three can work at once.
Wave 2: WS-4, WS-5 (parallel; need the accepted engine, protocol and dev server). `public/shared.css` belongs to WS-4; WS-5 reads it but styles itself in `phone.css`.
Then: I integrate, run the end-to-end browser test, commit, push to `claude/project-thread-ec34h6` and open a pull request.

Locked interfaces (all workers get these):
- Question schema: `{ "type": "yesno", "quote": "...", "isBible": true|false, "source": "John 3:16 (KJV)" | "Benjamin Franklin, Poor Richard's Almanack (1736)", "note": "optional fun fact" }` and `{ "type": "choose", "options": [ { "quote": "...", "isBible": true|false, "source": "..." } ×4 ], "note": "..." }` with exactly one `isBible: true` per choose item. File shape: `{ "translation": "KJV", "yesno": [...], "choose": [...] }`; the game uses the first N of each list and the rest are spares for "Skip question".
- Host is authoritative: the game engine runs in the host browser. The host loads questions from `GET /api/questions?key=HOST_KEY`. Phones get questions only through host messages, with no correctness data until the reveal.
- Realtime: `public/lib/realtime.js` exposes one interface over two adapters, Ably (production, token from `GET /api/token?role=host&key=…` or `?role=player&id=…`) and local (WebSocket relay in `dev-server.js`, chosen automatically when `/api/config` reports `{ "realtime": "local" }`).
- Scoring: correct answer = 500 + up to 500 for speed (linear over the timer), wrong or no answer = 0. Final 3 rounds score double. Answer streak shown but not scored.

## Acceptance criteria per workstream
WS-1
1. `public/lib/engine.js` is a dependency-free ES module with no DOM or network access; it imports cleanly in Node 18+ (`node -e "import('./public/lib/engine.js')"` exits 0).
2. Engine supports phases lobby → intro → question → reveal → leaderboard → … → podium, with skip, +time, end-early, reset, kick, and auto end when all connected players have answered.
3. The player-facing view function never includes `isBible`, `source` or the correct index while the phase is `question`; a test asserts this for both question types.
4. Scoring matches the plan formula, including double points in the final 3 rounds and ties sharing podium places; tests assert exact values.
5. Rejoin by player id keeps score; duplicate names (case- and look-alike-insensitive) are rejected; max 50 players.
6. `docs/protocol.md` lists every message (channel, event name, sender role, payload) and `realtime.js` implements both adapters behind the same interface.
7. `node --test test/engine.test.js` passes with at least 25 test cases.

WS-2
1. `questions.json` matches the locked schema; `node --test test/questions.test.js` validates schema, exactly one Bible option per choose item, no duplicate quotes, and at least 8 yes/no + 12 choose items.
2. Yes/no items are roughly balanced: between 40% and 60% are `isBible: true`.
3. Every Bible quote is word-for-word KJV (punctuation may be trimmed; ellipses allowed only at the start or end) and its reference is listed in `docs/sources.md` with a link to a KJV text source.
4. Every non-Bible quote names its real origin in `docs/sources.md` with a link, and flags well-known misattributions (for example "God helps those who help themselves", "Cleanliness is next to godliness", "This too shall pass").
5. Every quote is at most 160 characters so it fits on a phone tile.

WS-3
1. `GET /api/token?role=player` returns an Ably token request whose capability allows subscribe on the game channel and publish only on the answers channel; `role=host` without the correct key returns 401; key comparison is constant-time.
2. `GET /api/questions` without the correct key returns 401; with it returns `questions.json`. `questions.json` is not reachable as a static file.
3. `GET /api/config` returns the realtime mode and public URL; `GET /api/qr?url=…` returns an SVG QR code for the site's own origin only.
4. `npm run dev` starts `dev-server.js`, which serves `public/`, runs the `api/` handlers, and provides the local WebSocket relay so a game can be played with no Ably key.
5. `vercel.json` and `package.json` deploy on Vercel with Node 20 and no build command; dependencies limited to `ably`, `qrcode` and dev dependency `ws`.
6. `README.md` gives numbered, click-by-click steps for: Ably sign-up and API key, Vercel sign-up, importing the GitHub repo, adding `HOST_KEY` and `ABLY_API_KEY`, deploying, finding the host link, editing questions, and a rehearsal checklist.
7. Tests for the API handlers (`node --test test/api.test.js`) pass.

WS-4
1. Host page shows every phase from the protocol with readable text from 3 m away at 1920×1080 (quote text at least 40 px).
2. Lobby shows the QR code, join link, player list with remove buttons and Start; controls for end-early, +15 s, skip, next and reset work, with keyboard shortcuts as in Nic Quiz.
3. Yes/no rounds show the quote with "Bible" / "Not the Bible" answer areas; four-choice rounds show four coloured, shaped tiles (Kahoot style). The reveal shows the correct answer, its reference or real source, the note, and how many picked each option.
4. A clear "Round 2: Find the Bible verse" transition slide appears before round 7.
5. Leaderboard (top 5 with movement) after each reveal; podium reveals 3rd, 2nd, 1st like Nic Quiz.
6. Music and sound effects adapted from Nic Quiz's `music.js`, with mute and volume controls.

WS-5
1. Join with a name (max 15 characters); errors (duplicate name, game full, game already started) are shown in plain words.
2. Yes/no rounds show two big buttons; four-choice rounds show the four quotes on coloured tiles matching the host's colours and shapes; one tap locks the answer and shows "Answer locked in".
3. After the reveal the phone shows correct/wrong, points earned, total and rank; at the end shows final place.
4. Refreshing or losing connection rejoins automatically with the same score.
5. Layout works at 375×667 with no horizontal scroll and every tile at least 48 px tall.

## Risks and mitigations
- Vercel cannot keep a live game server or WebSockets running: the game runs in the host browser and messages go through Ably (built for this, free tier). Mitigation for local testing: a built-in local relay.
- Host browser refresh would lose the game: the engine state is saved to the host browser's local storage after every change and restored on reload.
- Misattributed or misquoted verses: opus worker with web verification, a source log for every quote, and my own spot check of every Bible reference.
- Phones peeking at answers: correctness data is never sent before the reveal, and phone tokens cannot publish game state (tested).
- Ably account is a setup step for you: written out step by step in the README.

## Decisions taken
- Host-authoritative game with Ably for realtime. Rejected: polling a Redis store from serverless functions (higher latency for speed scoring, would exhaust free Redis limits after a few games), and Socket.IO like Nic Quiz (Vercel does not support it). Trade-off: needs a free Ably account; the game lives in the host browser tab.
- Plain HTML/JS with ES modules, no framework or build step, like Nic Quiz. Rejected: Next.js. Trade-off: no component framework, but nothing to configure on Vercel.
- Phones show the full quote text on the tiles (unlike Kahoot, which shows only shapes), because quotes are long and players should not have to look up and down.
- Kahoot-style speed scoring (500 base + up to 500 speed). Rejected: Nic Quiz's vote-based scoring, which does not fit right/wrong answers.

## Improvement pass
Status: ON (the deliverable is application code)
After delivery checks pass, up to 3 low-risk application performance and user experience improvements are executed inside the files this run creates or changes. Changes to interfaces, schema, indexes, dependencies, configuration, security or user flows are listed as recommendations, not executed.

## Cost
5 delivery workers: 3 opus, 2 sonnet. Up to 3 improvement workers. Revision budget: 1 round per workstream.
