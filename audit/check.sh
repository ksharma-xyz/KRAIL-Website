#!/usr/bin/env bash
# Re-run Lighthouse audits (desktop + mobile) against the live site.
# Usage:  ./audit/check.sh
# Reports:  audit/lighthouse.report.html / .json
#           audit/lighthouse-mobile.report.html / .json
set -e

URL="${1:-https://krail.app}"
mkdir -p audit

echo "→ Desktop run against $URL …"
npx --yes lighthouse@latest "$URL" \
  --output=json --output=html \
  --output-path=./audit/lighthouse \
  --chrome-flags="--headless --no-sandbox" \
  --quiet --preset=desktop

echo "→ Mobile run against $URL …"
npx --yes lighthouse@latest "$URL" \
  --output=json --output=html \
  --output-path=./audit/lighthouse-mobile \
  --chrome-flags="--headless --no-sandbox" \
  --quiet \
  --form-factor=mobile --screenEmulation.mobile=true

echo
echo "============================================================="
echo "  KRAIL website · Lighthouse scores"
echo "============================================================="
node -e "
const d = JSON.parse(require('fs').readFileSync('audit/lighthouse.report.json'));
const m = JSON.parse(require('fs').readFileSync('audit/lighthouse-mobile.report.json'));
const f = (r,k) => Math.round(r.categories[k].score*100);
console.log('  Category        Desktop  Mobile');
console.log('  ────────────────────────────────');
['performance','accessibility','best-practices','seo'].forEach(k =>
  console.log('  ' + k.padEnd(15), String(f(d,k)).padStart(7), String(f(m,k)).padStart(7))
);
console.log();
console.log('  Open these in a browser for the full report:');
console.log('    audit/lighthouse.report.html        (desktop)');
console.log('    audit/lighthouse-mobile.report.html (mobile)');
"
