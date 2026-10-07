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

## Android app (Bubblewrap / TWA)

The Android app is a Trusted Web Activity: a thin wrapper that opens https://jobokoth.github.io/nuggets/
full screen in Chrome. Web changes deploy through GitHub Pages; you only rebuild the APK to change the
wrapper itself (name, icon, colours, version).

| Item | Value |
| --- | --- |
| Package | `io.github.jobokoth.nuggets` |
| Config | `twa/android/twa-manifest.json` (committed; the generated Gradle project next to it is not) |
| Signing key | `C:\Users\nyamo\.android-keys\nuggets.keystore`, passwords in `nuggets-keystore-passwords.txt` next to it. **Back up that folder**: without it you can't update the installed app. |
| Toolchain | JDK 17 and Android SDK in `~/.bubblewrap` (see `~/.bubblewrap/config.json`) |
| No address bar | https://jobokoth.github.io/.well-known/assetlinks.json (repo `jobokoth/jobokoth.github.io`) lists the key's SHA-256 |

Build (from `twa/android`), with the passwords from the passwords file:

```powershell
$env:PATH = "$HOME\.bubblewrap\jdk\jdk-17\bin;$env:PATH"   # jarsigner, needed to sign the .aab
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = '<store password>'
$env:BUBBLEWRAP_KEY_PASSWORD = '<key password>'
npx @bubblewrap/cli update --skipVersionUpgrade   # regenerate the Gradle project from twa-manifest.json
npx @bubblewrap/cli build --skipPwaValidation
```

Output: `app-release-signed.apk` (install on a phone) and `app-release-bundle.aab` (Play Store).
For a new release bump `appVersionCode` / `appVersionName` in `twa-manifest.json` (or drop `--skipVersionUpgrade`).
If you publish on Google Play with Play App Signing, add Play's signing SHA-256 to `assetlinks.json` too.
