# Executive plan: 20261028-0316-bible-quote-quiz (v2, Cloudflare)

## Objective
Build "Bible or Not?", a Kahoot-style party game: one big host screen plus players' phones (join by QR code). Players guess whether quotes come from the Bible. Rounds 1–6 are yes/no ("Is this from the Bible?"), rounds 7–15 show four quotes and players pick the one from the Bible. It runs on Cloudflare (Workers + Durable Objects, one free account, no add-ons; plan v2 after asher ruled out extra services such as Ably), borrowing the proven host/phone/podium design of Nic Quiz.

## Success criteria
1. `npm test` passes, covering the game engine (phases, both question types, speed scoring, leaderboard, podium, reconnects), the Worker routes and question-bank validation.
2. A full game (lobby → 6 yes/no rounds → 9 four-choice rounds → podium) plays end to end in a headless browser with one host and at least 3 phones against `wrangler dev` running locally (no account needed).
3. Phones never receive which answer is correct before the reveal (checked by inspecting every message sent to the phone role in the end-to-end test).
4. The question bank has at least 8 yes/no and 12 four-choice items (15 used + spares). Every Bible quote has a verified chapter and verse that matches the chosen translation word for word; every non-Bible quote has a named real source; each entry has a source note in `docs/sources.md`.
5. The project deploys to Cloudflare Workers from the GitHub repo with one secret (`HOST_KEY`), following click-by-click instructions in `README.md` written for a non-developer. Players need no account or install.
6. Host and phone pages work at 375 px phone width and 1920×1080 TV size with no horizontal scrolling.

## Scope
In: game engine, quote bank with sources, Cloudflare Worker + Durable Object game server, host screen, phone screen, background music and sounds (adapted from Nic Quiz), tests, README with Cloudflare setup steps, one pull request.
Out (non-goals): player accounts, saving scores between games, multiple simultaneous games, an admin page for editing questions (you edit `questions.json`), question photos, deploying to your Cloudflare account for you (you click Deploy; I give the steps).

## Assumptions
- Same scale as Nic Quiz: one game at a time, up to 50 players. Safe on the Cloudflare free plan (Durable Objects with SQLite storage are included; WebSocket messages are billed at 20 per request against 100,000 free requests a day).
- Bible translation: King James Version (KJV), unless you choose otherwise. It is public domain (no copyright issues) and its "thee/thou" style makes Shakespeare-style decoys properly tricky.
- 15 rounds: 6 yes/no, then 9 four-choice. Timers 15 s (yes/no) and 25 s (four quotes, longer to read), changeable by environment variable. Answering ends early when everyone has answered.
- Content tone suits a church or family group: decoys are proverbs, philosophers, literature, famous people, and famous "sounds biblical but isn't" sayings ("God helps those who help themselves"). No quotes from other religions' scriptures, to stay respectful.
- You create one free Cloudflare account and connect the GitHub repo; steps will be written out. Players never sign up.

## Workstreams
| ID | Workstream | Deliverable | Model | Reason for model | Depends on | Writable files |
|---|---|---|---|---|---|---|
| WS-1 | Game engine and protocol | Pure game engine (no network, injectable clock), message protocol doc, engine tests | opus | Core rules, scoring, answer secrecy and the contract every other workstream builds on | none | `src/engine.js`, `docs/protocol.md`, `test/engine.test.js` |
| WS-2 | Quote bank | Fact-checked `questions.json` (KJV verses with references, decoys with real sources), source log, bank validation test | opus | Data integrity: misattributed quotes are everywhere online and a wrong "answer" ruins the game | none | `questions.json`, `docs/sources.md`, `test/questions.test.js` |
| WS-3 | Cloudflare game server | Worker (routes, static assets, host key, QR code), Durable Object `GameRoom` (WebSockets with hibernation, timers via alarms, state saved to storage), `wrangler.jsonc`, `package.json`, README deploy guide, Worker tests | opus | Security (host key, no answer leaks), Durable Object lifecycle (hibernation, alarms, persistence) and deployment correctness | WS-1 | `src/worker.js`, `src/game-room.js`, `src/qr.js`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `README.md`, `.gitignore`, `test/worker.test.js` |
| WS-4 | Host screen | Big-screen UI: lobby + QR, how-to-play slide, question, live answer count, reveal with source, leaderboard, podium, host controls, music and sounds | sonnet | Well-specified UI build once the protocol is fixed | WS-1 | `public/host.html`, `public/host.js`, `public/host.css`, `public/music.js`, `public/shared.css` |
| WS-5 | Phone screen | Join, waiting, yes/no buttons, four coloured quote tiles, answered/locked state, result (correct, points, rank), final placing, auto-rejoin | sonnet | Well-specified UI build once the protocol is fixed | WS-1 | `public/index.html`, `public/phone.js`, `public/phone.css` |

