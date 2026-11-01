# Executive plan: 20261101-1224-harder-lyric-questions

## Objective
Replace the whole question bank with a much harder one, where real KJV verses sound like pop lyrics, film lines or famous quotes, and the decoys are pop lyrics, hymns, speeches and famous quotes that sound like the King James Bible. Every answer must still be provably right, so nobody at the party can argue with the reveal.

## Success criteria
1. `questions.json` is fully rewritten: no quote from the current bank survives, at least 12 yes/no and 14 choose items (same as now), and `npm test` passes.
2. Every Bible quote is an exact substring of the KJV verse it cites, checked by script against two independent KJV texts.
3. Every non-Bible quote is checked by script to not appear anywhere in the KJV (normalised, across verse boundaries), and its wording and source are checked against a real source.
4. At least 60% of all items (counting each choose option) are song lyrics, film/TV lines, speeches, or famous quotes, or Bible verses known from songs/speeches. The rest may be hymns, poems and literature that sound biblical.
5. Style no longer gives the answer away: in at least 10 of the 14 choose items, at least one decoy uses archaic or KJV-like wording (thou, -eth, lo, shall, woe, etc.) or the Bible option has no archaic word at all.
6. `docs/sources.md` has one row per quote with a verification URL and note, and the README line describing the game mentions songs and famous quotes.

## Scope
In: `questions.json`, `docs/sources.md`, one sentence in `README.md`.
Out (non-goals): game rules, timers, scoring, number of rounds, UI, engine code, tests.

## Assumptions
- "Go through the questions" means replace every current item, not add to them. The old items are easy because they are well-known proverbs.
- Bible text stays KJV, word for word, under the existing rules in `docs/sources.md`.
- Song lyrics are limited to one short line each (under 20 words). That keeps the quiz readable on a TV and keeps quoting to a minimum.

## Workstreams
| ID | Workstream | Deliverable | Model | Reason for model | Depends on | Writable files |
|---|---|---|---|---|---|---|
| WS-1 | Write and verify the new bank | New `questions.json`, rewritten `docs/sources.md`, README sentence, verification script output | opus | Needs taste for what is genuinely confusing plus strict fact-checking of lyrics, quotes and verses | none | questions.json, docs/sources.md, README.md, .orchestrator/runs/<run>/reports/ws1-* |
| WS-2 | Independent fact-check | Read-only report: every lyric, quote and attribution checked against an outside source, every disputed item flagged | sonnet | Well-defined checking against a list | WS-1 | .orchestrator/runs/<run>/reports/ws2-* only |

## Execution order
Wave 1: WS-1
Wave 2: WS-2 (checks WS-1's output). Fixes go back to WS-1 as its one revision round.

## Acceptance criteria per workstream
WS-1
1. `node --test test/questions.test.js` passes (schema, lengths, one Bible option per choose item, no duplicates, 40-60% Bible in yes/no).
2. A script in the run folder checks every Bible quote as an exact substring of its cited verse in both KJV datasets, and every non-Bible quote as absent from the full KJV text; all pass.
3. No quote from the old bank remains.
4. Success criteria 4 and 5 hold, counted by script.
5. Every note is under 140 characters and tells players the real source in plain words (for a song: artist, song, year).
6. Only the three writable files and the run folder change.
WS-2
1. Every non-Bible quote has a PASS, FIX (with the correct wording/source) or DROP verdict with a URL.
2. Every Bible quote's reference is re-checked against Bible Gateway KJV.

## Risks and mitigations
- Misremembered lyrics or misattributed quotes (the most common failure): WS-2 checks each one against an outside source; anything uncertain is dropped, not guessed.
- A decoy that really is in the KJV (for example "Let it be" or "eat, drink, and be merry" are both KJV phrases): full-KJV substring script.
- Songs that quote the Bible word for word make the answer arguable: a song line counts as a Bible quote only if the shown words are exact KJV, and the note says which song made it famous. Songs that paraphrase a verse are decoys, and the note gives the real verse.
- Too hard to be fun: each round still has a reveal note that explains the trick, so a wrong guess is a laugh, not a mystery.

## Decisions taken
- Rewrite the whole bank. Rejected: adding hard items next to the easy ones. Trade-off: the famous "God helps those who help themselves" type items go away.
- No translation gotchas (for example "Love is patient, love is kind" is in modern Bibles but not KJV). Rejected: using them. Trade-off: loses a cheap trick, avoids arguments.
- No Bible snippet cut so it changes the meaning (for example "Money is the root of all evil"). Trade-off: none worth keeping.
- Same counts as today (12 yes/no, 14 choose). Rejected: a bigger bank. Trade-off: fewer spare questions for the Skip button.

## Improvement pass
Status: OFF (the deliverable is quiz content, not application code)

## Cost
2 workers: 1 opus, 1 sonnet. Revision budget: 1 round per workstream.

## Example of the direction (not final)
- Bible, sounds like a love song: "Many waters cannot quench love, neither can the floods drown it." (Song of Solomon 8:7)
- Bible, sounds like a rap line: "Wine maketh merry: but money answereth all things." (Ecclesiastes 10:19)
- Bible, known from a disco hit: "By the rivers of Babylon, there we sat down" (Psalm 137:1, Boney M)
- Not Bible, sounds like Revelation: "Woe to you, oh earth and sea, for the Devil sends the beast with wrath" (Iron Maiden intro)
- Not Bible, sounds like a prophet: "Things fall apart; the centre cannot hold" (W. B. Yeats, 1919)
- Not Bible, sounds like Psalms: "What we do in life echoes in eternity" (Gladiator, 2000)
