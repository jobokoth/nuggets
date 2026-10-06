// Parses "_RESOURCES/QUOTES ROUNDROBIN.txt" into entries:
//   { kind: 'quote'|'verse'|'prayer', title, body, reference, scripture }
// The source file mixes three layouts: "- " bullets, numbered declarations
// ("12." / title / body / verse line) and free-form paragraphs.
import { readFileSync } from 'node:fs';

// A scripture reference such as "Psalm 34:1", "1 Thessalonians 5:18", "Deut 8:18",
// "Proverbs 3:5–6" or "1 Timothy 6:6–10, 17–19; Romans 12:18".
const REF = String.raw`(?:[123]\s)?[A-Z][a-z]+\.?\s\d+:\d+(?:[–-]\d+)?(?:,\s?\d+(?::\d+)?(?:[–-]\d+)?)*`;
const REFS = `${REF}(?:;\\s?${REF})*`;
// Looser form that also accepts whole chapters ("Psalm 91", "2 Kings 1–4").
const LOOSE_REF = String.raw`(?:[123]\s)?[A-Z][a-z]+\.?\s\d+(?::\d+)?(?:[–-]\d+)?`;
const BARE_REF = new RegExp(`^${LOOSE_REF}$`);
const LEADING_REF = new RegExp(`^(${LOOSE_REF}(?:;\\s?${LOOSE_REF})*)\\s+(?:—\\s+)?(.+)$`);
const STARTS_WITH_REF = new RegExp(`^(${REF})\\s*(?:—\\s*)?(.*)$`);
const INLINE_REF = new RegExp(`^(.*?[.!?”"])\\s+(${REF})\\s—\\s(.+)$`);
const TRAILING_REF = new RegExp(`^(.*\\S)\\s+—\\s+(${REFS})\\.?$`);

// Lines in the file that are notes to self rather than content.
const IGNORE = [/^There is a quote I already had/i];

const unquote = (s) => s.trim().replace(/^[“"]\s*/, '').replace(/\s*[”"]$/, '').trim();
const isQuoted = (s) => /^[“"]/.test(s.trim()) && /[”"]$/.test(s.trim());

function classify(e) {
  if (e.kind) return e.kind;
  const t = e.body;
  if (/\bAmen\b/.test(t)) return 'prayer';
  if (/^(Heavenly Father|Father|Lord|O Lord|Dear Lord|Jesus|Lord Jesus|Holy Spirit)\b/.test(t)) return 'prayer';
  if (/\b(in )?(the )?(mighty )?(name of Jesus|Jesus(['’]|’s)? (mighty )?name|Jesus Christ['’]s mighty name)\b/i.test(t)) return 'prayer';
  return 'quote';
}

export function parseQuotes(path) {
  const raw = new TextDecoder('windows-1252').decode(readFileSync(path));
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const entries = [];
  let skipNext = false;    // the description line under a "##" heading
  let numbered = null;     // { title?, body? } while reading a numbered declaration
  let pendingTitle = null; // e.g. "A closing prayer of thanksgiving"

  const push = (e) => {
    if (!e.body) return;
    e.title = e.title || pendingTitle || null;
    pendingTitle = null;
    entries.push(e);
  };
  const last = () => entries[entries.length - 1];

  for (const line of lines) {
    if (!line) continue;
    if (IGNORE.some((r) => r.test(line))) continue;

    if (line.startsWith('## ')) {
      skipNext = true;
      continue;
    }
    if (skipNext) { skipNext = false; continue; }

    if (/^\d+\.$/.test(line)) { numbered = {}; continue; }
    if (numbered) {
      if (!numbered.title) { numbered.title = line; continue; }
      push({ title: numbered.title, body: line });
      numbered = null; // the verse line that follows attaches to this entry below
      continue;
    }

    // "Psalm 136:1 — "O give thanks..."" on its own line: the verse for the previous entry.
    const refLine = line.match(STARTS_WITH_REF);
    if (!line.startsWith('- ') && refLine) {
      const [, ref, rest] = refLine;
      if (!rest) continue; // bare reference like "Joel 2:25", nothing to show
      const prev = last();
      if (line.includes('—') && prev && !prev.reference) {
        prev.reference = ref;
        prev.scripture = unquote(rest);
      } else {
        push({ kind: 'verse', body: unquote(rest), reference: ref });
      }
      continue;
    }

    let text = line.replace(/^(-\s*)+/, '');
    if (isQuoted(text) && !text.includes('—')) text = unquote(text);
    if (BARE_REF.test(text)) continue;

    // Short line without closing punctuation followed by content: a heading.
    if (!line.startsWith('- ') && text.length < 60 && !/[.!?”"]$/.test(text)) {
      pendingTitle = text;
      continue;
    }

    const e = { body: text };
    let m;
    if ((m = text.match(INLINE_REF))) {
      e.body = m[1]; e.reference = m[2]; e.scripture = unquote(m[3]);
    } else if ((m = text.match(TRAILING_REF))) {
      e.body = m[1]; e.reference = m[2];
      if (isQuoted(e.body)) { e.body = unquote(e.body); e.kind = 'verse'; }
    } else if ((m = text.match(LEADING_REF))) {
      // "Psalm 127 — The Lord builds the house." / "Genesis 12:2 "I will make you...""
      e.reference = m[1]; e.body = unquote(m[2].replace(/^"(?=“)/, '')); e.kind = 'verse';
    }
    push(e);
  }

  // De-duplicate (the file repeats some prayers) and classify.
  const seen = new Set();
  return entries.filter((e) => {
    const key = e.body.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    e.kind = classify(e);
    return true;
  });
}
