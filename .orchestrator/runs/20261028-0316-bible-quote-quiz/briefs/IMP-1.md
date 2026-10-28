RUN: 20261028-0316-bible-quote-quiz
WORKSTREAM: IMP-1: Host screen polish (toast position, calmer lobby chips)

OBJECTIVE
The delivered host screen works; this pass removes two small annoyances the host would hit during a real party, without changing anything else.

TASK
Make exactly two changes to the host page:
A. The error toast (`.toast` in public/shared.css, shown by public/host.js on `ok:false` acks) currently sits at the bottom of the screen ON TOP of the host control bar, hiding buttons like "+15 seconds" and "Skip question" while it shows. Move it so it appears just above the control bar (never overlapping any control button at 1920x1080 or 1280x720), and give it `pointer-events: none` so it can never block a click.
B. `renderLobby` in public/host.js rebuilds every player chip whenever the player list changes, so all chips replay their pop-in animation each time someone joins or drops. Change it to a keyed update: keep existing chip elements (key by player name, which is unique), update the `off` class in place, append new chips (only these animate), remove chips for players who are gone, and keep the order of `v.players`.

CONTEXT
"Bible or Not?" is a Kahoot-style party game. The host page is plain HTML/CSS/vanilla JS (no framework, no build). Host page files: public/host.html, public/host.js, public/host.css, public/shared.css. The server sends `{type:'state', view}`; in the lobby `view.players` is `[{ id, name, connected, score, rank, streak }]`. Everything else on the page must behave exactly as before.
A full end-to-end test already exists: `/home/user/biblequiz/.orchestrator/runs/20261028-0316-bible-quote-quiz/e2e-full-game.cjs` (Playwright, starts `npx wrangler dev` on port 8799 in /home/user/biblequiz, plays a 15-round game with host + 3 phones, prints `{fails, errors}`). Run it with `cd /tmp/claude-0/e2e && node /home/user/biblequiz/.orchestrator/runs/20261028-0316-bible-quote-quiz/e2e-full-game.cjs` after `rm -rf /tmp/claude-0/e2e/state && mkdir -p /tmp/claude-0/e2e`. Playwright is preinstalled: `require('playwright')` works from any directory; do NOT run `playwright install`.

INPUTS
- /home/user/biblequiz/public/host.js (whole file)
- /home/user/biblequiz/public/shared.css, /home/user/biblequiz/public/host.css, /home/user/biblequiz/public/host.html
- /home/user/biblequiz/docs/protocol.md (section 6 for view shapes, skim)

SCOPE
Writable: /home/user/biblequiz/public/host.js, /home/user/biblequiz/public/shared.css, /home/user/biblequiz/public/host.css, and your own scratch directory outside the repo (e.g. /tmp/imp1-check/)
Read-only: everything else
Permitted special actions: run node scripts and Playwright from your scratch directory; run the e2e script above (it starts and stops wrangler dev itself); run `npm test` in /home/user/biblequiz. No npm install, no git commands.

BASELINE
- Toast: in the current page, when an error toast is visible, its bounding box intersects the control bar buttons (seen in screenshots at 1920x1080). Measure before your change: bounding-box intersection between `.toast` and every visible button in the control bar → expected "overlaps" now.
- Lobby chips: with the current page, when a 4th player is added to `view.players`, the number of chip DOM nodes that are NEW objects (not the same nodes as before) = 4. Measure with a Playwright script using a fake WebSocket (replace window.WebSocket via page.addInitScript, push `{type:'state', view}` frames; you may generate views with `import { createEngine } from '/home/user/biblequiz/src/engine.js'`). Record both numbers before changing anything.

OUTPUT
Edited files plus a short report.

ACCEPTANCE CRITERIA
1. With an error toast visible, its bounding box intersects no control-bar button at 1920x1080 and at 1280x720 (measured with the same method as the baseline), and the toast has `pointer-events: none`.
2. When a 4th player joins, exactly 1 chip node is new; the first 3 are the same DOM objects; when a player disconnects their chip gets the `off` class in place; when a player is kicked/removed their chip disappears; chip order matches `view.players`.
3. Nothing else changes: `node --check public/host.js` passes; `npm test` passes (60 tests); the e2e script prints `"fails": []` and `"errors": []`.

VERIFICATION
- Your before/after Playwright measurements for criteria 1 and 2 (same script, same method), with numbers.
- `cd /home/user/biblequiz && npm test` → pass.
- The e2e script → `fails: [] errors: []`.

STOP CONDITIONS
Stop and report BLOCKED if: either change needs edits outside the writable files; or the e2e script fails BEFORE your change (report its output).
