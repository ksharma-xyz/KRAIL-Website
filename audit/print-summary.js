#!/usr/bin/env node
// Print Lighthouse scores as a markdown table.
// Used by .github/workflows/lighthouse.yml (writes to $GITHUB_STEP_SUMMARY)
// and by audit/check.sh for local runs.
const fs = require('fs');

const desktop = JSON.parse(fs.readFileSync('audit/lighthouse.report.json', 'utf8'));
const mobile  = JSON.parse(fs.readFileSync('audit/lighthouse-mobile.report.json', 'utf8'));

const score = (r, k) => Math.round(r.categories[k].score * 100);
const emoji = s => (s >= 90 ? '🟢' : s >= 50 ? '🟡' : '🔴');

const cats = ['performance', 'accessibility', 'best-practices', 'seo'];
const date = new Date().toISOString().split('T')[0];

console.log('## 🚆 KRAIL · Lighthouse scores\n');
console.log(`Tested: \`https://krail.app\` · ${date}\n`);
console.log('| Category | Desktop | Mobile |');
console.log('|---|---|---|');
cats.forEach(k => {
  const d = score(desktop, k);
  const m = score(mobile, k);
  const label = k.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  console.log(`| ${label} | ${emoji(d)} **${d}** | ${emoji(m)} **${m}** |`);
});

console.log();
console.log('### Mobile performance metrics');
console.log();
console.log('| Metric | Value |');
console.log('|---|---|');
['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'].forEach(id => {
  const a = mobile.audits[id];
  if (a) console.log(`| ${a.title} | ${a.displayValue || 'n/a'} |`);
});

console.log();
console.log('_Full HTML reports are attached as artifacts to this run · 90-day retention._');
