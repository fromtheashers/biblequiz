# Bible or Not? Protocol and engine API

This is the contract between the server (a Cloudflare Durable Object), the host page
(the TV) and the phone page. The rules live in `src/engine.js`. The server is a thin layer:
it authenticates, assigns connection ids, passes messages to the engine and sends views back.

Contents

1. [Architecture](#1-architecture)
2. [Engine API (for the server)](#2-engine-api-for-the-server)
3. [WebSocket endpoints](#3-websocket-endpoints)
4. [Messages](#4-messages)
5. [Phases and game flow](#5-phases-and-game-flow)
6. [Views](#6-views)
7. [Phone reconnect flow](#7-phone-reconnect-flow)
8. [Error codes](#8-error-codes)

---

## 1. Architecture

- One Durable Object instance runs one engine for the one game. The server is the only
  authority: clients never compute scores or correctness.
- Each browser holds one WebSocket. The server gives every socket a unique **connection id**
  (an opaque string, for example a random UUID) and passes it to the engine for every phone
  message. The host socket has no connection id in the engine; host messages go to
  `engine.hostCommand(msg)`.
- After every change (`engine.version` changed) the server sends every socket its own view:
  the host gets `engine.hostView()`, each phone gets `engine.playerView(connId)`.
- After every change the server saves `engine.toJSON()` to Durable Object storage, and sets a
  Durable Object alarm for `engine.nextDeadline()` (or deletes the alarm when it is `null`).
  When the alarm fires the server calls `engine.tick()`, then broadcasts and saves if the
  version changed.
- The engine never reads the clock or `Math.random` itself. The server passes
  `now: () => Date.now()` and a `random` function that returns a float in [0, 1) built
  from `crypto.getRandomValues` (it is used for player ids, tokens and option shuffles).

## 2. Engine API (for the server)

```js
import { createEngine } from './engine.js';

const engine = createEngine({
  questions,          // the parsed questions.json object: { translation, yesno: [...], choose: [...] }
  config: {},         // optional overrides, see below; ignored when `state` is given
  now: () => Date.now(),
  random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  state,              // optional: an object from engine.toJSON() to restore
});
```

| Member | Returns | Notes |
| --- | --- | --- |
| `playerCommand(connId, msg)` | `{ ok: true, ... }` or `{ ok: false, code, error }` | `msg` is the parsed JSON from a phone. Types: `join`, `rename`, `answer`, `leave`. |
| `hostCommand(msg)` | `{ ok: true, ... }` or `{ ok: false, code, error }` | `msg` is the parsed JSON from the authenticated host. Types: `start`, `next`, `endEarly`, `addTime`, `skip`, `kick`, `reset`. |
| `disconnect(connId)` | nothing | Call when a phone socket closes. The player is kept but marked offline. Unknown ids are ignored. |
| `hostView()` | object | See [Views](#6-views). |
| `playerView(connId)` | object or `null` | `null` when this connection is not (or no longer) bound to a player: send nothing, or wait for a `join`. |
| `nextDeadline()` | ms epoch or `null` | When `tick()` must be called next. Only a running question has a deadline. |
| `tick()` | `true` if something changed | Applies an expired question timer. Safe to call early or repeatedly. Every command also applies an expired timer first, so a late answer is rejected even if the alarm has not fired yet. |
| `version` | integer | Increases on every state change, never on rejected commands or on reading views. |
| `takeNotices()` | `[{ connId, type }]` | Sockets the server must tell and close since the last call; the list is cleared by the call. `type` is `"kicked"` (host kicked that player) or `"replaced"` (the same player joined from another socket). Call it after every command. Not part of the saved state. |
| `connIds()` | `string[]` | Connection ids currently bound to players. |
| `toJSON()` | plain object | A deep copy of the whole state; survives `JSON.parse(JSON.stringify(x))`. |
| `fromJSON(obj)` | nothing | Replaces the whole state. Throws on an object that is not a saved state. Same as passing `state` to `createEngine`. |

Restoring: always pass the same `questions` object. The saved state carries its own config
(the config passed to `createEngine` is ignored when `state` is given) and a copy of the
current question, so a reveal after restore is exact. Connection ids are saved too. If the
Durable Object restarts and the old sockets are gone, call `engine.disconnect(id)` for every
id in `engine.connIds()` that has no live socket; the phones will reconnect with their token.

Exports besides `createEngine`: `DEFAULT_CONFIG`, `PHASES`, `ERROR_CODES`,
`errorMessage(code, config)`, `SCHEMA`, and the helpers `cleanText`, `nameKey`, `cpLen`, `scoreFor`.

### Config

| Key | Default | Meaning |
| --- | --- | --- |
| `yesnoRounds` | 6 | Rounds 1..6 are "Is this from the Bible?" |
| `chooseRounds` | 9 | The following rounds are "Which one is from the Bible?" |
| `yesnoSeconds` | 15 | Timer for a yes/no question |
| `chooseSeconds` | 25 | Timer for a four-choice question |
| `extraSeconds` | 15 | Time added by the host's "+15 s" |
| `doubleFromRound` | 13 | This round and later rounds score double |
| `maxPlayers` | 50 | Players in the game (online and offline) |
| `maxNameLength` | 15 | Name length in Unicode code points |
| `leaderboardSize` | 5 | Entries on the host leaderboard slide |

The game uses the first `yesnoRounds` items of `yesno` and the first `chooseRounds` items of
`choose`; the remaining items are spares for "Skip question". If a list is shorter, the game
has fewer rounds of that type. Malformed items (no quote, no boolean `isBible`, a choose item
without exactly 4 options and exactly one `isBible: true`) are ignored.

## 3. WebSocket endpoints

| URL | Who | Notes |
| --- | --- | --- |
| `/ws?role=player` | Phones | Anyone may connect. The socket does nothing until it sends `join`. |
| `/ws?role=host&key=HOST_KEY` | Host screen | The server compares `key` with its secret (constant-time). Without the right key the connection is rejected (HTTP 403 before the upgrade); the engine never sees it. Several host sockets may be open; they all receive the host view. |

All frames are UTF-8 JSON text. The server should drop frames that are not valid JSON objects
(reply with an `error` message) and should rate-limit each socket.

## 4. Messages

Every message is a JSON object with a string `type`. Extra fields are ignored. Unknown types
are rejected with `unknown_type`; non-objects or a missing / non-string / over-long `type`
with `bad_message`.

### 4.1 Client to server: phone (`role=player`)

| `type` | Payload | Allowed | Success reply fields |
| --- | --- | --- | --- |
| `join` | `token?: string`, `name?: string` | Any phase (new names not at `podium`) | `token`, `playerId`, `name` |
| `rename` | `name: string` | `lobby` only | `name` |
| `answer` | `answer: boolean` (yes/no) or `0..3` (choose), `qid?: number` | `question` only | `answer` |
| `leave` | none | Any phase | none |

- `join` with a known `token`: re-binds this socket to that player (score kept). If the same
  player was on another socket, that socket gets a `replaced` notice.
- `join` with an unknown token and no `name`: error `unknown_token`.
- `join` with a `name` (and no valid token): the name is cleaned (control and invisible
  characters removed, whitespace collapsed, trimmed), must be 1..15 code points, and must be
  unique ignoring case and look-alike forms (NFKC, so `ＡＢ` equals `ab`). If the name belongs
  to an **offline** player, this socket takes that player over (score kept, same token). If it
  belongs to an online player: `name_taken`. New players are refused at `podium`
  (`game_over`) and beyond `maxPlayers` (`room_full`).
- `answer`: yes/no questions take `true` ("Bible") or `false` ("Not the Bible"); choose
  questions take the option index 0..3 **in the order shown** in the view. The first answer
  locks (`already_answered` afterwards). Send the `qid` of the question on screen; if it no
  longer matches (the host skipped the question) the answer is rejected with
  `stale_question`. Players who joined during the question may answer it.
- `leave`: in the lobby the player is removed (the token stops working); later the player is
  only marked offline. The phone should forget its token after leaving.

### 4.2 Client to server: host (`role=host`)

| `type` | Payload | Allowed in | Effect |
| --- | --- | --- | --- |
| `start` | none | `lobby` | Go to `intro`. Needs at least one player (`no_players`) and one question (`no_questions`). |
| `next` | none | `intro`, `reveal`, `leaderboard`, `section` | Advance (see [flow](#5-phases-and-game-flow)). Elsewhere `wrong_phase`. |
| `endEarly` | none | `question` | End the question now and reveal. |
| `addTime` | none | `question` | Deadline and total time grow by `extraSeconds` (15 s). Any number of times. Reply also has `deadline`. |
| `skip` | none | `question` | Discard all answers of this round and replace the question with the next unused spare of the **same type**, with a fresh timer and a new `qid`. Same round number. `no_spare` when none is left. |
| `kick` | `playerId: string` | Any phase | Remove the player. Their socket gets a `kicked` notice and their token stops working. Reply also has `kickedConnId` (or `null` if offline). |
| `reset` | none | Any phase | Back to `lobby`. Scores, streaks, history cleared, players kept, question pointers reset. |

### 4.3 Server to client

| Message | To | When |
| --- | --- | --- |
| `{ "type": "ack", "for": "<request type>", "ok": true, ...result }` | The sender | Reply to every client message. On success the engine's result fields are copied in (for example `token`, `playerId`, `name` for `join`). |
| `{ "type": "ack", "for": "<request type>", "ok": false, "code": "name_taken", "error": "That name is taken. ..." }` | The sender | The message was rejected. `error` is plain English and can be shown as is. |
| `{ "type": "state", "view": { ... } }` | Every socket | After every change, and right after connect (host) or a successful `join` (phone). `view` is `hostView()` or `playerView(connId)`. |
| `{ "type": "kicked" }` | A phone | The host removed this player. The phone forgets its token and shows a message. The server closes the socket shortly after. |
| `{ "type": "replaced" }` | A phone | This player joined from another tab or device. The phone stops reconnecting automatically. The server closes the socket. |
| `{ "type": "error", "code": "bad_message", "error": "..." }` | The sender | A frame that is not a JSON object, or a rate limit hit (`"code": "rate_limited"`, server-side). |

If a client sends an `id` field, the server may copy it into the `ack` (`"id": ...`) so the
client can match replies. The engine never sees `id`.

Example exchange:

```json
→ { "type": "join", "name": "Alice" }
← { "type": "ack", "for": "join", "ok": true, "token": "5XgzCDgpAXEZqk50gFoZr4vQCtUnu9WP", "playerId": "pae1qthbyy", "name": "Alice" }
← { "type": "state", "view": { "role": "player", "phase": "lobby", ... } }
→ { "type": "answer", "answer": 9 }
← { "type": "ack", "for": "answer", "ok": false, "code": "not_accepting", "error": "Answers are not open right now." }
```

## 5. Phases and game flow

```
lobby --start--> intro --next--> question(1) --(timer | endEarly | all answered)--> reveal
reveal --next--> leaderboard --next--> question(n+1)
                             --next--> section --next--> question(first choose round)   (after the last yes/no round)
                             --next--> podium                                            (after the last round)
any --reset--> lobby
```

- `question` ends when the timer expires (`tick()` or any command after the deadline), when
  the host sends `endEarly`, or immediately when every **connected** player has answered
  (there must be at least one connected player). Offline players are not waited for; a
  disconnect or kick can therefore end the question.
- The leaderboard is shown after every round **including the last**; `next` from the final
  leaderboard goes to `podium`. `isLastRound` in the views tells the host page to label the
  button "Final results".
- The `section` slide ("Round 2: Find the Bible verse") is shown once, between the last
  yes/no leaderboard and the first choose question, only when both kinds of rounds exist.
- Rounds 1..`yesnoRounds` are yes/no; the rest are choose. Rounds `doubleFromRound` and later
  (13, 14, 15 by default) score double.

Scoring (computed at the end of the question):

```
correct: points = round(500 + 500 * (1 - elapsed / totalTime)), clamped to 500..1000, times the multiplier (1 or 2)
wrong or no answer: 0
elapsed   = answer time - question start (ms)
totalTime = the question's full duration in ms INCLUDING any time added with addTime (also for answers given before it was added)
```

Examples (15 s question): instant 1000, after 3 s 900, after 7.5 s 750, at 14.999 s 500.
Streak = number of consecutive correct answers (a wrong or missing answer resets it to 0); shown only, not scored.

Ranking: by total score, competition ranking (1, 1, 3); players with equal scores keep join order.
`prevRank` is the player's rank just before the most recent question was scored (`null` before the first one).

## 6. Views

### 6.1 Secrecy

The TV is visible to everyone and phones are in players' hands, so during `question`
**no** view contains `isBible`, `source`, `note`, `correctAnswer`, per-option counts, or who
answered what. The host view only has `answers.count`; each phone only has its own `myAnswer`.
All of that appears from `reveal` on. (The engine tests check this for every round of both types.)

### 6.2 Fields common to both views

| Field | Type | Meaning |
| --- | --- | --- |
| `role` | `"host"` or `"player"` | |
| `phase` | string | `lobby`, `intro`, `question`, `reveal`, `leaderboard`, `section`, `podium` |
| `version` | integer | `engine.version` when the view was built |
| `serverNow` | ms epoch | The server clock. Clients compute `offset = serverNow - Date.now()` on arrival and show `deadline - (Date.now() + offset)` as the countdown. |
| `deadline` | ms epoch or `null` | End of the running question; `null` outside `question` |
| `timerTotal` | ms or `null` | Full question duration including added time (for a progress bar); `null` outside `question` |
| `totals` | `{ rounds, yesno, choose }` | Number of rounds in this game |
| `round` | `{ no, of, type, multiplier, qid }` or `null` | Present in `question`, `reveal`, `leaderboard`; `type` is `"yesno"` or `"choose"`, `multiplier` is 1 or 2 |

### 6.3 Host view, extra fields

| Field | Phases | Shape |
| --- | --- | --- |
| `players` | all | `[{ id, name, connected, score, rank, streak }]` in join order (for the lobby list and the kick menu) |
| `maxPlayers` | all | number |
| `intro` | `intro` | `{ yesnoRounds, chooseRounds, yesnoSeconds, chooseSeconds, doubleFromRound }` (`doubleFromRound` is `null` when the game is too short to reach it) |
| `question` | `question` | yes/no: `{ qid, type: "yesno", quote }`; choose: `{ qid, type: "choose", options: [{ quote }] x4 }` in the shown order |
| `answers` | `question` | `{ count, expected }`: answered so far, and players connected or already answered |
| `canSkip` | `question` | `true` if a spare of this type is left |
| `extraSeconds` | `question` | seconds added by `addTime` (for the button label) |
| `question` | `reveal` | yes/no: `{ qid, type, quote, isBible, source, note, correctAnswer }` (`correctAnswer` = `isBible`); choose: `{ qid, type, options: [{ quote, isBible, source }] x4, note, correctAnswer }` (`correctAnswer` = shown index). `source` and `note` may be `null`. |
| `stats` | `reveal` | yes/no: `{ bible, notBible, noAnswer }`; choose: `{ options: [n0, n1, n2, n3], noAnswer }` |
| `results` | `reveal` | `[{ playerId, name, answer, correct, points, ms, score, streak }]`, sorted by points this round (then by standing). `answer` and `ms` are `null` if the player did not answer; `score` is the new total. |
| `isLastRound` | `reveal` | boolean |
| `leaderboard` | `leaderboard` | `{ entries: [{ rank, prevRank, playerId, name, score, streak }] (top 5), playerCount, isLastRound }`. Movement arrow: up if `rank < prevRank`. |
| `section` | `section` | `{ number: 2, title: "Find the Bible verse", type: "choose", firstRound, rounds }` |
| `podium` | `podium` | `{ top: [{ rank, players: [{ playerId, name, score }] }], standings: [{ rank, playerId, name, score }], rounds: [{ no, type, qid, answered, correct }] }`. `top` holds the places with rank 1..3 (tied players share a place, so there may be fewer than 3 places, or more than 3 players). |

### 6.4 Player view, extra fields

| Field | Phases | Shape |
| --- | --- | --- |
| `me` | all | `{ playerId, name, score, rank, prevRank, of, streak }` (`of` = number of players) |
| `lobby` | `lobby` | `{ players: [{ name, connected }] }` |
| `intro` | `intro` | same as the host's |
| `question` | `question` | same as the host's (quotes only, no secrets) |
| `myAnswer` | `question`, `reveal`, `leaderboard` | the player's locked answer (`true`/`false` or index) or `null` |
| `question` | `reveal`, `leaderboard` | same as the host's revealed question |
| `stats` | `reveal`, `leaderboard` | same as the host's |
| `result` | `reveal`, `leaderboard` | `{ answer, correct, points, ms }` for this player, or `null` if they joined after the question ended |
| `isLastRound` | `reveal`, `leaderboard` | boolean |
| `section` | `section` | same as the host's |
| `podium` | `podium` | `{ top }` as in the host's; own place is `me.rank` |

### 6.5 Examples

Real output of the engine (two players, a game with one round of each type so that the
examples stay short; with the defaults `totals` is `{ "rounds": 15, "yesno": 6, "choose": 9 }`
and `intro.doubleFromRound` is 13).

**Lobby, host**

```json
{
  "role": "host", "phase": "lobby", "version": 2, "serverNow": 1761620000000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": null,
  "players": [
    { "id": "pae1qthbyy", "name": "Alice", "connected": true, "score": 0, "rank": 1, "streak": 0 },
    { "id": "p901xcw5jp", "name": "Bob", "connected": true, "score": 0, "rank": 1, "streak": 0 }
  ],
  "maxPlayers": 50
}
```

**Lobby, player**

```json
{
  "role": "player", "phase": "lobby", "version": 2, "serverNow": 1761620000000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": null,
  "me": { "playerId": "pae1qthbyy", "name": "Alice", "score": 0, "rank": 1, "prevRank": null, "of": 2, "streak": 0 },
  "lobby": { "players": [ { "name": "Alice", "connected": true }, { "name": "Bob", "connected": true } ] }
}
```

**Intro, host** (the player view has the same `intro` object plus `me`)

```json
{
  "role": "host", "phase": "intro", "version": 3, "serverNow": 1761620000000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": null,
  "players": [ "...as in the lobby..." ],
  "maxPlayers": 50,
  "intro": { "yesnoRounds": 1, "chooseRounds": 1, "yesnoSeconds": 15, "chooseSeconds": 25, "doubleFromRound": null }
}
```

**Yes/no question, host**

```json
{
  "role": "host", "phase": "question", "version": 5, "serverNow": 1761620002000,
  "deadline": 1761620015000, "timerTotal": 15000,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 1, "of": 2, "type": "yesno", "multiplier": 1, "qid": 1 },
  "players": [
    { "id": "pae1qthbyy", "name": "Alice", "connected": true, "score": 0, "rank": 1, "streak": 0 },
    { "id": "p901xcw5jp", "name": "Bob", "connected": true, "score": 0, "rank": 1, "streak": 0 }
  ],
  "maxPlayers": 50,
  "question": { "qid": 1, "type": "yesno", "quote": "Pride goeth before destruction, and an haughty spirit before a fall." },
  "answers": { "count": 1, "expected": 2 },
  "canSkip": false,
  "extraSeconds": 15
}
```

**Yes/no question, player** (Alice has answered "Bible")

```json
{
  "role": "player", "phase": "question", "version": 5, "serverNow": 1761620002000,
  "deadline": 1761620015000, "timerTotal": 15000,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 1, "of": 2, "type": "yesno", "multiplier": 1, "qid": 1 },
  "me": { "playerId": "pae1qthbyy", "name": "Alice", "score": 0, "rank": 1, "prevRank": null, "of": 2, "streak": 0 },
  "question": { "qid": 1, "type": "yesno", "quote": "Pride goeth before destruction, and an haughty spirit before a fall." },
  "myAnswer": true
}
```

**Yes/no reveal, host**

```json
{
  "role": "host", "phase": "reveal", "version": 6, "serverNow": 1761620005000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 1, "of": 2, "type": "yesno", "multiplier": 1, "qid": 1 },
  "players": [
    { "id": "pae1qthbyy", "name": "Alice", "connected": true, "score": 933, "rank": 1, "streak": 1 },
    { "id": "p901xcw5jp", "name": "Bob", "connected": true, "score": 0, "rank": 2, "streak": 0 }
  ],
  "maxPlayers": 50,
  "question": {
    "qid": 1, "type": "yesno",
    "quote": "Pride goeth before destruction, and an haughty spirit before a fall.",
    "isBible": true, "source": "Proverbs 16:18 (KJV)",
    "note": "Often shortened to \"pride comes before a fall\".",
    "correctAnswer": true
  },
  "stats": { "bible": 1, "notBible": 1, "noAnswer": 0 },
  "results": [
    { "playerId": "pae1qthbyy", "name": "Alice", "answer": true, "correct": true, "points": 933, "ms": 2000, "score": 933, "streak": 1 },
    { "playerId": "p901xcw5jp", "name": "Bob", "answer": false, "correct": false, "points": 0, "ms": 5000, "score": 0, "streak": 0 }
  ],
  "isLastRound": false
}
```

**Yes/no reveal, player**

```json
{
  "role": "player", "phase": "reveal", "version": 6, "serverNow": 1761620005000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 1, "of": 2, "type": "yesno", "multiplier": 1, "qid": 1 },
  "me": { "playerId": "pae1qthbyy", "name": "Alice", "score": 933, "rank": 1, "prevRank": 1, "of": 2, "streak": 1 },
  "question": {
    "qid": 1, "type": "yesno",
    "quote": "Pride goeth before destruction, and an haughty spirit before a fall.",
    "isBible": true, "source": "Proverbs 16:18 (KJV)",
    "note": "Often shortened to \"pride comes before a fall\".",
    "correctAnswer": true
  },
  "stats": { "bible": 1, "notBible": 1, "noAnswer": 0 },
  "result": { "answer": true, "correct": true, "points": 933, "ms": 2000 },
  "myAnswer": true,
  "isLastRound": false
}
```

**Leaderboard, host**

```json
{
  "role": "host", "phase": "leaderboard", "version": 7, "serverNow": 1761620005000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 1, "of": 2, "type": "yesno", "multiplier": 1, "qid": 1 },
  "players": [ "...as above..." ],
  "maxPlayers": 50,
  "leaderboard": {
    "entries": [
      { "rank": 1, "prevRank": 1, "playerId": "pae1qthbyy", "name": "Alice", "score": 933, "streak": 1 },
      { "rank": 2, "prevRank": 1, "playerId": "p901xcw5jp", "name": "Bob", "score": 0, "streak": 0 }
    ],
    "playerCount": 2,
    "isLastRound": false
  }
}
```

**Leaderboard, player** (same as the reveal view, with `phase: "leaderboard"`)

```json
{
  "role": "player", "phase": "leaderboard", "version": 7, "serverNow": 1761620005000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 1, "of": 2, "type": "yesno", "multiplier": 1, "qid": 1 },
  "me": { "playerId": "p901xcw5jp", "name": "Bob", "score": 0, "rank": 2, "prevRank": 1, "of": 2, "streak": 0 },
  "question": { "...": "revealed question, as in the reveal view" },
  "stats": { "bible": 1, "notBible": 1, "noAnswer": 0 },
  "result": { "answer": false, "correct": false, "points": 0, "ms": 5000 },
  "myAnswer": false,
  "isLastRound": false
}
```

**Section, host** (the player view has the same `section` object plus `me`)

```json
{
  "role": "host", "phase": "section", "version": 8, "serverNow": 1761620005000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": null,
  "players": [ "...as above..." ],
  "maxPlayers": 50,
  "section": { "number": 2, "title": "Find the Bible verse", "type": "choose", "firstRound": 2, "rounds": 1 }
}
```

**Choose question, host**

```json
{
  "role": "host", "phase": "question", "version": 9, "serverNow": 1761620006000,
  "deadline": 1761620030000, "timerTotal": 25000,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 2, "of": 2, "type": "choose", "multiplier": 1, "qid": 2 },
  "players": [ "...as above..." ],
  "maxPlayers": 50,
  "question": {
    "qid": 2, "type": "choose",
    "options": [
      { "quote": "This too shall pass." },
      { "quote": "The love of money is the root of all evil." },
      { "quote": "Cleanliness is indeed next to godliness." },
      { "quote": "God helps those who help themselves." }
    ]
  },
  "answers": { "count": 0, "expected": 2 },
  "canSkip": false,
  "extraSeconds": 15
}
```

**Choose question, player**

```json
{
  "role": "player", "phase": "question", "version": 9, "serverNow": 1761620006000,
  "deadline": 1761620030000, "timerTotal": 25000,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 2, "of": 2, "type": "choose", "multiplier": 1, "qid": 2 },
  "me": { "playerId": "pae1qthbyy", "name": "Alice", "score": 933, "rank": 1, "prevRank": 1, "of": 2, "streak": 1 },
  "question": {
    "qid": 2, "type": "choose",
    "options": [
      { "quote": "This too shall pass." },
      { "quote": "The love of money is the root of all evil." },
      { "quote": "Cleanliness is indeed next to godliness." },
      { "quote": "God helps those who help themselves." }
    ]
  },
  "myAnswer": null
}
```

**Choose reveal, host**

```json
{
  "role": "host", "phase": "reveal", "version": 11, "serverNow": 1761620016000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 2, "of": 2, "type": "choose", "multiplier": 1, "qid": 2 },
  "players": [
    { "id": "pae1qthbyy", "name": "Alice", "connected": true, "score": 1833, "rank": 1, "streak": 2 },
    { "id": "p901xcw5jp", "name": "Bob", "connected": true, "score": 0, "rank": 2, "streak": 0 }
  ],
  "maxPlayers": 50,
  "question": {
    "qid": 2, "type": "choose",
    "options": [
      { "quote": "This too shall pass.", "isBible": false, "source": "Persian proverb" },
      { "quote": "The love of money is the root of all evil.", "isBible": true, "source": "1 Timothy 6:10 (KJV)" },
      { "quote": "Cleanliness is indeed next to godliness.", "isBible": false, "source": "John Wesley, Sermon 88 (1791)" },
      { "quote": "God helps those who help themselves.", "isBible": false, "source": "Algernon Sidney, Discourses Concerning Government (1698)" }
    ],
    "note": "Franklin popularised the first one.",
    "correctAnswer": 1
  },
  "stats": { "options": [0, 1, 1, 0], "noAnswer": 0 },
  "results": [
    { "playerId": "pae1qthbyy", "name": "Alice", "answer": 1, "correct": true, "points": 900, "ms": 5000, "score": 1833, "streak": 2 },
    { "playerId": "p901xcw5jp", "name": "Bob", "answer": 2, "correct": false, "points": 0, "ms": 11000, "score": 0, "streak": 0 }
  ],
  "isLastRound": true
}
```

**Choose reveal, player**

```json
{
  "role": "player", "phase": "reveal", "version": 11, "serverNow": 1761620016000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": { "no": 2, "of": 2, "type": "choose", "multiplier": 1, "qid": 2 },
  "me": { "playerId": "p901xcw5jp", "name": "Bob", "score": 0, "rank": 2, "prevRank": 2, "of": 2, "streak": 0 },
  "question": { "...": "revealed choose question, as in the host view" },
  "stats": { "options": [0, 1, 1, 0], "noAnswer": 0 },
  "result": { "answer": 2, "correct": false, "points": 0, "ms": 11000 },
  "myAnswer": 2,
  "isLastRound": true
}
```

**Podium, host**

```json
{
  "role": "host", "phase": "podium", "version": 13, "serverNow": 1761620016000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": null,
  "players": [ "...as above..." ],
  "maxPlayers": 50,
  "podium": {
    "top": [
      { "rank": 1, "players": [ { "playerId": "pae1qthbyy", "name": "Alice", "score": 1833 } ] },
      { "rank": 2, "players": [ { "playerId": "p901xcw5jp", "name": "Bob", "score": 0 } ] }
    ],
    "standings": [
      { "rank": 1, "playerId": "pae1qthbyy", "name": "Alice", "score": 1833 },
      { "rank": 2, "playerId": "p901xcw5jp", "name": "Bob", "score": 0 }
    ],
    "rounds": [
      { "no": 1, "type": "yesno", "qid": 1, "answered": 2, "correct": 1 },
      { "no": 2, "type": "choose", "qid": 2, "answered": 2, "correct": 1 }
    ]
  }
}
```

With ties, places are shared: scores 1000, 1000, 0, 0, 0 give
`"top": [{ "rank": 1, "players": [A, B] }, { "rank": 3, "players": [C, D, E] }]`.

**Podium, player**

```json
{
  "role": "player", "phase": "podium", "version": 13, "serverNow": 1761620016000,
  "deadline": null, "timerTotal": null,
  "totals": { "rounds": 2, "yesno": 1, "choose": 1 },
  "round": null,
  "me": { "playerId": "p901xcw5jp", "name": "Bob", "score": 0, "rank": 2, "prevRank": 2, "of": 2, "streak": 0 },
  "podium": { "top": [ "...as in the host view..." ] }
}
```

## 7. Phone reconnect flow

1. On load, read `token` from `localStorage` (wrap in try/catch; storage may be unavailable).
2. Open `/ws?role=player`. On every open (first connect and every reconnect):
   - with a stored token, send `{ "type": "join", "token": "<token>" }`;
   - without one, show the name form; on submit send `{ "type": "join", "name": "<name>" }`.
3. On a successful `join` ack, store `token` in `localStorage` and wait for `state`.
4. On `unknown_token` (the player was kicked, left in the lobby, or the token belongs to an
   older game whose saved state is gone; a host `reset` keeps tokens valid), delete the
   stored token and show the name form. Typing the same name again takes the old player over
   if that player is offline (score kept).
5. On `name_taken`, ask for another name (or wait a few seconds: the old socket may still be
   closing).
6. On socket close, reconnect with back-off (for example 0.5 s, 1 s, 2 s, max 5 s) and go to
   step 2. Do not reconnect after `kicked` or `replaced`.
7. On `kicked`, delete the stored token and show "You were removed from the game".

The host page does the same without a token: on (re)connect it simply receives a fresh
`state` message.

## 8. Error codes

| Code | Message (default config) | Typical cause |
| --- | --- | --- |
| `bad_message` | That message could not be understood. | Not an object, missing or bad `type`, bad `playerId` |
| `unknown_type` | Unknown message type. | A `type` this role does not have |
| `not_joined` | You are not in the game. Please join first. | `rename` / `answer` before `join` |
| `unknown_token` | Your earlier place in the game was not found. Please enter your name. | `join` with a token that is not (or no longer) valid and no name |
| `name_empty` | Please type a name. | Empty or missing name |
| `name_too_long` | Names can be at most 15 characters. | More than `maxNameLength` code points |
| `name_taken` | That name is taken. If it is you, close other tabs and try again in a few seconds, or pick a new name. | Name used by an online player |
| `room_full` | The room is full (50 players). | `maxPlayers` reached |
| `game_over` | The game has finished. Ask the host to start a new one. | New name during `podium` |
| `names_locked` | Names are locked once the game has started. | `rename` outside `lobby` |
| `not_accepting` | Answers are not open right now. | `answer` outside `question` (including after the deadline) |
| `stale_question` | That question is no longer on screen. | `answer` with an old `qid` (after a skip) |
| `bad_answer` | That is not a valid answer. | Wrong answer type for the question type |
| `already_answered` | You have already answered. Your first answer counts. | Second `answer` in a round |
| `wrong_phase` | That cannot be done right now. | Host action in the wrong phase |
| `no_players` | At least one player must join before the game can start. | `start` with nobody in the game |
| `no_questions` | There are no questions loaded. | `start` with an empty question bank |
| `no_spare` | There are no spare questions of this type left. | `skip` with no spare left |
| `unknown_player` | Player not found. | `kick` with an unknown id |

The server may add its own codes for the `error` message (for example `rate_limited`).
