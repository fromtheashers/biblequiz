# Improvement pass

## Step 1: baseline
Files created by this run: all app files (src/, public/, test/, questions.json, docs/, README.md, wrangler.jsonc, package.json).
- Bundle (worker upload): 121.15 KiB / gzip 29.87 KiB. Command: `npx wrangler deploy --dry-run --outdir <dir>` (WS-3 measurement).
- Static assets: public/ total 106,710 bytes uncompressed (`wc -c public/*`).
- Full-game e2e: 0 failures, 0 console errors (e2e-full-game.cjs).
- Host lobby: every player-list change rebuilds all chips and replays the 0.25 s pop animation on every chip (host.js renderLobby, shared.css .chip animation). Measured by: count of chip elements replaced when a 4th player joins = 4 (all), expected 1.
- Host toast: `.toast` fixed at bottom 22px, overlapping the control bar buttons (screenshot 08-question-choose-1920: toast covers "+15 seconds" and Skip).

## Step 2/3: candidates
IMP-1 · User experience
Finding: error toast is fixed at bottom:22px, on top of the host control bar, hiding "+15 seconds"/"Skip"/"Reset" while shown (WS-4 screenshots 08 and 09).
Change: position the toast above the control bar (e.g. bottom = control bar height + gap) and keep pointer-events off the toast so it never blocks clicks.
Impact: Medium. The host may need those buttons right when an error appears.
Risk: Low. CSS-only in shared.css/host.css-equivalent rule.
Verification: Playwright: trigger an error ack toast; toast bounding box does not intersect any visible control button; clicking "+15 seconds" while the toast is visible sends addTime.
Decision: EXECUTE.

IMP-2 · User experience / Performance
Finding: renderLobby rebuilds every chip when the player list changes (host.js:328-333), so all chips re-run the pop animation and flash each time anyone joins/disconnects.
Change: keyed update — reuse existing chip elements by name, only create (and animate) new ones, toggle `.off` in place, remove gone ones.
Impact: Low-Medium. Lobby looks calmer with 30-50 players joining.
Risk: Low. Single function, same output DOM.
Verification: Playwright with fake socket: after a 4th player joins, the first three chip nodes are the same objects (identity), only 1 new node; text and `.off` classes still match the view.
Decision: EXECUTE.

IMP-3 · Performance
Finding: `assets.run_worker_first: true` routes every static asset request through the Worker, counting against the 100k/day free request limit.
Change: use a route list for run_worker_first.
Decision: RECOMMEND. Fails condition 2 (configuration) and touches the host-page guard (security). Needs asher's OK; current usage per party (~50 phones x few assets) is far under the limit anyway.

IMP-4 · User experience
Finding: phone question screen shows the round label twice (header "Round 1 of 15" and "ROUND 1 OF 15").
Decision: RECOMMEND. Changes existing layout/wording (condition 4).