## Execution order
Wave 1: WS-1, WS-2 (parallel; writable files do not overlap; the question schema is locked below).
Wave 2: WS-3, WS-4, WS-5 (parallel; all build on the accepted engine and `docs/protocol.md`). `public/shared.css` belongs to WS-4; WS-5 reads it but styles itself in `phone.css`.
Then: I integrate, run the end-to-end browser test against `wrangler dev`, commit, push to `claude/project-thread-ec34h6` and open a pull request.

Locked interfaces (all workers get these):
- Question schema: `{ "type": "yesno", "quote": "...", "isBible": true|false, "source": "John 3:16 (KJV)" | "Benjamin Franklin, Poor Richard's Almanack (1736)", "note": "optional fun fact" }` and `{ "type": "choose", "options": [ { "quote": "...", "isBible": true|false, "source": "..." } ×4 ], "note": "..." }` with exactly one `isBible: true` per choose item. File shape: `{ "translation": "KJV", "yesno": [...], "choose": [...] }`; the game uses the first N of each list and the rest are spares for "Skip question". The file is bundled into the Worker and never served as a static file.
- Server is authoritative, like Nic Quiz: one Durable Object (`GameRoom`, single instance named "main") runs the engine and talks to every browser over one WebSocket each (`/ws`). The host authenticates with `HOST_KEY`; the server sends each role its own view. Phones get no correctness data until the reveal.
- Engine API: `createEngine({ questions, config, now })` returning an object with command methods (join, rename, answer, host actions) that return results/errors, `hostView()`, `playerView(playerId)`, `nextDeadline()`, `tick()` for timer expiry, and `toJSON()` / `fromJSON()` for saving and restoring state. No `Date.now()` or randomness inside except through injected `now` and `random`.
- Scoring: correct answer = 500 + up to 500 for speed (linear over the timer, measured on the server), wrong or no answer = 0. Final 3 rounds score double. Answer streak shown but not scored.

## Acceptance criteria per workstream
WS-1
1. `src/engine.js` is a dependency-free ES module with no DOM, network or global clock access; `node -e "import('./src/engine.js')"` exits 0.
2. Engine supports phases lobby → intro → question → reveal → leaderboard → … (a section-change slide before the first four-choice round) → podium, with skip, +15 s, end-early, reset, kick, and auto end when all connected players have answered.
3. `playerView` never includes `isBible`, `source` or the correct index while the phase is `question`; a test asserts this for both question types by scanning the serialized view.
4. Scoring matches the plan formula, including double points in the final 3 rounds and ties sharing podium places; tests assert exact values.
5. Rejoin by player token keeps score; duplicate names (case- and look-alike-insensitive) are rejected; max 50 players.
6. `toJSON()` → `fromJSON()` round-trips mid-question and the restored game continues correctly (tested).
7. `docs/protocol.md` lists every WebSocket message (direction, type, payload, which role) and every view shape.
8. `node --test test/engine.test.js` passes with at least 25 test cases.

WS-2
1. `questions.json` matches the locked schema; `node --test test/questions.test.js` validates schema, exactly one Bible option per choose item, no duplicate quotes, and at least 8 yes/no + 12 choose items.
2. Yes/no items are roughly balanced: between 40% and 60% are `isBible: true`.
3. Every Bible quote is word-for-word KJV (punctuation may be trimmed; ellipses allowed only at the start or end) and its reference is listed in `docs/sources.md` with a link to a KJV text source.
4. Every non-Bible quote names its real origin in `docs/sources.md` with a link, and flags well-known misattributions (for example "God helps those who help themselves", "Cleanliness is next to godliness", "This too shall pass").
5. Every quote is at most 160 characters so it fits on a phone tile.

