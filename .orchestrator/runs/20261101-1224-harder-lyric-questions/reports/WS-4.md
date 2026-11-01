STATUS: DONE (sonnet, agent aa73bd79747a36736)
Files: src/engine.js, test/engine.test.js, docs/protocol.md, README.md
node --test engine+questions: 54/54 pass. npm test: worker.test.js fails only because `ws` is not installed.
State: S.used {yesno,choose} survives hostReset, marked in startQuestion; game.deck per type = shuffle(unused)+shuffle(used), full permutation; game.spare = next deck position (6/9); canSkip = spare < deck.length; fromJSON falls back to identity deck + empty used. SCHEMA 1.
New tests: draw: (a)-(e).
Assumptions: old-format shown items not added to used; README Skip line wording changed.
