#!/usr/bin/env node
/* ============================================================
   Mobile budget gate.

   Reads a Lighthouse JSON report and enforces hard budgets. Most
   Journal readers arrive on a phone, often on mobile data, so this
   runs against the mobile preset and blocks rather than advises.

   The category scores are the headline. The three metrics below
   them are what a reader actually feels: how long until the main
   thing appears, whether the page jumps while they read, and
   whether it responds when they tap.

   Usage:
     node tools/check-mobile.mjs audit/mobile.report.json
   ============================================================ */

import { readFileSync } from 'node:fs';

const CATEGORY_MIN = {
  performance: 85,
  accessibility: 95,
  'best-practices': 90,
  seo: 95,
};

const METRIC_MAX = {
  'largest-contentful-paint': { limit: 2500, unit: 'ms', label: 'Largest contentful paint' },
  'cumulative-layout-shift':  { limit: 0.1,  unit: '',   label: 'Cumulative layout shift' },
  'total-blocking-time':      { limit: 200,  unit: 'ms', label: 'Total blocking time' },
};

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/check-mobile.mjs <lighthouse.report.json>');
  process.exit(2);
}

let report;
try { report = JSON.parse(readFileSync(file, 'utf8')); }
catch (err) {
  console.error(`  Cannot read ${file}: ${err.message}`);
  process.exit(2);
}

const url = report.finalDisplayedUrl || report.finalUrl || file;
console.log(`\n  Mobile budget: ${url}\n`);

let failures = 0;

for (const [key, min] of Object.entries(CATEGORY_MIN)) {
  const cat = report.categories?.[key];
  if (!cat || cat.score === null) continue;
  const score = Math.round(cat.score * 100);
  const ok = score >= min;
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${cat.title.padEnd(16)} ${String(score).padStart(3)}  min ${min}`);
}

console.log('');

for (const [key, { limit, unit, label }] of Object.entries(METRIC_MAX)) {
  const audit = report.audits?.[key];
  if (!audit || audit.numericValue === undefined) continue;
  const value = audit.numericValue;
  const ok = value <= limit;
  if (!ok) failures++;
  const shown = unit === 'ms' ? `${Math.round(value)}ms` : value.toFixed(3);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(26)} ${shown.padStart(8)}  max ${limit}${unit}`);
}

/* Total transferred weight. A budget here is the difference between
   a page that opens on a train and one that does not. */
const bytes = report.audits?.['total-byte-weight']?.numericValue;
if (bytes !== undefined) {
  const kb = Math.round(bytes / 1024);
  const ok = kb <= 900;
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${'Total page weight'.padEnd(26)} ${(kb + 'KB').padStart(8)}  max 900KB`);
}

console.log('');
if (failures) {
  console.log(`  ${failures} budget(s) exceeded.\n`);
  process.exit(1);
}
console.log('  All mobile budgets met.\n');
