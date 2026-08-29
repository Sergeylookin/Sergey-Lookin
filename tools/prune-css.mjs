// prune-css.mjs — remove dead CSS left behind by sections that were cut from the
// manifesto page. Operates ONLY on manifest.css (the sole stylesheet index.html loads).
// Uses PostCSS (AST) — never regex on CSS.
//
// A selector is dead iff it references a "dead anchor" class/id: a name that appears
// nowhere in index.html AND is never created by manifest.js (verified: none are added
// via classList/className/createElement/setAttribute). If a selector chain contains a
// name that can never exist in the DOM, that whole comma-segment can never match, so it
// is dropped. A rule whose every segment is dropped is removed. Live segments sharing a
// rule with dead ones are preserved (e.g. `#intro, #team-system{}` → `#intro{}`).
//
//   node tools/prune-css.mjs --dry    # report what WOULD be removed, write nothing
//   node tools/prune-css.mjs          # apply

import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'assets', 'manifest.css');
const DRY = process.argv.includes('--dry');

// Dead anchors — verified absent from index.html and not created by manifest.js.
// Прежние вырезанные секции + главы, снесённые 29.08.2026 (pain, partner, principles, brand).
// Каждое имя проверено: отсутствует в index.html и не создаётся ни одним скриптом.
const DEAD_CLASSES = new Set([
  'svc-row',
  'numbers-grid',
  'numbers-lead',
  'numbers-title',
  'aud-list',
  'ds-layer',
  'ds-layers',
  'ctitle',
  'has-tip',
  'bicon-aa-letter',
  'bicon-compass',
  'bicon-eq',
  'bicon-pos-dot',
  'bicon-ripple',
  'bicon-spark-core',
  'bicon-spark-sat',
  'bicon-sys-ray',
  'bmp-cols',
  'bnum',
  'br-step',
  'brand-steps',
  'col-tag',
  'col-title',
  'partner-col',
  'partner-compare',
  'partner-final-row',
  'partner-mark',
  'partner-prt',
  'partner-svc',
  'pnum',
  'principles-grid',
]);
const DEAD_IDS = new Set(['services', 'team-system', 'pain', 'partner', 'principles', 'brand']);

const selectorIsDead = (sel) => {
  let dead = false;
  selectorParser((root) => {
    root.walkClasses((n) => { if (DEAD_CLASSES.has(n.value)) dead = true; });
    root.walkIds((n) => { if (DEAD_IDS.has(n.value)) dead = true; });
  }).processSync(sel);
  return dead;
};

const css = readFileSync(FILE, 'utf8');
const root = postcss.parse(css);
const removedSelectors = [];
const removedRules = [];

root.walkRules((rule) => {
  // skip keyframe steps (parent is @keyframes) — their "selectors" are 0%/from/to
  if (rule.parent && rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
  const kept = [], dropped = [];
  for (const sel of rule.selectors) (selectorIsDead(sel) ? dropped : kept).push(sel);
  if (!dropped.length) return;
  if (!kept.length) { removedRules.push(rule.selector.replace(/\s+/g, ' ').trim()); rule.remove(); }
  else { dropped.forEach((s) => removedSelectors.push(s.trim() + '  (in rule kept for: ' + kept.join(', ').slice(0, 60) + ')')); rule.selectors = kept; }
});

// drop now-empty at-rules (e.g. a @media that held only dead rules)
root.walkAtRules((at) => { if (!/keyframes/i.test(at.name) && at.nodes && at.nodes.length === 0) { removedRules.push('@' + at.name + ' ' + at.params + ' {}'); at.remove(); } });

console.log(`Removed ${removedRules.length} whole rules, ${removedSelectors.length} dead selectors from shared rules.\n`);
console.log('── whole rules removed ──');
removedRules.forEach((r) => console.log('  ✕ ' + r.slice(0, 120)));
console.log('\n── dead selectors pruned from shared rules ──');
removedSelectors.forEach((s) => console.log('  · ' + s));

if (!DRY) {
  const out = root.toString();
  writeFileSync(FILE, out);
  console.log(`\n✔ written. ${css.length} → ${out.length} bytes (−${css.length - out.length})`);
} else {
  console.log('\n(dry run — nothing written)');
}
