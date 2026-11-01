## Result
- questions.json: 70 new items (28 yes/no, 42 choose), none from the old bank.
- docs/sources.md: one row per quote (196), updated rules.
- src/engine.js + test/engine.test.js: random deck per game, no repeats in a room until the pool is used, skip draws from the deck, old saves still load.
- README.md, docs/protocol.md: describe the random draw and the trickier questions.
- test/questions.test.js: bank size at least 28/42.

## Success criteria
1. 28 + 42 items, npm test passes: MET (65/65).
2. Every Bible quote exact KJV in two texts: MET (verify.py PASS).
3. No decoy in KJV: MET (verify.py). Outside-source check: PARTIAL; most wording checked from knowledge because the shared web budget ran out (disclosed in sources.md rows).
4. >=60% songs/films/speeches/famous quotes or Bible: MET (75.5%; songs 41% of decoys).
5. Style not a giveaway in >=36/42: MET (41/42 by heuristic).
6. Random draw: MET (tests a-e).
7. Docs: MET.

## Improvements: skipped (content run, improvement pass OFF)

## Deviations
- Worker prompts pointed to brief files instead of inlining.
- WS-1 restarted after an output filter cut-off; WS-2/3 resumed after usage limit; lyric rule tightened (no lyric pages, one short line).
- Orchestrator replaced 10 cross-writer duplicates and fixed 2 lyric wordings itself.
- WS-5 fact-check was mostly knowledge-based (fetch budget); 1 fix applied.

## Run record
WS-1 opus ACCEPTED (1 restart) · WS-2 opus ACCEPTED after integration fixes · WS-3 opus ACCEPTED after integration fixes · WS-4 sonnet ACCEPTED · WS-5 sonnet PARTIAL
