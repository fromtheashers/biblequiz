# Executive plan: 20261101-1224-harder-lyric-questions

## Objective
Replace the question bank with 70 much harder questions (28 yes/no, 42 pick-one), where real KJV verses sound like pop lyrics, film lines or famous quotes and the decoys sound like the King James Bible. Each game draws its questions at random from the pool, so the game is replayable. Every answer must still be provably right.

## Revision v2 (asher, 2026-11-01 12:59 UTC)
asher approved the content direction and asked for a 70-question pool with 15 random questions drawn per game.

## Success criteria
1. `questions.json` has exactly 28 yes/no and 42 choose items, none from the old bank, and `npm test` passes.
2. Every Bible quote is an exact substring of its cited verse in two independent KJV texts (`verify.py`).
3. Every non-Bible quote does not appear in the KJV (`verify.py`), and its wording and source are checked against an outside source.
4. At least 60% of all quotes are song lyrics, film/TV lines, speeches or famous quotes, or Bible verses that sound like (or are known from) one.
5. In at least 36 of the 42 choose items, style does not give the answer away (`verify.py` style check plus my read).
6. Each new game picks 6 yes/no and 9 choose items at random; a room does not repeat a question until it has used the whole pool of that type; Skip draws a random unused question; a saved game restores with the same questions.
7. `docs/sources.md` has one row per quote with a verification URL; README and docs/protocol.md describe the random draw.

## Scope
In: `questions.json`, `docs/sources.md`, `README.md`, `docs/protocol.md`, `src/engine.js`, `test/engine.test.js`, `test/questions.test.js`.
Out (non-goals): timers, scoring, number of rounds per game (still 6 + 9), UI, worker/room code.

## Assumptions
- 70 is split 28 yes/no + 42 choose, the same 6:9 ratio the game uses, so both types last equally long before repeating.
- "15 random questions" keeps the two halves (6 yes/no then 9 pick-one), as today.
- Replayable means no repeats inside one room until that pool is used up. The used list lives in the room's saved state.
- Song lyrics are one short line each (under 20 words).

## Workstreams
| ID | Workstream | Deliverable | Model | Reason | Depends on | Writable files |
|---|---|---|---|---|---|---|
| WS-1 | 28 yes/no items | content/yesno.json + content/sources-yesno.md | opus | Taste plus strict fact-checking | none | run folder content/yesno*, content/sources-yesno.md |
| WS-2 | 21 choose items (set A) | content/choose-a.json + sources | opus | same | none | run folder content/choose-a*, content/sources-choose-a.md |
| WS-3 | 21 choose items (set B) | content/choose-b.json + sources | opus | same | none | run folder content/choose-b*, content/sources-choose-b.md |
| WS-4 | Random draw per game | engine change + tests + docs | sonnet | Well-specified engine change | none | src/engine.js, test/engine.test.js, docs/protocol.md, README.md |
| WS-5 | Independent fact-check | read-only verdict per quote | sonnet | Checking against a list | WS-1..3 | run folder reports/ws5-* |
Integration (me): merge fragments into questions.json and docs/sources.md, update bank-size test, run verify.py and npm test.

## Execution order
Wave 1: WS-1, WS-2, WS-3, WS-4 in parallel (no shared writable files; Bible books and headline decoys are split between WS-1..3 to avoid duplicates).
Wave 2: WS-5. Fixes go back to WS-1..3 as their revision round.

## Acceptance criteria per workstream
WS-1..3
1. `python3 -I verify.py <fragment>` reports RESULT PASS.
2. Exact item count, schema matches `test/questions.test.js` rules plus a `category` field per quote; quotes at most 160 chars, notes at most 140.
3. Only Bible verses from the assigned books; no quote from the old bank.
4. Category share and style criteria (success criteria 4 and 5) hold for the fragment.
5. Sources fragment has one row per quote with a URL.
WS-4
1. `npm test` passes, with new tests for: random pick, no repeats until pool used, skip draws unused, restore keeps questions, old saved state still loads.
2. Only its writable files change.
WS-5
1. Every non-Bible quote has PASS, FIX or DROP with a URL; every Bible reference re-checked.

## Risks and mitigations
- Misremembered lyrics or misattributed quotes: WS-5 checks each against an outside source; uncertain items are dropped.
- Decoy that is really KJV ("Let it be", "eat, drink, and be merry"): verify.py full-KJV check.
- Songs that quote the Bible word for word: count as Bible only if the shown words are exact KJV; the note names the song.
- Duplicates across the three writers: books and headline ideas are split; verify.py run on all fragments together at merge.

## Decisions taken
- Rewrite the whole bank. Rejected: keeping the easy items.
- No modern-translation gotchas and no meaning-changing snippets.
- No repeats within a room until the pool runs out. Rejected: pure random each game. Trade-off: a little more saved state.

## Improvement pass
Status: OFF (the deliverable is quiz content, not application code)

## Cost
5 workers: 3 opus, 2 sonnet. Revision budget: 1 round per workstream.

## Example of the direction (not final)
- Bible, sounds like a love song: "Many waters cannot quench love, neither can the floods drown it." (Song of Solomon 8:7)
- Bible, sounds like a rap line: "Wine maketh merry: but money answereth all things." (Ecclesiastes 10:19)
- Bible, known from a disco hit: "By the rivers of Babylon, there we sat down" (Psalm 137:1, Boney M)
- Not Bible, sounds like Revelation: "Woe to you, oh earth and sea, for the Devil sends the beast with wrath" (Iron Maiden intro)
- Not Bible, sounds like a prophet: "Things fall apart; the centre cannot hold" (W. B. Yeats, 1919)
- Not Bible, sounds like Psalms: "What we do in life echoes in eternity" (Gladiator, 2000)
