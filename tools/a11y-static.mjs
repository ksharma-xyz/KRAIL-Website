#!/usr/bin/env node
/* ============================================================
   Static accessibility checks over built HTML.

   No dependencies and no browser, so this runs in a second and
   can gate every pull request. It catches the structural WCAG
   failures that are cheap to detect in markup. The axe-core and
   Lighthouse layers cover the rest (computed styles, focus order,
   live regions) and run separately.

   Usage:
     node tools/a11y-static.mjs blog/index.html blog/a-post/index.html
     node tools/a11y-static.mjs --md      prints a markdown report
   ============================================================ */

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const asMarkdown = argv.includes('--md');
const files = argv.slice(2).filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('Usage: node tools/a11y-static.mjs <file.html> [...]');
  exit(2);
}

/* ---------- tiny helpers ---------- */

/* Line number of a character offset, so findings point somewhere useful. */
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  if (m) return m[2] !== undefined ? m[2] : m[3];
  /* Bare boolean attribute, e.g. <img alt> */
  return new RegExp(`\\b${name}\\b`, 'i').test(tag) ? '' : null;
};

const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));

/* Text content of an element, tags removed. Good enough for link text. */
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/* ---------- the checks ---------- */

const CHECKS = [
  {
    id: 'html-lang',
    wcag: '3.1.1',
    run(src, add) {
      const m = src.match(/<html\b[^>]*>/i);
      if (!m) return add(1, 'No <html> element found.');
      if (!attr(m[0], 'lang')) add(lineOf(src, m.index), 'The <html> element has no lang attribute.');
    },
  },
  {
    id: 'page-title',
    wcag: '2.4.2',
    run(src, add) {
      const m = src.match(/<title>([\s\S]*?)<\/title>/i);
      if (!m || !m[1].trim()) add(1, 'The page has no non-empty <title>.');
    },
  },
  {
    id: 'single-h1',
    wcag: '1.3.1',
    run(src, add) {
      const hits = [...src.matchAll(/<h1\b[^>]*>/gi)];
      if (hits.length === 0) add(1, 'The page has no <h1>.');
      if (hits.length > 1) {
        hits.slice(1).forEach((h) => add(lineOf(src, h.index), `Extra <h1>. A page should have exactly one, found ${hits.length}.`));
      }
    },
  },
  {
    id: 'heading-order',
    wcag: '1.3.1',
    run(src, add) {
      let previous = 0;
      for (const m of src.matchAll(/<h([1-6])\b[^>]*>/gi)) {
        const level = Number(m[1]);
        if (previous && level > previous + 1) {
          add(lineOf(src, m.index), `Heading jumps from h${previous} to h${level}. Do not skip levels.`);
        }
        previous = level;
      }
    },
  },
  {
    id: 'img-alt',
    wcag: '1.1.1',
    run(src, add) {
      for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
        const tag = m[0];
        const alt = attr(tag, 'alt');
        if (alt === null) {
          add(lineOf(src, m.index), `<img> has no alt attribute. Use alt="" only if it is purely decorative. ${tag.slice(0, 70)}`);
        } else if (/^(image|photo|picture|img|screenshot)\.?$/i.test(alt.trim())) {
          add(lineOf(src, m.index), `Unhelpful alt text "${alt}". Describe what the image shows.`);
        }
      }
    },
  },
  {
    id: 'link-text',
    wcag: '2.4.4',
    run(src, add) {
      for (const m of src.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const text = textOf(m[2]);
        const label = attr(m[1], 'aria-label') || attr(m[1], 'title');
        if (!text && !label) {
          add(lineOf(src, m.index), 'Link has no text and no aria-label, so it is announced as a bare URL.');
        } else if (/^(click here|here|read more|more|link|this)$/i.test(text)) {
          add(lineOf(src, m.index), `Link text "${text}" does not describe the destination.`);
        }
      }
    },
  },
  {
    id: 'button-name',
    wcag: '4.1.2',
    run(src, add) {
      for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
        if (!textOf(m[2]) && !attr(m[1], 'aria-label')) {
          add(lineOf(src, m.index), 'Button has no accessible name.');
        }
      }
    },
  },
  {
    id: 'decorative-svg',
    wcag: '1.1.1',
    run(src, add) {
      for (const m of src.matchAll(/<svg\b([^>]*)>/gi)) {
        const a = m[1];
        const hidden = attr(a, 'aria-hidden') === 'true';
        const labelled = attr(a, 'aria-label') || attr(a, 'role') === 'img';
        if (!hidden && !labelled) {
          add(lineOf(src, m.index), 'Inline <svg> is neither aria-hidden="true" nor labelled, so screen readers may announce it as an unnamed graphic.');
        }
      }
    },
  },
  {
    id: 'duplicate-id',
    wcag: '4.1.1',
    run(src, add) {
      const seen = new Map();
      for (const m of src.matchAll(/\bid\s*=\s*"([^"]+)"/gi)) {
        const id = m[1];
        if (seen.has(id)) add(lineOf(src, m.index), `Duplicate id "${id}", first used on line ${seen.get(id)}.`);
        else seen.set(id, lineOf(src, m.index));
      }
    },
  },
  {
    id: 'landmarks',
    wcag: '1.3.1',
    run(src, add) {
      if (!/<main\b/i.test(src)) add(1, 'No <main> landmark, so skip-to-content is not possible.');
      const navs = [...src.matchAll(/<nav\b([^>]*)>/gi)];
      if (navs.length > 1) {
        navs.forEach((n) => {
          if (!attr(n[1], 'aria-label') && !attr(n[1], 'aria-labelledby')) {
            add(lineOf(src, n.index), 'Multiple <nav> landmarks, so each one needs an aria-label to tell them apart.');
          }
        });
      }
    },
  },
  {
    id: 'positive-tabindex',
    wcag: '2.4.3',
    run(src, add) {
      for (const m of src.matchAll(/\btabindex\s*=\s*"(\d+)"/gi)) {
        if (Number(m[1]) > 0) add(lineOf(src, m.index), `tabindex="${m[1]}" overrides natural focus order. Use 0 or -1.`);
      }
    },
  },
  {
    id: 'toggle-state',
    wcag: '4.1.2',
    run(src, add) {
      /* A button that behaves like a toggle must expose its state. */
      for (const m of src.matchAll(/<button\b([^>]*)>/gi)) {
        const a = m[1];
        const looksLikeToggle = /\bdata-(filter|theme-set|vivid-toggle)\b/.test(a);
        if (looksLikeToggle && attr(a, 'aria-pressed') === null) {
          add(lineOf(src, m.index), 'Toggle button does not expose aria-pressed, so its state is invisible to screen readers.');
        }
      }
    },
  },
  {
    id: 'reduced-motion',
    wcag: '2.3.3',
    run(src, add, { css }) {
      if (!css) return;
      if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/i.test(css)) {
        add(1, 'The stylesheet has no prefers-reduced-motion block, so animations cannot be turned off.');
      }
    },
  },
  {
    id: 'focus-visible',
    wcag: '2.4.7',
    run(src, add, { css }) {
      if (!css) return;
      /* Removing the outline without replacing it is the classic failure. */
      const kills = /outline\s*:\s*(none|0)\b/i.test(css);
      const restores = /:focus-visible/i.test(css);
      if (kills && !restores) {
        add(1, 'The stylesheet removes outlines without providing a :focus-visible replacement.');
      }
    },
  },
];

