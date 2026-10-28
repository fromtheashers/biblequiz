RUN: 20261028-0316-bible-quote-quiz
WORKSTREAM: WS-3: Cloudflare game server

OBJECTIVE
"Bible or Not?" is a Kahoot-style party game (host TV screen + players' phones) that must run on Cloudflare's free plan with one account, no add-ons, and players never signing up for anything. This workstream builds the server that runs the already-written game engine inside one Durable Object, serves the web pages, and documents deployment for a non-developer.

TASK
Build the Cloudflare Worker + Durable Object server, its config, tests and the README:
`src/worker.js`, `src/game-room.js`, `src/qr.js` (only if needed), `wrangler.jsonc`, `package.json` (extend the existing one), `package-lock.json`, `.gitignore`, `.dev.vars.example`, `README.md`, `test/worker.test.js`.

CONTEXT
Repository: /home/user/biblequiz (branch claude/project-thread-ec34h6). Node 22. Already present and ACCEPTED (read-only for you):
- `src/engine.js`: pure ES module game engine. `createEngine({ questions, config, now, random, state })` → `playerCommand(connId, msg)`, `hostCommand(msg)`, `disconnect(connId)`, `hostView()`, `playerView(connId)`, `nextDeadline()`, `tick()`, `version` (getter), `takeNotices()` → `[{connId, type:'kicked'|'replaced'}]`, `connIds()`, `toJSON()`, `fromJSON(obj)`. Inject `now = () => Date.now()` and a crypto-backed `random` (e.g. `crypto.getRandomValues(new Uint32Array(1))[0] / 2**32`).
- `docs/protocol.md`: THE contract for the server. Implement exactly what it specifies for the server side: endpoints `/ws?role=player` and `/ws?role=host&key=HOST_KEY` (HTTP 403 before upgrade on a wrong/missing key, constant-time comparison), every reply as `{type:'ack', for, ok, ...result}` (copy client `id` into the ack if present), `{type:'state', view}` to every socket after every change (host sockets get `hostView()`, player sockets get `playerView(connId)`, sockets with no player get nothing until they join), `{type:'kicked'}` / `{type:'replaced'}` notices from `takeNotices()` followed by closing those sockets, `{type:'error', code:'bad_message'|'rate_limited', error}` for non-JSON frames and rate limits. Read it fully.
- `questions.json` at the repo root (being written in parallel by another worker; if it does not exist yet when you start, use a small fixture in tests and import the real file in the Worker anyway). It must be bundled into the Worker with `import questions from '../questions.json'` and must NEVER be served over HTTP.
- `package.json` currently: `{ "name": "bible-or-not", "type": "module", "scripts": { "test": "node --test test/" }, "engines": { "node": ">=20" } }`. Keep `type: module` and the `test` script; add `dev`, `deploy`, dependencies.
- `test/engine.test.js`, `test/questions.test.js` exist or will exist; `npm test` runs all of `test/`.

Other workers are simultaneously writing the host page (`public/host.html`, `public/host.js`, `public/host.css`, `public/music.js`, `public/shared.css`) and the phone page (`public/index.html`, `public/phone.js`, `public/phone.css`). Do not create or edit anything in `public/`. If you need pages to exist for your own tests, create throwaway files only in your scratch area outside the repo, or test routes that do not need them.

Reference project (read-only): /home/user/nic-quiz. `server.js` and `lib/wire.js` are an Express + Socket.IO version of this server: host key check with timingSafeEqual, per-socket rate limiter (burst 20, refill 10/s), message size limits, QR code for the join URL, `/healthz`, cache headers. Port those ideas.

Locked decisions:
- Cloudflare Workers with Static Assets (`assets.directory = "./public"`) + ONE Durable Object class `GameRoom` (use `idFromName("main")`, one game at a time) with a SQLite-backed migration (`"migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }]`) so it runs on the Workers Free plan. Use the WebSocket Hibernation API (`this.ctx.acceptWebSocket(ws, [role])`, `webSocketMessage`, `webSocketClose`, `webSocketError`, `ws.serializeAttachment({ role, connId })` / `deserializeAttachment()`, `this.ctx.getWebSockets()`). `compatibility_date` = a recent date that Wrangler accepts (e.g. "2025-09-01" or later). Add `nodejs_compat` only if a dependency needs it.
- Persistence: after every change (engine.version changed), save `engine.toJSON()` to Durable Object storage (`this.ctx.storage.put('state', ...)`) and on construction restore it (`blockConcurrencyWhile`). Timers: after every change set `this.ctx.storage.setAlarm(engine.nextDeadline())` (or `deleteAlarm()` when null); `alarm()` calls `engine.tick()`, then broadcasts/saves if the version changed and re-arms. Because sockets survive hibernation, connIds live in socket attachments; on restore, mark players whose connId has no live socket as disconnected (call `engine.disconnect(connId)` for engine connIds missing from `getWebSockets()`).
- Routes (Worker): `/ws` → forward to the Durable Object (only WebSocket upgrades; else 426). `/host` → requires `?key=` matching `env.HOST_KEY` (constant-time); with the right key serve the asset `/host.html`; otherwise a short plain HTML page saying the link is wrong. Direct requests for `/host.html` must also be refused without the key (configure `assets.run_worker_first` for the routes the Worker must see, e.g. `["/ws", "/host", "/host.html", "/qr.svg", "/healthz", "/questions.json"]`, or equivalent). `/qr.svg` → SVG QR code of the join URL (the request's own origin + "/", or `env.PUBLIC_URL` if set), never an arbitrary URL from the query. `/healthz` → "ok". `/` and everything else → static assets (`public/index.html` is the phone page). `questions.json` must return 404.
- If `HOST_KEY` is not set, `/host` shows a plain message telling the owner to set the `HOST_KEY` secret in the Cloudflare dashboard (no default key in production). For local dev use `.dev.vars` (git-ignored) and commit `.dev.vars.example` containing `HOST_KEY=change-me`.
- Config from env vars (all optional, with defaults from the engine): `YESNO_SECONDS`, `CHOOSE_SECONDS`, `PUBLIC_URL`.
- Abuse limits: max frame size 2 KB, rate limit per socket (burst 20, refill 10/s) replying `rate_limited`, max 60 player sockets total (reject extra upgrades with 503), host sockets unlimited but authenticated.
- Dependencies: `qrcode` (runtime, for the SVG; check it bundles under Wrangler; if it does not, use another small pure-JS QR library and say which) plus dev dependencies `wrangler` and `ws` (for tests, if Node 22's global WebSocket client is not enough). Nothing else.
- Local dev: `npm run dev` = `wrangler dev` (local mode, no Cloudflare login). Deploy: `npm run deploy` = `wrangler deploy`.

README.md (written for someone who has never used a terminal, same friendly style as /home/user/nic-quiz/README.md, which you should read): what the game is and how a round works; "What is in the folder" table; "Put it online (Cloudflare)" with numbered click-by-click steps: create a free Cloudflare account, in the dashboard go to Workers & Pages → Create → Import a repository (connect GitHub, choose `biblequiz`), the build/deploy settings to enter (deploy command `npx wrangler deploy`, root directory, branch `main`), deploy, then add the `HOST_KEY` secret (Settings → Variables and Secrets → Add → type Secret) and redeploy if needed, find the `*.workers.dev` address, the player link and the host link `https://<address>/host?key=<your key>`. Check these steps against Cloudflare's current documentation with web fetch (https://developers.cloudflare.com/workers/ci-cd/builds/ and https://developers.cloudflare.com/workers/configuration/secrets/) and say in the README if any screen may be named differently. Also: "Running the game (host)" with controls and keyboard shortcuts as documented in docs/protocol.md (host page details are being built by another worker: describe Start, Next, End timer early, +15 seconds, Skip question, Reset, remove player; keyboard shortcuts Space = main button, E = end early, T = +15 s, S = skip, M = quiet music), "Changing the questions" (edit questions.json on GitHub; rules from docs/sources.md: KJV word for word, exactly one Bible quote per four-quote question, run `npm test`), "Run it on your own computer" (install Node.js LTS, `npm install`, copy `.dev.vars.example` to `.dev.vars`, `npm run dev`, open the printed address and `/host?key=change-me`), free-plan limits in plain words, and "Good to know" (one game at a time; the game survives a host screen refresh; redeploying during a game may reset it).

INPUTS
- /home/user/biblequiz/docs/protocol.md (whole file)
- /home/user/biblequiz/src/engine.js (whole file)
- /home/user/biblequiz/package.json
- /home/user/nic-quiz/server.js, /home/user/nic-quiz/lib/wire.js, /home/user/nic-quiz/README.md

SCOPE
Writable: /home/user/biblequiz/src/worker.js, /home/user/biblequiz/src/game-room.js, /home/user/biblequiz/src/qr.js, /home/user/biblequiz/wrangler.jsonc, /home/user/biblequiz/package.json, /home/user/biblequiz/package-lock.json, /home/user/biblequiz/node_modules/ (via npm install only), /home/user/biblequiz/.gitignore, /home/user/biblequiz/.dev.vars.example, /home/user/biblequiz/.dev.vars (local only, git-ignored), /home/user/biblequiz/README.md, /home/user/biblequiz/test/worker.test.js
Read-only: everything else (src/engine.js, docs/, questions.json, test/engine.test.js, test/questions.test.js, public/, /home/user/nic-quiz)
Permitted special actions: `npm install qrcode` and `npm install -D wrangler ws` (and only these packages, or the one replacement QR library if qrcode does not bundle) in /home/user/biblequiz; run `npx wrangler dev` / `npx wrangler deploy --dry-run --outdir <scratch dir outside repo>` locally; run `npm test`; web fetch of developers.cloudflare.com pages. No `wrangler login`, no real deploy, no git commands.

OUTPUT
The files above. `.gitignore` must include node_modules/, .dev.vars, .wrangler/.

ACCEPTANCE CRITERIA
1. `npx wrangler dev` serves `public/` and the game; `/ws` upgrades to a WebSocket handled by the `GameRoom` Durable Object; `/host` and `/host.html` require the correct key (constant-time comparison); `questions.json` is not reachable over HTTP (404).
2. Timers use Durable Object alarms and state is saved to Durable Object storage after every change, so a hibernation or restart resumes the game with scores intact (test: restart `wrangler dev` mid-game, or otherwise prove restore, and scores are intact).
3. Phones that send host-only commands get `unknown_type` (player sockets are only routed to `playerCommand`); non-JSON frames get `bad_message`; frames over 2 KB and bursts over the rate limit are rejected; wrong host key gets 403. Tested.
4. `GET /qr.svg` returns an SVG QR code for the site's own join URL and ignores any query parameters.
5. `wrangler.jsonc` uses a SQLite-backed Durable Object migration; `npx wrangler deploy --dry-run --outdir <scratch>` succeeds; dependencies limited to `qrcode` (or one replacement) plus dev dependencies `wrangler` and `ws`.
6. `README.md` gives numbered, click-by-click steps for: Cloudflare sign-up, connecting the GitHub repo in the Workers dashboard, setting the `HOST_KEY` secret, deploying, finding the player link and host link, editing questions, running locally, and a rehearsal checklist.
7. `node --test test/worker.test.js` passes; it starts `wrangler dev` on a free port itself (or uses Miniflare from wrangler), plays at least: host connect, 2 players join, start, answer a yes/no question, reveal shows correct points, plus the security checks in criterion 3; and it shuts the dev server down afterwards. `npm test` passes as a whole (if questions.test.js does not exist yet, say so).
8. Player views sent over the wire during the `question` phase contain none of `isBible`, `source`, `note`, `correctAnswer` (assert in the test by inspecting the raw frames a player receives).

VERIFICATION
- `cd /home/user/biblequiz && node --test test/worker.test.js` → pass.
- `npm test` → pass (report each file's result).
- `npx wrangler deploy --dry-run --outdir /tmp/ws3-dry` → succeeds; report bundle size.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/questions.json` → 404; `/host` without key → not the host page; `/host?key=<.dev.vars key>` → 200 host page (if public/host.html does not exist yet, report the asset 404 as expected).

STOP CONDITIONS
Stop and report BLOCKED if: `npm install` cannot reach the registry; `wrangler dev` cannot run in this environment at all (report the exact error; do not fall back to a different hosting model); the protocol in docs/protocol.md cannot be implemented as written; or you would need to change any read-only file (for example the engine).
