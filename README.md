# Wordle with Mates

5-letter word game, 5 guesses. Yellow = right letter wrong place, green = right place, grey = not in the word. On-screen keyboard tracks your letters. ~14,800 accepted words; answers come from ~2,300 common ones.

- **Scoreboard** – every word you solve is saved against your name; see your mates' totals.
- **1v1** – create a room, send the 4-letter code to a mate, same secret word, first to solve wins.
- **Works on phones** – just open the site in Safari / Chrome. Use "Add to Home Screen" for a full-screen app feel.

## Play locally
Open `index.html` in a browser. Without setup, the game works but scores are only stored on your device and 1v1 is off.

## Set up the scoreboard + 1v1 (about 3 minutes, free)
GitHub Pages only hosts static files, so the shared scores live in a free Firebase Realtime Database.

1. Go to <https://console.firebase.google.com>, **Add project** (turn off Analytics).
2. **Build → Realtime Database → Create database** (any region, start in *locked mode*).
3. Open the **Rules** tab, paste the contents of `database.rules.json`, **Publish**.
4. Copy the database URL shown at the top of the **Data** tab (looks like `https://xxxx-default-rtdb.firebaseio.com`).
5. Paste it into `config.js` as `databaseURL`, commit and push.

## Publish on GitHub Pages
1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save**.
3. After a minute it's live at `https://<your-username>.github.io/<repo-name>/`. Send that link to your mates.

## Notes
- The rules are open so mates can write without logins. It's built for friends, not a hostile public: anyone determined could edit scores or peek at the answer in the page source.
- Names are the identity: same name = same scoreboard row.
- Word lists are in `words.js` (generated; `ANSWERS` are targets, `EXTRA` are extra valid guesses).
