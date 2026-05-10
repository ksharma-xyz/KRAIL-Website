#!/usr/bin/env bash
# Quick accessibility-only Lighthouse run.
# Faster than the full audit (~15s vs ~60s) since it only runs a11y checks.
# Usage:  ./audit/a11y.sh
set -e

URL="${1:-https://krail.app}"
mkdir -p audit

echo "→ A11y-only run against $URL …"
npx --yes lighthouse@latest "$URL" \
  --only-categories=accessibility \
  --output=json --output=html \
  --output-path=./audit/a11y.report \
  --chrome-flags="--headless --no-sandbox" \
  --quiet

echo
node -e "
const r = JSON.parse(require('fs').readFileSync('audit/a11y.report.report.json'));
const score = Math.round(r.categories.accessibility.score * 100);
console.log('  Accessibility score:', score);
console.log();
const fails = Object.values(r.audits).filter(a =>
  a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'manual' && a.scoreDisplayMode !== 'notApplicable'
);
if (fails.length === 0) {
  console.log('  ✅ No failing audits.');
} else {
  console.log('  Failing audits:');
  fails.forEach(a => console.log('    [' + Math.round(a.score*100).toString().padStart(3) + '] ' + a.title));
}
console.log();
console.log('  Open audit/a11y.report.report.html for the full breakdown.');
"