/* ---------- run ---------- */

let css = '';
try { css = readFileSync(new URL('../blog.css', import.meta.url), 'utf8'); } catch { /* optional */ }

const results = [];

for (const file of files) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (err) {
    results.push({ file, findings: [{ id: 'read', line: 1, message: `Cannot read file: ${err.message}` }] });
    continue;
  }
  const src = stripComments(raw);
  const findings = [];
  for (const check of CHECKS) {
    check.run(src, (line, message) => findings.push({ id: check.id, wcag: check.wcag, line, message }), { css });
  }
  findings.sort((a, b) => a.line - b.line);
  results.push({ file, findings });
}

const total = results.reduce((n, r) => n + r.findings.length, 0);

if (asMarkdown) {
  console.log('### Accessibility, static checks\n');
  if (!total) {
    console.log(`All ${CHECKS.length} structural checks pass across ${files.length} page(s).`);
  } else {
    console.log(`${total} finding(s) across ${files.length} page(s).\n`);
    for (const r of results) {
      if (!r.findings.length) continue;
      console.log(`**${r.file}**\n`);
      console.log('| Line | WCAG | Check | Finding |');
      console.log('|---|---|---|---|');
      for (const f of r.findings) {
        console.log(`| ${f.line} | ${f.wcag || ''} | \`${f.id}\` | ${f.message.replace(/\|/g, '\\|')} |`);
      }
      console.log('');
    }
  }
} else {
  console.log('\n  Accessibility, static checks\n');
  for (const r of results) {
    if (!r.findings.length) {
      console.log(`  [PASS] ${r.file}`);
      continue;
    }
    console.log(`  [FAIL] ${r.file}`);
    for (const f of r.findings) {
      console.log(`         ${String(f.line).padStart(5)}  ${f.id.padEnd(18)} ${f.message}`);
    }
  }
  console.log('');
  console.log(total ? `  ${total} finding(s).\n` : `  All ${CHECKS.length} checks pass.\n`);
}

exit(total ? 1 : 0);
