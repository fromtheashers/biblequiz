# Bible or Not?

A party game for one big screen (a TV or projector) and everyone's phones, a bit like Kahoot. A quote appears on the screen and everyone guesses on their phone: **is it from the Bible, or not?** Lots of famous sayings sound biblical but are not, and some odd-sounding lines really are in there.

- **Players:** up to 50. They join by scanning a QR code on the TV and typing a name. Nobody signs up for anything.
- **Rounds:** 15 in total.
  - Rounds 1 to 6: **"Is this from the Bible?"** One quote, two buttons: *Bible* or *Not the Bible*. 15 seconds.
  - Rounds 7 to 15: **"Which one is from the Bible?"** Four quotes, exactly one is from the Bible. 25 seconds.
- **Each round:** the quote appears and the timer runs → phones answer (the first tap counts) → when the time is up, or everyone has answered, the answer is revealed with where the quote really comes from → leaderboard → next round.
- **Scoring:** a right answer is worth between 1000 points (instant) and 500 points (at the last second). A wrong answer or no answer is 0. Rounds 13, 14 and 15 are worth double.
- **Finale:** a podium with the top three, tied players share a place.
- **Translation:** all Bible quotes are from the King James Version (KJV), word for word.

It runs for free on Cloudflare (one free account, no credit card, no add-ons).

## What is in the folder

| File | What it does |
|---|---|
| `src/worker.js` | The front door: hands out the pages, guards the host page, makes the QR code. |
| `src/game-room.js` | Runs the game for everybody's phones and saves it after every move (a Cloudflare "Durable Object"). |
| `src/engine.js` | The game rules, timers and scoring. |
| `public/index.html`, `public/phone.js`, `public/phone.css` | The phone page (the main address). |
| `public/host.html`, `public/host.js`, `public/host.css` | The host page for the TV (`/host?key=...`). |
| `public/music.js` | Background music for the host screen. |
| `public/shared.css` | Shared styling. |
| `questions.json` | The questions. Edit this (see below). Players can never download it. |
| `docs/sources.md` | Where every quote comes from, and the rules for new questions. |
| `docs/protocol.md` | Technical notes for developers. |
| `wrangler.jsonc` | Settings for Cloudflare. |
| `.dev.vars.example` | Example host key for testing on your own computer. |
| `test/` | Automatic checks (`npm test`). |

## Put it online (Cloudflare)

You need two free accounts: **GitHub** (where the code lives) and **Cloudflare** (where the game runs). This takes about 15 minutes the first time. Cloudflare changes its screens from time to time, so a button may be named a little differently from what is written here (for example **Create** instead of **Create application**, or **Connect to Git** instead of **Import a repository**). Look for the closest match.

### A. Get the code onto GitHub

If the code is already in a GitHub repository called `biblequiz` on your account, skip to B.

1. Go to https://github.com and sign in (or create a free account).
2. Click the **+** at the top right, then **New repository**.
3. Name it `biblequiz`. **Private** is fine. Leave the "Add a README / .gitignore / license" boxes **unticked**. Click **Create repository**.
4. On the next page click the link **uploading an existing file**.
5. Open the project folder on your computer and drag **everything inside it** into the page (the folders `src`, `public`, `docs`, `test` and the files `package.json`, `package-lock.json`, `wrangler.jsonc`, `questions.json`, `README.md`, `.gitignore`, `.dev.vars.example`). Do **not** upload `node_modules`, `.wrangler` or `.dev.vars` if you have them.
6. Click the green **Commit changes** button and wait until it finishes.
7. Check that the repository page shows `wrangler.jsonc` and `package.json` at the top level (not inside another folder), and that the branch is called `main`.

### B. Create the Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up and sign up with your email and a password.
2. Confirm your email address (Cloudflare sends you a link).
3. You do **not** need to add a website or a domain, and you do **not** need to pick a paid plan. The free plan is enough.

### C. Connect the GitHub repository and deploy

