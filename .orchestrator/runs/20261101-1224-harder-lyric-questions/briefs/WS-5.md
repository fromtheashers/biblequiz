RUN: 20261101-1224-harder-lyric-questions
WORKSTREAM: WS-5: Independent fact-check of the new question bank

OBJECTIVE
The new 70-item bank for the party game "Bible or Not?" is only fair if every answer is right. You are the independent checker: confirm that each non-Bible quote is worded correctly and credited to the right source, and that each Bible reference is right.

TASK
Check the quotes in /home/user/biblequiz/questions.json against outside sources and write a verdict per quote to /home/user/biblequiz/.orchestrator/runs/20261101-1224-harder-lyric-questions/reports/ws5-factcheck.md. Do not edit questions.json or any other file.

CONTEXT
- docs/sources.md has one row per quote (IDs Y1-Y28, CA1a-CA21d, CB1a-CB21d, same order as questions.json: yesno, then choose set A, then set B) with the writer's evidence. Rows whose note contains "NOT YET CONFIRMED", "ORCHESTRATOR", or says the line was confirmed only by search titles are the weakest. Check those FIRST, then every other non-Bible row.
- Bible quotes were already proven to be exact KJV substrings by script. For Bible rows only confirm that the verse is a fair, meaning-preserving excerpt and that any song/speech claimed in the note really used it. Do not spend fetches on Bible Gateway.
- Decoy rules: wording must match the real source (capitalisation and end punctuation may be normalised; small punctuation differences are fine); the source must name the real artist/author/work and a correct year; misattributed quotes must say the attribution is doubtful; a song lyric must be one short line exactly as sung.
- The web-fetch budget is about 100 fetches per hour shared by everyone. Batch several WebSearch calls per turn and use WebFetch only where search titles cannot settle it. Prefer Wikipedia, Wikiquote, primary texts (Gutenberg, MIT Shakespeare), Quote Investigator.
- LYRICS SAFETY (strict): never open lyric sites (Genius, AZLyrics, etc.) and never print more than the single line under test. Settle lyric lines from Wikipedia/Wikiquote pages or search results. If a line cannot be settled that way, give verdict UNSURE with your best knowledge.

INPUTS
/home/user/biblequiz/questions.json, /home/user/biblequiz/docs/sources.md

SCOPE
Writable: /home/user/biblequiz/.orchestrator/runs/20261101-1224-harder-lyric-questions/reports/ws5-factcheck.md only
Read-only: everything else
Permitted special actions: WebSearch, WebFetch. Nothing else.

OUTPUT
ws5-factcheck.md: a table | ID | Quote | Verdict | Correct wording / source if FIX | Evidence URL or reason |, verdict one of PASS, FIX, DROP, UNSURE. Then a short list of every FIX/DROP/UNSURE. In your final report give the counts and the full FIX/DROP/UNSURE list.

ACCEPTANCE CRITERIA
1. Every non-Bible row (140 of them) has a verdict; at least all weak rows (see CONTEXT) are checked.
2. Every FIX gives the exact corrected wording or source; every DROP gives a reason.
3. No file other than ws5-factcheck.md changes.

VERIFICATION
Count rows in your table vs the number of isBible:false quotes in questions.json (python3 -I -c "import json;d=json.load(open('/home/user/biblequiz/questions.json'));print(sum(not i['isBible'] for i in d['yesno'])+sum(not o['isBible'] for c in d['choose'] for o in c['options']))").

STOP CONDITIONS
Stop and report PARTIAL (with what is done) if the fetch budget is exhausted and search alone cannot continue. Write the report file as you go so work is saved.
