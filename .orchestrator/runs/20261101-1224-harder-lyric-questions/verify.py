#!/usr/bin/env python3
"""Verify a question fragment (or the full bank) against two KJV datasets.

Usage: python3 -I verify.py <file.json> [more files...]
Accepts a JSON array of items, or an object with "yesno"/"choose" arrays (questions.json).

Checks:
  - Bible quote: normalised quote is a contiguous substring of the cited verse(s) in BOTH datasets.
  - Non-Bible quote: normalised quote is NOT a substring of the full KJV text (either dataset),
    and no run of 6+ consecutive words from it appears in the KJV (reported as WARN, not FAIL).
  - Duplicates across all given files.
  - Archaic-style stats per choose item (for the "style does not give it away" criterion).
Exit code 1 if any FAIL.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
KJV = os.path.join(HERE, 'kjv')

books = json.load(open(os.path.join(KJV, 'aruljohn', 'Books.json'), encoding='utf-8'))
thiago = json.load(open(os.path.join(KJV, 'thiagobodruk_en_kjv.json'), encoding='utf-8-sig'))
arul = {}
for i, b in enumerate(books):
    arul[b] = json.load(open(os.path.join(KJV, 'aruljohn', b.replace(' ', '') + '.json'), encoding='utf-8'))

def norm(s):
    s = s.lower().replace('’', "'").replace('‘', "'")
    s = re.sub(r"\{[^}]*\}", ' ', s)          # thiago has {annotations}
    s = re.sub(r"[^a-z0-9' ]+", ' ', s)
    s = s.replace("'", '')
    return re.sub(r'\s+', ' ', s).strip()

ALIASES = {'psalm': 'Psalms', 'song of songs': 'SongofSolomon', 'canticles': 'SongofSolomon'}
def book_key(name):
    n = name.strip()
    if n.lower() in ALIASES: return ALIASES[n.lower()]
    k = n.replace(' ', '')
    for b in books:
        if b.replace(' ', '').lower() == k.lower(): return b
    return None

def verses(book, ch, v1, v2):
    bi = books.index(book)
    a = arul[book]['chapters'][ch - 1]['verses']
    out_a = ' '.join(x['text'] for x in a if v1 <= int(x['verse']) <= v2)
    t = thiago[bi]['chapters'][ch - 1]
    out_t = ' '.join(t[v - 1] for v in range(v1, v2 + 1))
    return out_a, out_t

FULL_A = ' ' + ' '.join(norm(x['text']) for b in books for c in arul[b]['chapters'] for x in c['verses']) + ' '
FULL_T = ' ' + ' '.join(norm(v) for b in thiago for c in b['chapters'] for v in c) + ' '

SRC = re.compile(r'^(.+?) (\d+):(\d+)(?:[-–](\d+))?(?:, ?(\d+))? \(KJV\)$')
ARCHAIC = re.compile(r"\b(thou|thee|thy|thine|ye|hath|doth|lo|behold|woe|unto|shalt|wilt|art|saith|yea|nay|wherefore|whither|thence|[a-z]{3,}eth|[a-z]+(?<![bjnprtvw])est)\b", re.I)

fails, warns = [], []
seen = {}

def check_bible(q, src, where):
    m = SRC.match(src)
    if not m:
        fails.append(f'{where}: bad Bible source format "{src}"'); return
    book = book_key(m.group(1))
    if not book:
        fails.append(f'{where}: unknown book "{m.group(1)}"'); return
    ch, v1 = int(m.group(2)), int(m.group(3))
    v2 = int(m.group(4) or m.group(5) or v1)
    try:
        a, t = verses(book, ch, v1, v2)
    except (IndexError, KeyError):
        fails.append(f'{where}: verse not found {src}'); return
    nq = norm(q.strip('.…').replace('...', ' '))
    for label, text in (('aruljohn', a), ('thiagobodruk', t)):
        if nq not in ' ' + norm(text) + ' ':
            fails.append(f'{where}: NOT an exact KJV substring in {label}: "{q}" vs {src}: "{text[:160]}"')

def check_not_bible(q, where):
    nq = norm(q)
    for label, full in (('aruljohn', FULL_A), ('thiagobodruk', FULL_T)):
        if ' ' + nq + ' ' in full:
            fails.append(f'{where}: decoy IS in the KJV ({label}): "{q}"')
            return
    w = nq.split()
    for n in range(len(w), 5, -1):
        hit = None
        for i in range(0, len(w) - n + 1):
            chunk = ' ' + ' '.join(w[i:i + n]) + ' '
            if chunk in FULL_A:
                hit = chunk.strip(); break
        if hit:
            warns.append(f'{where}: decoy shares a {n}-word run with the KJV: "{hit}"'); break

def dup(q, where):
    k = norm(q)
    if k in seen: fails.append(f'{where}: duplicate of {seen[k]}: "{q}"')
    else: seen[k] = where

stats = {'items': 0, 'quotes': 0, 'cats': {}, 'choose': 0, 'choose_style_ok': 0, 'yesno': 0, 'yesno_bible': 0}

def cat(o):
    c = o.get('category', 'missing')
    stats['cats'][c] = stats['cats'].get(c, 0) + 1

for path in sys.argv[1:]:
    data = json.load(open(path, encoding='utf-8'))
    items = data if isinstance(data, list) else data.get('yesno', []) + data.get('choose', [])
    name = os.path.basename(path)
    for i, it in enumerate(items):
        where = f'{name}[{i}]'
        stats['items'] += 1
        if it.get('type') == 'yesno':
            stats['yesno'] += 1; stats['quotes'] += 1; cat(it)
            stats['yesno_bible'] += bool(it['isBible'])
            dup(it['quote'], where)
            (check_bible(it['quote'], it['source'], where) if it['isBible'] else check_not_bible(it['quote'], where))
        else:
            stats['choose'] += 1
            bib = [o for o in it['options'] if o['isBible']]
            if len(bib) != 1: fails.append(f'{where}: {len(bib)} Bible options')
            dec_arch = any(ARCHAIC.search(o['quote']) for o in it['options'] if not o['isBible'])
            bib_plain = bool(bib) and not ARCHAIC.search(bib[0]['quote'])
            if dec_arch or bib_plain: stats['choose_style_ok'] += 1
            else: warns.append(f'{where}: style gives it away (no archaic decoy and Bible option is archaic)')
            for j, o in enumerate(it['options']):
                w = f'{where}.options[{j}]'
                stats['quotes'] += 1; cat(o)
                dup(o['quote'], w)
                (check_bible(o['quote'], o['source'], w) if o['isBible'] else check_not_bible(o['quote'], w))

for f in fails: print('FAIL', f)
for w in warns: print('WARN', w)
print('STATS', json.dumps(stats))
print('RESULT', 'FAIL' if fails else 'PASS', f'({len(fails)} fails, {len(warns)} warnings)')
sys.exit(1 if fails else 0)