1. In the Cloudflare dashboard, click **Workers & Pages** in the menu on the left (it may be under **Compute (Workers)** or **Build**).
2. Click **Create** (or **Create application**).
3. Choose **Import a repository** (on some screens this is a **GitHub** button or **Connect to Git**).
4. If asked, click **Connect GitHub**, sign in to GitHub and allow Cloudflare to see your repositories (you can allow only `biblequiz`).
5. Pick the `biblequiz` repository from the list (use the search box if needed) and click **Next** or **Begin setup**.
6. Fill in the settings:
   - **Project name / Worker name:** `biblequiz`. This must be exactly `biblequiz`, because it has to match the `name` in `wrangler.jsonc`, otherwise the build fails. It also becomes part of your web address.
   - **Build command:** leave empty.
   - **Deploy command:** `npx wrangler deploy` (this is usually filled in already).
   - **Non-production branch deploy command / Preview command:** leave as it is.
   - **Root directory (Path):** leave empty, or `/`.
   - **Branch (Production branch):** `main`.
   - Leave everything else (API token, build variables) as it is.
7. Click **Deploy** (or **Save and Deploy**). Wait for the build log to finish with a success message (one or two minutes).

### D. Set your host key (the password for the host screen)

The host screen is protected by a secret word, the **host key**, so that only you can run the game. Pick one with no spaces that nobody will guess, for example `purple-giraffe-42`.

1. In **Workers & Pages**, click your Worker `biblequiz`.
2. Click the **Settings** tab.
3. Find **Variables and Secrets** and click **Add**.
4. Set **Type** to **Secret**.
5. **Variable name:** `HOST_KEY` (capital letters, exactly like this).
6. **Value:** your secret word, for example `purple-giraffe-42`.
7. Click **Deploy** (on some screens **Save and deploy**). The key works within a few seconds.

You only do this once. Later deploys from GitHub keep the secret. If you ever want a new key, edit `HOST_KEY` the same way.

### E. Find your links

1. On your Worker's page (the **Overview** or **Settings → Domains & Routes** section) you will see an address ending in `.workers.dev`, for example `https://biblequiz.your-name.workers.dev`. Click it to check the phone page opens.
2. **Player link:** that address, for example `https://biblequiz.your-name.workers.dev/`. Players never need to type it: the host screen shows it as a QR code.
3. **Host link:** the same address followed by `/host?key=` and your key, for example `https://biblequiz.your-name.workers.dev/host?key=purple-giraffe-42`. Bookmark it on the laptop that will be connected to the TV, and keep it private.

If the host link says **Host key not set**, step D has not been saved and deployed yet. If it says **Wrong link**, check the key after `key=` (capitals count).

### F. Updates

Every time you change a file on GitHub (in the `main` branch), Cloudflare builds and deploys the new version by itself within a couple of minutes. You can watch it under your Worker → **Deployments** (or **Builds**).

## Before the party (rehearsal checklist)

1. **A day or two before**, open the host link on the laptop you will use and connect it to the TV.
2. Click anywhere on the page once so the browser allows sound, and check the music plays.
3. Scan the QR code with your own phone and with one or two other phones (or open the player link in a few browser windows). Join with different names.
4. Press **Start**, play at least two rounds, and check: the timer runs, phones can answer, the reveal shows the right answer and source, the leaderboard appears.
5. Refresh the host page in the middle of a question: the game should come straight back where it was.
6. Turn one phone's Wi-Fi off and on again: it should rejoin by itself with its score.
7. Remove a test player with the ✕ next to their name, then press **Reset** to go back to the lobby with scores at zero.
8. **On the day**, open the host link 15 minutes early, press **Reset** if an old game is showing, and wait for the QR code.
9. Do not change files on GitHub during the party: a new deploy may reset the game.

## Running the game (host)

1. Guests scan the QR code and type a name (up to 15 characters, and no two players can have the same name). Their names appear on the TV.
2. Press **Start**. A "How to play" slide appears. Explain the rules, then press **Next** to show question 1.
3. Each question ends by itself when the timer runs out or when everyone has answered. While a question is running you can use:
   - **End timer early**: stop the question now and show the answer.
   - **+15 seconds**: add 15 seconds to the timer (as often as you like).
   - **Skip question**: throw this question away and use a spare one of the same kind (all answers for it are discarded).
4. After the answer is shown, press **Next** for the leaderboard, then **Next** again for the next question. Before round 7 a slide announces the second part ("Find the Bible verse").
5. After the last round's leaderboard press **Final results** for the podium.
6. Any time:
   - **Reset**: back to the lobby, all scores set to zero, players stay.
   - **✕** next to a name: remove that player.

**Keyboard shortcuts (host page):** **Space** = the main button (Start, Next, Final results), **E** = end timer early, **T** = +15 seconds, **S** = skip question, **M** = make the music quiet while you talk.

