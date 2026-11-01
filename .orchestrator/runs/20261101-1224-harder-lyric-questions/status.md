# Status: 20261101-1224-harder-lyric-questions
Goal: go through the questions and make them much much harder; Bible verses easily confused with popular song lyrics or famous quotes.
worker type: general-purpose (orch-worker not listed as agent type)
Phase: PLAN APPROVED (v2, asher 12:59 UTC). Improvement pass OFF
Phase: DISPATCH wave 1 (2026-11-01 ~13:10 UTC)
WS-1 opus yes/no x28 agent add2efb738914f8e6
WS-2 opus choose A x21 agent a89287a4fe9b3dedd
WS-3 opus choose B x21 agent adc6fcedc03906048
WS-4 sonnet engine random draw agent aa73bd79747a36736
Deviation: prompts point workers to briefs/prompt-WS-n.md (contract + brief) instead of inlining the text.
WS-4 reported DONE
13:06 UTC: WS-1 cut off by output content filter (lyrics, likely); WS-2/WS-3 hit usage limit (reset 15:10). No fragment files written.
15:15 UTC: resumed WS-1/2/3 via SendMessage with rule: no lyric pages, single short line only, write fragment early.
WS-1 reported DONE 15:xx
WS-3 PARTIAL (33 unconfirmed; fetch budget)
WS-2 PARTIAL. Wave 1 complete. Reviewing.
Integration: merged into questions.json + docs/sources.md, 10 duplicate replacements + 2 wording fixes, test sizes 28/42. 54 tests pass. Dispatching WS-5.
Phase: DELIVERED
