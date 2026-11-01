import json, re, copy
C='content/'
Y=json.load(open(C+'yesno.json')); A=json.load(open(C+'choose-a.json')); B=json.load(open(C+'choose-b.json'))
src={}
for f in ('sources-yesno.md','sources-choose-a.md','sources-choose-b.md'):
    for line in open(C+f):
        m=re.match(r'^\| (Y\d+|C[AB]\d+[a-d]) \|',line)
        if m: src[m.group(1)]=line.rstrip('\n')
fixes=[]  # (id, items, itemIdx, optIdx, quote, source, category, url, vnote)
def rep(tag, items, i, j, q, s, cat, url, vn):
    o=items[i]['options'][j]; assert not o['isBible']
    o.update(quote=q, source=s, category=cat)
    src[tag]=f'| {tag} | {q} | false | {s} | {url} | ORCHESTRATOR REPLACEMENT (duplicate removed): {vn} |'
    fixes.append(tag)
W='https://en.wikipedia.org/wiki/'
rep('CA11b',A,10,1,'Like a candle in the wind.','Elton John, "Candle in the Wind" (1973)','song',f'<{W}Candle_in_the_Wind>','Title refrain of the 1973 song. Not in KJV.')
rep('CA18a',A,17,0,'Drink to me only with thine eyes.','Ben Jonson, "Song: To Celia" (1616)','poem',f'<{W}Song:_To_Celia>','First line of Jonson\'s poem, later a popular song. Not in KJV.')
rep('CA18d',A,17,3,'Wine is bottled poetry.','Robert Louis Stevenson, The Silverado Squatters (1883)','famous-quote','<https://en.wikiquote.org/wiki/Robert_Louis_Stevenson>','Stevenson on Napa wine. Not in KJV.')
A[16]  # gather ye rosebuds kept in A
rep('CB2d',B,1,3,'We are living in a material world.','Madonna, "Material Girl" (1984)','song',f'<{W}Material_Girl>','Chorus line of the 1984 song. Not in KJV.')
rep('CB9d',B,8,3,'In wine there is truth.','Latin proverb "in vino veritas"; the idea appears in Pliny the Elder, Natural History, Book 14','proverb',f'<{W}In_vino_veritas>','English form of the Latin proverb. Not in KJV.')
rep('CB12a',B,11,0,"Out, out, brief candle! Life's but a walking shadow.",'William Shakespeare, Macbeth, Act 5 Scene 5 (c. 1606)','literature','<http://shakespeare.mit.edu/macbeth/macbeth.5.5.html>','Macbeth on hearing of the queen\'s death. Not in KJV.')
B[11]['note']="Bible: James 4:14. Macbeth's 'brief candle' sounds like scripture; life as a vapour is the real verse."
rep('CB13c',B,12,2,'Do not stand at my grave and weep; I am not there. I do not sleep.','Mary Elizabeth Frye, "Do not stand at my grave and weep" (1932); authorship long disputed','poem',f'<{W}Do_not_stand_at_my_grave_and_weep>','Opening lines of the 1932 poem. Not in KJV.')
rep('CB14a',B,13,0,'Swing low, sweet chariot, coming for to carry me home.','"Swing Low, Sweet Chariot", African American spiritual, credited to Wallace Willis (before 1862)','song',f'<{W}Swing_Low,_Sweet_Chariot>','Refrain of the spiritual; echoes 2 Kings 2:11 (Elijah\'s chariot) but not KJV wording.')
rep('CB16d',B,15,3,'We shall fight on the beaches, we shall fight on the landing grounds.','Winston Churchill, speech to the House of Commons (4 June 1940)','speech',f'<{W}We_shall_fight_on_the_beaches>','Churchill, 4 June 1940. Not in KJV.')
B[15]['note']="Bible: Romans 8:31. It sounds like a battle cry; the beaches line is Churchill in 1940."
rep('CB21c',B,20,2,"The sun'll come out tomorrow.",'"Tomorrow" from the musical Annie (1977), music Charles Strouse, lyrics Martin Charnin','song',f'<{W}Tomorrow_(song)>','Opening line of the Annie song. Not in KJV.')
B[20]['note']="Bible: Proverbs 27:1. Doris Day, Fleetwood Mac and Annie all sing about tomorrow; only this one is scripture."
A[10]['note']="Bible: Hosea 8:7, the origin of 'sow the wind, reap the whirlwind'. The rest are Elton John, Bob Dylan and King Lear."
# wording fixes
def fixq(tag, items, i, j, q, vn):
    o=items[i]['options'][j]; o['quote']=q
    cells=src[tag].split(' | '); cells[1]=q; cells[-1]=cells[-1].rstrip(' |')+f'; ORCHESTRATOR: {vn} |'
    src[tag]=' | '.join(cells); fixes.append(tag)
fixq('CA16b',A,15,1,'Heaven is a place, a place where nothing, nothing ever happens.','restored the repeated words as sung')
fixq('CB9a',B,8,0,'The whiskey drowns and the beer chases my blues away.','restored "the" before beer as sung')
for it in A+B:
    assert len(it['note'])<=140, it['note']
json.dump(Y,open(C+'yesno.json','w'),indent=2,ensure_ascii=False); json.dump(A,open(C+'choose-a.json','w'),indent=2,ensure_ascii=False); json.dump(B,open(C+'choose-b.json','w'),indent=2,ensure_ascii=False)
json.dump(src,open('merge/sources-rows.json','w'),indent=1,ensure_ascii=False)
print('fixed',fixes)
