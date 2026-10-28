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
