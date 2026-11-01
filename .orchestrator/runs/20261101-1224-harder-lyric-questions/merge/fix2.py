import json
C='content/'
B=json.load(open(C+'choose-b.json')); src=json.load(open('merge/sources-rows.json'))
W='https://en.wikipedia.org/wiki/'
def rep(tag,i,j,q,s,cat,url,vn):
    o=B[i]['options'][j]; assert not o['isBible']; o.update(quote=q,source=s,category=cat)
    src[tag]=f'| {tag} | {q} | false | {s} | {url} | ORCHESTRATOR REPLACEMENT (duplicate removed): {vn} |'
rep('CB12a',11,0,'Life is short, and art long.','Hippocrates, Aphorisms 1.1 (English translation of "ars longa, vita brevis")','famous-quote',f'<{W}Ars_longa,_vita_brevis>','Opening of the Aphorisms, usually Englished as "Life is short, art long". Not in KJV.')
B[11]['note']="Bible: James 4:14. Hippocrates, Kansas-style rock and Shakespeare all sound wise; life as a vapour is the real verse."
B[11]['note']="Bible: James 4:14. Hippocrates, Queen and Shakespeare all muse on short lives; only the vapour line is scripture."
rep('CB21c',20,2,'Tomorrow, and tomorrow, and tomorrow, creeps in this petty pace from day to day.','William Shakespeare, Macbeth, Act 5 Scene 5 (c. 1606)','literature','<http://shakespeare.mit.edu/macbeth/macbeth.5.5.html>','Macbeth 5.5. Not in KJV.')
B[20]['note']="Bible: Proverbs 27:1. Doris Day, Fleetwood Mac and Macbeth all talk about tomorrow; only this one is scripture."
for it in B: assert len(it['note'])<=140
json.dump(B,open(C+'choose-b.json','w'),indent=2,ensure_ascii=False); json.dump(src,open('merge/sources-rows.json','w'),indent=1,ensure_ascii=False)