Players can change their name while they are in the lobby. Names lock when you press Start (and unlock after a Reset). If a phone refreshes or loses Wi-Fi, it rejoins by itself with its score. If someone loses their phone session completely, they can type the same name again to take their place back (this works while their old phone is offline).

## Changing the questions

The questions are in `questions.json`. The game uses the first 6 "Is this from the Bible?" items and the first 9 "Which one is from the Bible?" items. Any extra items after those are spares for **Skip question**.

To change them on GitHub:

1. Open your `biblequiz` repository on https://github.com and click `questions.json`.
2. Click the pencil icon (**Edit this file**).
3. Change the text. Keep the commas, quotation marks and brackets exactly as they are around your text. A yes/no item looks like this:
   ```json
   { "type": "yesno", "quote": "Physician, heal thyself.", "isBible": true, "source": "Luke 4:23 (KJV)", "note": "Jesus quoting a proverb." }
   ```
   A four-quote item has `"type": "choose"`, a `"note"`, and an `"options"` list of exactly four `{ "quote": ..., "isBible": ..., "source": ... }` with **exactly one** `"isBible": true`.
4. Click **Commit changes**. Cloudflare deploys the new questions automatically.

Rules for fair questions (the full list is in `docs/sources.md`):

- Bible quotes are **King James Version, word for word**. Do not modernise or reorder the words. Bible sources are written like `Proverbs 16:18 (KJV)`.
- Every four-quote question has **exactly one** Bible quote.
- Quotes are at most 160 characters, notes at most 140, and no quote may appear twice.
- Never guess where a non-Bible quote comes from: if you are not sure, say so in `source`.

If you have the project on your computer, run `npm test` after editing: it checks the file and tells you exactly which item is wrong. (If a JSON mistake slips through, the deploy fails and the previous version keeps running.)

## Run it on your own computer (optional test)

1. Install **Node.js** from https://nodejs.org (choose the **LTS** version).
2. Open a terminal in the project folder (on Windows: open the folder, click the address bar, type `cmd` and press Enter; on a Mac: right-click the folder in Finder → **New Terminal at Folder**).
3. Run `npm install` (downloads the libraries, once).
4. Copy the file `.dev.vars.example` and name the copy `.dev.vars` (it contains `HOST_KEY=change-me`).
5. Run `npm run dev`. You do not need a Cloudflare login for this.
6. The terminal prints an address such as `http://localhost:8787`. Open `http://localhost:8787/host?key=change-me` for the host screen, and `http://localhost:8787/` in other browser windows to pretend to be players.
7. Press **Ctrl+C** in the terminal to stop.

`npm test` runs all the automatic checks (rules, questions and the server).

## Settings (optional)

Add these the same way as the host key (Worker → **Settings** → **Variables and Secrets** → **Add**, type **Text**), then deploy:

| Name | Default | What it does |
|---|---|---|
| `HOST_KEY` (Secret, required) | none | The password in the host link. |
| `YESNO_SECONDS` | 15 | Seconds for an "Is this from the Bible?" question. |
| `CHOOSE_SECONDS` | 25 | Seconds for a "Which one is from the Bible?" question. |
| `PUBLIC_URL` | the site's own address | The address the QR code points to (only needed if you use your own domain). |

## Free plan limits, in plain words

The Cloudflare free plan is far more than one party needs. Roughly: 100,000 page visits and game connections per day, 100,000 saved game moves per day, and a few hours of the game room being busy per day. A full game with 50 players uses a few thousand of these. The counters reset every day at midnight UTC. If a limit were ever reached, the game would stop answering until the next day, so do not run dozens of full games on the same day.

## Good to know

- **One game at a time.** Everybody who opens the address joins the same game.
- **The game survives a host screen refresh**, a closed laptop lid or a dropped Wi-Fi: open the host link again and it continues where it was. Phones reconnect by themselves.
- The game is saved after every move, so even if Cloudflare restarts it, the scores are kept. **Redeploying during a game** (changing a file on GitHub) may still reset it or disconnect everybody for a moment, so avoid it during the party.
- At most 60 phones can be connected at the same time (50 players plus a few spare connections).
- Only the host page needs the key. Keep the host link private. Phones never see the answer before the reveal, and the questions file cannot be downloaded.
- No personal data is collected: only the names people type. They stay in the game until you remove those players with ✕ (Reset keeps the players).
