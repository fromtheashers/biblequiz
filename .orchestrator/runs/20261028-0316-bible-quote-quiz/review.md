# Review

## WS-1 (opus) — ACCEPTED, 0 revisions
1. Pure module: PASS. grep for Date.now/Math.random/crypto/setTimeout/document/window/fetch( → no matches; import prints function (worker), source read in full by orchestrator.
2. Phases + host controls: PASS. hostNext switch (engine.js:444-472) covers intro→question→reveal→leaderboard→section(after yesno when both types)→podium; endEarly/addTime/skip/kick/reset at 474-524; maybeAutoEnd 409-418.
3. Secrecy: PASS. publicQuestion (618-621) sends only quote text/order; base() carries no correctness; revealedQuestion only from reveal. Test scans views.
4. Scoring: PASS. scoreFor 142-146, multiplier 327, competition ranking 315-322; tests 43/43 re-run by orchestrator.
5. Join rules: PASS. playerJoin 528-566 (token, nameKey NFKC, offline takeover, room_full, game_over).
6. toJSON/restore: PASS. fromJSON 864-872; round item deep-copied into state (341). Test re-run passes.
7. protocol.md: PASS. Sections 3, 4.1-4.3, 6.x examples, 7, 8 present.
8. ≥25 tests: PASS. `node --test test/engine.test.js` → 43 pass 0 fail (orchestrator run).
Scope: only src/, docs/protocol.md, test/engine.test.js new (git status). Worker ran a read-only git status (not permitted, harmless) — noted.
Observations for wave 2: server must implement ack envelope, id echo, replaced/kicked notices via takeNotices(), rate_limited, 403 on bad host key.

## WS-2 (opus) — ACCEPTED, 0 revisions (orchestrator polish applied)
1. Schema + validator: PASS. `node --test test/questions.test.js` → 6 pass 0 fail (orchestrator run).
2. Balance: PASS. 6/12 Bible (first six used: 3/3).
3. Bible quotes KJV: PASS. Orchestrator read all 20 verses and checked each against known KJV wording (Prov 16:18, Rom 6:23, Job 19:20, Prov 15:1, Prov 6:27, Jer 8:22, Mt 22:39, Num 32:23, Lk 4:23, Eccl 3:1, Gal 6:7, Mt 4:4, Eccl 11:1, Eccl 9:11, Prov 6:6, Prov 13:12, Prov 15:17, Eccl 4:12, Prov 26:5, 1 Cor 13:12) — all match; each row in sources.md has a Bible Gateway link.
4. Decoy origins + misattributions: PASS. Y2/Y4/Y5 notes say not in the Bible; every decoy row has a URL.
5. Lengths: PASS (test enforces).
6. No other scriptures/Apocrypha: PASS (orchestrator read full list).
Polish (Phase 5 style, by orchestrator): 5 trimmed Bible options (C4, C8, C9, C10, C14) lacked a final full stop while every decoy had one — a visual tell. Added "." to those 5 and documented the rule in docs/sources.md. Test re-run: pass.

## WS-3 (opus) — ACCEPTED, 0 revisions (README control labels to re-check vs host.js in Phase 5)
1. Routes/host guard/questions 404: PASS. worker.js:43-55 normalises host path variants; hostPage 79-101; questions.json 404 at 138; test suite re-run.
2. Alarms + persistence: PASS. game-room.js save() after every change (198-204), arm() setAlarm/deleteAlarm (146-152), restore + stale-conn disconnect in constructor (105-121); worker test 7 (restart) passes in orchestrator run.
3. Security: PASS. Player sockets only reach playerCommand (271-273); 2KB limit 251; rate limiter 60-71; 403 key in worker and DO. Tests pass.
4. QR: PASS. joinUrl ignores query (57-68).
5. SQLite migration + dry run: PASS. Orchestrator ran `npx wrangler deploy --dry-run` → succeeded, bindings GAME_ROOM + ASSETS. deps: qrcode; dev: wrangler, ws.
6. README: PASS (sections A–F, rehearsal, questions, local run). Note: README assumes branch main — true once PR is merged.
7. Tests: PASS. `npm test` → 60/60 (orchestrator run).
8. Secrecy on the wire: PASS (worker tests 6, 8).
Deviation accepted: test script `node --test test/*.test.js` (Node 22 directory arg fails).

## WS-4 (sonnet; harness fell back to Opus 5 mid-run) — ACCEPTED, 0 revisions
1-8: PASS. Orchestrator viewed screenshots (choose question/reveal 1920) and ran a REAL end-to-end game against `wrangler dev` (see e2e-full-game.cjs): host + 3 phones, 15 rounds incl. section slide, podium. Host screens rendered correctly (lobby QR + join link, reveal with sources/counts, podium with standings). 0 console/page errors.
Observed: error toast sits over the control bar (covers buttons while shown) — UX polish candidate. Lobby chips all re-animate when the player list changes — polish candidate.

## WS-5 (sonnet) — ACCEPTED, 0 revisions
1-6: PASS. Orchestrator viewed 375px screenshots (join, yes/no, choose with 160-char quotes) and in the real e2e run: 3 phones joined, answered 15 rounds via tap, got reveal cards (e.g. "Correct! +978 points, 1st of 3", Proverbs 16:18 source), podium text, refresh at podium rejoined. No secret keys in any question-phase frame (framereceived scan). 0 console errors.

# Phase 5 integration
- Real full game e2e against wrangler dev: fails [] errors [] (orchestrator run, /tmp/claude-0/e2e/e2e.cjs, copy in run folder).
- npm test: 60/60.
- Cross-checks: README controls/shortcuts (Space/E/T/S/M, Start/Next/End timer early/+15 seconds/Skip/Reset) match host.js labels; podium button "New game" sends reset. Phone and host colours/shapes consistent (▲◆●■, same hexes).
- Success criteria: 1 MET (60 tests), 2 MET (e2e 15 rounds), 3 MET (frame scan + worker tests 6/8), 4 MET (12 yes/no + 14 choose, sources.md), 5 MET (README + dry run), 6 MET (WS-4/WS-5 viewport checks + e2e at 375 and 1920).

## IMP-1 — KEPT, 0 revisions (see improvements.md)
