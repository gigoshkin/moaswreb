#!/usr/bin/env node
// Checks Georgian UI text against knowledge-base/georgian-glossary.md and a
// Georgian spelling dictionary (dictionary-ka, MIT).
//
//   node scripts/ka-check.mjs                 checks the app's copy files
//   node scripts/ka-check.mjs <file>...       checks these files
//   node scripts/ka-check.mjs --text "…"      checks one phrase
//   --strict                                  unknown words fail too
//
// Fails (exit 1) on banned terms. Unknown words are warnings: the dictionary
// misses abbreviations and some forms, and it can't judge tone or meaning.
import { readFileSync } from 'node:fs';
import dict from 'dictionary-ka';
import nspell from 'nspell';

const root = new URL('..', import.meta.url);
const DEFAULT_FILES = [
  'apps/mobile/src/lib/strings.ts',
  'apps/server/src/alerts/watcher.ts',
  'apps/server/src/chat/agent.ts',
];

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const textAt = args.indexOf('--text');
const inputs =
  textAt >= 0
    ? [{ name: '--text', body: args[textAt + 1] ?? '' }]
    : (args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : DEFAULT_FILES).map(
        (f) => ({ name: f, body: readFileSync(new URL(f, root), 'utf8') }),
      );

// Glossary tables: rows of "| ka | ... |" under each "## " heading.
const glossary = readFileSync(new URL('knowledge-base/georgian-glossary.md', root), 'utf8');
const section = (title) => {
  const part = glossary.split(/^## /m).find((s) => s.startsWith(title)) ?? '';
  return part
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
    .slice(1)
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
};
const banned = section('Banned');
const KA_WORD = /[ა-ჿ]+/g;
const known = new Set(
  [...section('Approved'), ...section('Proposed')].flatMap(([ka]) => ka.match(KA_WORD) ?? []),
);

const spell = nspell(dict);
let errors = 0;
let warnings = 0;

for (const { name, body } of inputs) {
  body.split('\n').forEach((line, i) => {
    const where = `${name}:${i + 1}`;
    for (const [term, why, instead] of banned) {
      if (new RegExp(`(?<![\\u10D0-\\u10FF])${term}(?![\\u10D0-\\u10FF])`).test(line)) {
        console.log(`${where}  BANNED  "${term}": ${why}. Use: ${instead}`);
        errors++;
      }
    }
    for (const word of line.match(KA_WORD) ?? []) {
      if (known.has(word) || spell.correct(word)) continue;
      const hint = spell.suggest(word).slice(0, 3).join(', ');
      console.log(`${where}  ${strict ? 'UNKNOWN' : 'unknown'} "${word}"${hint ? ` (maybe: ${hint})` : ''}`);
      strict ? errors++ : warnings++;
    }
  });
}

console.log(`\n${errors} error(s), ${warnings} warning(s). Spelling only: tone and meaning need a native speaker.`);
process.exit(errors ? 1 : 0);
