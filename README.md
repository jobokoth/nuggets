# Nuggets

A tiny offline PWA that shows a random quote, verse or prayer each time you open it.
Anything marked as a **nugget** also appears in the Twitter-style Nuggets feed.
It is wrapped as an Android app with Bubblewrap (Trusted Web Activity).

- **No framework, no backend.** Plain HTML/CSS/JS in `public/`.
- **SQLite on the device** via [sql.js](https://github.com/sql-js/sql.js) (WebAssembly). The database file lives
  in IndexedDB on the phone and is never uploaded anywhere.
- **Private content stays off the internet.** The hosted app ships an *empty* database. Your quotes, verses and
  prayers are in `private/nuggets-private.db`, which you copy to the phone yourself and load with **Import**.
- **Round-robin random:** each pick is random among the entries shown the fewest times, so every entry comes up
  once before any repeats.

## Screens

| Screen | What it does |
| --- | --- |
| PIN | Create a 4-digit PIN on first run, then unlock with it. |
| Today's nugget | Random entry on every unlock (and when you come back after 5+ minutes away). Add it to nuggets, or tap **Another**. |
| Nuggets | Feed of everything marked as a nugget, newest first. **+** writes a new one. |
| Library | Every entry, with search, Quote/Verse/Prayer filters, nugget toggle, export/import backup and change PIN. |
| Detail | Full text, change the type (the importer guesses it), add/remove from nuggets, delete. |

## Develop

```sh
npm install
npm run build      # copy sql.js into public/vendor, rebuild public/nuggets.db (empty)
                   # and private/nuggets-private.db (your entries)
npm run serve      # http://127.0.0.1:5180
```

`npm run icons` regenerates the PNG icons (needs Python + Pillow).

### Data and privacy

| File | Contents | Published? |
| --- | --- | --- |
| `public/nuggets.db` | Schema only, 0 entries | Yes, it ships with the app |
| `private/nuggets-private.db` | All entries from the quotes file | **Never.** Git-ignored, outside `public/` |
| `_RESOURCES/` | Source quotes file and design handoff | **Never.** Git-ignored |

Anything under `public/` is downloadable by anyone once hosted (GitHub Pages sites are always public), and the
PIN only guards the app's screens, not the files. So keep personal content out of `public/`.

`scripts/seed.mjs` parses `_RESOURCES/QUOTES ROUNDROBIN.txt` (Windows-1252) with `scripts/parse-quotes.mjs` into:

```sql
entries(id, kind 'quote'|'verse'|'prayer', title, body, reference, scripture,
        is_nugget, nugget_at, shown_count, last_shown_at, created_at)
settings(key, value)   -- pin_hash, seed_version
```

The importer handles the file's three layouts (`- ` bullets, numbered declarations with a verse line, and
free-form paragraphs), splits out scripture references, drops bare references like `Joel 2:25` and duplicates.
### Loading your entries on the phone

1. `npm run seed` to (re)build `private/nuggets-private.db`.
2. Copy that file to the phone privately (USB, or email/Drive it to yourself).
3. Open Nuggets, create your PIN, then tap **Import file** on the first screen (or **Library → Import backup**)
   and pick the file. Your PIN is kept.

Importing **replaces** the whole database on the phone, so nuggets you marked and entries you added there are
lost unless they are in the file you import. To move data between devices, or to keep a copy, use
**Library → Export backup**: a plain `.db` file you can open in any SQLite tool. Treat exports like the private
file: don't put them in `public/` or commit them.

When you change any file in `public/`, bump `VERSION` in `public/sw.js` so installed copies pick it up.

## Build the Android app (Bubblewrap / TWA)

A TWA loads your PWA from a real HTTPS URL, so host `public/` first (GitHub Pages, Netlify, Cloudflare Pages…).

1. Deploy `public/` and confirm `https://YOUR_HOST/manifest.webmanifest` loads.
2. Install Bubblewrap (it downloads its own JDK and Android SDK on first run):
   ```sh
   npm i -g @bubblewrap/cli
   ```
3. Generate the Android project:
   ```sh
   cd twa
   bubblewrap init --manifest=https://YOUR_HOST/manifest.webmanifest --directory=android
   ```
   Suggested answers: package `com.nuggets.app`, app name `Nuggets`, status bar / nav colour `#faf9f6`.
   Let it create a signing key and **keep the keystore and passwords safe**: you need them for every update.
4. Build: `cd android && bubblewrap build` → `app-release-signed.apk` (sideload) and `app-release-bundle.aab` (Play Store).
5. Remove the browser URL bar: run `bubblewrap fingerprint generateAssetLinks`, or copy
   `twa/assetlinks.template.json` with your key's SHA-256, and serve it at
   `https://YOUR_HOST/.well-known/assetlinks.json` (i.e. put it in `public/.well-known/`).
   If you publish on Play with Play App Signing, add Play's signing fingerprint too.
