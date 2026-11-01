RUN: 20261101-1224-harder-lyric-questions
WORKSTREAM: WS-4: Random question draw per game

OBJECTIVE
The question pool is growing from 26 to 70 items (28 yes/no, 42 choose). Each game must draw its questions at random from the pool so the game is replayable, instead of always playing the bank in file order.

TASK
Change src/engine.js so that:
1. When a game is created (initial state and every hostReset), the engine builds a per-type random deck for that game: an ordered list of item indices for `yesno` and for `choose`, using the injected random() (existing shuffle()/randInt()). Rounds 1..totals().yesno use deck.yesno in order; the choose rounds use deck.choose in order. "Skip question" takes the next deck entry after those (replacing the current `spare` index counter); `canSkip` is true while unused deck entries remain.
2. No repeats within a room until the pool is used up: the persistent state remembers which item indices of each type have been shown in earlier games of this room (e.g. `S.used = { yesno: [...], choose: [...] }`, kept across hostReset). A new deck puts unused indices first (shuffled), then the already-used ones (shuffled). When every index of a type has been used, clear that type's used list before building the deck. Mark an index as used when its question is actually shown (startQuestion), including skip replacements.
3. The deck and used lists are part of the saved JSON state, so toJSON/fromJSON restore the exact same questions. A saved state from the previous version (no deck/used fields, `spare` counter present) must still load and continue the game it was in, by falling back to file order (identity deck) for that game; SCHEMA stays 1.
4. Nothing else changes: round counts (6 + 9), timers, scoring, phases, views, protocol messages, the shown-position shuffle of choose options.
Then update tests and docs.

CONTEXT
- Engine is a pure ES module, no I/O; time and randomness are injected (now(), random()). Read the header comment of src/engine.js and docs/protocol.md first.
- Relevant code today: totals() (~line 216), freshGame() with `spare` (~222), startRound() using itemIndex = no - 1 (~354), host skip using g.spare (~493), canSkip in hostView (~714), hostReset (~515), fromJSON (~864).
- Worker code (src/game-room.js) passes Math.random-based random(); do not change it.
- Content of questions.json is being rewritten by other workstreams; do not touch questions.json, docs/sources.md or test/questions.test.js. Tests must not depend on its content.

INPUTS
src/engine.js, test/engine.test.js, docs/protocol.md, README.md, src/game-room.js (read-only)

SCOPE
Writable: src/engine.js, test/engine.test.js, docs/protocol.md, README.md
Read-only: everything else
Permitted special actions: run `npm test` (node --test; no install needed for engine and question tests; if worker tests need missing deps, run `node --test test/engine.test.js test/questions.test.js` and report it). No installs, no commits.

README CHANGES
- Under the rules list, say each game draws 6 yes/no and 9 pick-one questions at random from the pool (currently 28 + 42), and a room does not repeat a question until it has used them all.
- In the first paragraph, replace "Lots of famous sayings sound biblical but are not, and some odd-sounding lines really are in there." with a sentence saying the quotes are deliberately tricky: real verses that sound like song lyrics or famous quotes, and lyrics and quotes that sound like the Bible.
- In the section that explains editing questions.json, explain that order in the file no longer matters and the bank should keep at least 6 yes/no and 9 choose items (more = more variety).
Keep the README's plain, step-by-step style.

OUTPUT
Edited files in place. In the report, describe the new state fields and the deck algorithm in 5 lines or fewer.

ACCEPTANCE CRITERIA
1. `node --test test/engine.test.js test/questions.test.js` passes (and `npm test` if it can run).
2. New tests cover: (a) two games with different random seeds draw different question orders; (b) with a pool of N yes/no items and 6 per game, consecutive hostReset games in one room show no repeat until all N have been shown; (c) skip draws an unshown item and canSkip turns false when the deck is exhausted; (d) toJSON/fromJSON mid-game restores the same current and upcoming questions; (e) a hand-made old-format saved state (with `spare`, without deck/used) loads and plays its next round from file order.
3. Existing tests still pass; any existing test that assumed file order is updated to use a deterministic random() or to read the drawn item, not deleted.
4. git diff shows changes only in the four writable files.

VERIFICATION
Run the test command; paste the summary lines (tests, pass, fail).

STOP CONDITIONS
Stop and report BLOCKED if: the change would require editing src/game-room.js, src/worker.js, public/*, or the client protocol.