WS-3
1. `npx wrangler dev` serves `public/` and the game; `/ws` upgrades to a WebSocket handled by the `GameRoom` Durable Object; `/host` requires the correct key (constant-time comparison) and `questions.json` is not reachable over HTTP.
2. Timers use Durable Object alarms and state is saved to Durable Object storage after every change, so a hibernation or restart resumes the game with scores intact.
3. Phones that send host-only commands, or messages over a size and rate limit, are rejected; tested.
4. `GET /qr.svg` returns a QR code for the site's own join URL (no arbitrary URLs).
5. `wrangler.jsonc` uses a SQLite-backed Durable Object migration so it deploys on the free plan; dependencies limited to `qrcode` plus dev dependencies `wrangler` and `ws` (for tests).
6. `README.md` gives numbered, click-by-click steps for: Cloudflare sign-up, connecting the GitHub repo in the Workers dashboard, setting the `HOST_KEY` secret, deploying, finding the player link and host link, editing questions, running locally, and a rehearsal checklist.
7. `node --test test/worker.test.js` passes (against the Worker running under `wrangler dev` or Miniflare).

WS-4
1. Host page shows every phase from the protocol with readable text from 3 m away at 1920×1080 (quote text at least 40 px).
2. Lobby shows the QR code, join link, player list with remove buttons and Start; controls for end-early, +15 s, skip, next and reset work, with keyboard shortcuts as in Nic Quiz.
3. Yes/no rounds show the quote with "Bible" / "Not the Bible" answer areas; four-choice rounds show four coloured, shaped tiles (Kahoot style). The reveal shows the correct answer, its reference or real source, the note, and how many picked each option.
4. A clear "Round 2: Find the Bible verse" transition slide appears before round 7.
5. Leaderboard (top 5 with movement) after each reveal; podium reveals 3rd, 2nd, 1st like Nic Quiz.
6. Music and sound effects adapted from Nic Quiz's `music.js`, with mute and volume controls; reconnects automatically if the WebSocket drops.

WS-5
1. Join with a name (max 15 characters); errors (duplicate name, game full, game already started) are shown in plain words.
2. Yes/no rounds show two big buttons; four-choice rounds show the four quotes on coloured tiles matching the host's colours and shapes; one tap locks the answer and shows "Answer locked in".
3. After the reveal the phone shows correct/wrong, points earned, total and rank; at the end shows final place.
4. Refreshing or losing connection rejoins automatically with the same score.
5. Layout works at 375×667 with no horizontal scroll and every tile at least 48 px tall.

## Risks and mitigations
- Durable Object hibernation drops in-memory state and timers: state is saved to storage after every change and timers use alarms (WS-3 criterion 2, tested).
- Cloudflare free-plan limits: one 15-question game with 50 players is a few thousand messages, far below the daily allowance. The README notes the limits.
- Misattributed or misquoted verses: opus worker with web verification, a source log for every quote, and my own spot check of every Bible reference.
- Phones peeking at answers: correctness data is never sent before the reveal (tested in the engine and in the end-to-end test).
- Cloudflare dashboard steps change over time: README written from Cloudflare's current docs, and I flag any step I could not verify.

## Decisions taken
- Cloudflare Workers + one Durable Object, server-authoritative like Nic Quiz (chosen by asher on 2026-10-28). Rejected: Vercel + Ably (extra account), Vercel + Redis polling (1 s delay, add-on), Render (sleeps). Trade-off: you move from Vercel to Cloudflare.
- Plain HTML/JS with ES modules, no framework or build step, like Nic Quiz. Rejected: a React/Next.js app. Trade-off: no component framework, but nothing to configure.
- Phones show the full quote text on the tiles (unlike Kahoot, which shows only shapes), because quotes are long and players should not have to look up and down.
- Kahoot-style speed scoring (500 base + up to 500 speed). Rejected: Nic Quiz's vote-based scoring, which does not fit right/wrong answers.

## Improvement pass
Status: ON (the deliverable is application code)
After delivery checks pass, up to 3 low-risk application performance and user experience improvements are executed inside the files this run creates or changes. Changes to interfaces, schema, indexes, dependencies, configuration, security or user flows are listed as recommendations, not executed.

## Cost
5 delivery workers: 3 opus, 2 sonnet. Up to 3 improvement workers. Revision budget: 1 round per workstream.
