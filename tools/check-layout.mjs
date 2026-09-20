#!/usr/bin/env node
/* ============================================================
   Layout contract gate for the post template.

   Every rule here exists because the page shipped the other way
   once and read as broken. They are template decisions, not
   per-post ones, so the check is on the stylesheet and on the
   generator's output rather than on any single article.

   The four that started it, all on the Park & Ride post:

     1. `::: shot flip` swapped the two children with `order` but
        never swapped the grid columns, so the paragraph landed in
        the 216px phone column and the phone took the wide one. The
        section was unreadable at desktop width.
     2. The same block bled 100px into both gutters, so a step
        heading started 80px to the left of the paragraph above it.
     3. Store links were pasted into prose as bare URLs. The site
        has a stamp button with a store icon and it is used
        everywhere else.
     4. Flow clips carried `loop`, which restarts on the last
        frame. The last frame is the screen the step is about, so
        the payoff was on screen for one frame.

   Usage:
     node tools/check-layout.mjs
     node tools/check-layout.mjs --md      markdown, for a PR comment
   ============================================================ */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AS_MD = argv.includes('--md');

const findings = [];
const add = (file, message, fix) => findings.push({ file, message, fix });

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/* Comments in the stylesheet describe the very mistakes being checked for,
   so they have to come out before anything is matched. */
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* The body of one rule, by selector. Returns '' when the rule is absent,
   which every caller treats as a failure in its own words. */
function ruleBody(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  if (open < 0) return '';
  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(open + 1, i - 1);
}

/* ============================================================
   The stylesheet contract
   ============================================================ */
function checkStylesheet() {
  const css = stripCss(read('blog.css'));

  /* ---- one set of numbers, declared once ---- */
  const tokens = ruleBody(css, '.post-wrap {');
  for (const token of ['--measure', '--device-col', '--col-gap']) {
    if (!tokens.includes(token)) {
      add('blog.css', `.post-wrap does not declare ${token}.`,
          'The post page has one reading measure, one device column and one gap. Declare all three on .post-wrap so the head and the body read the same numbers.');
    }
  }

  /* ---- the text column is the reading measure ---- */
  const shot = ruleBody(css, '.shot-aside {\n    display: grid');
  const cols = (shot.match(/grid-template-columns:([^;]*);/) || [])[1] || '';
  if (!cols.includes('var(--measure)')) {
    add('blog.css', '.shot-aside does not start with a var(--measure) column.',
        'The text half of a shot block is the reading measure itself. That is what puts its heading on the same vertical line as the paragraphs around it.');
  }
  if (cols && cols.indexOf('var(--measure)') > cols.indexOf('1fr') && cols.includes('1fr')) {
    add('blog.css', '.shot-aside puts the flexible column before the measure.',
        'The measure is the first column. A phone on the left pushes the text off the shared left edge.');
  }

  /* ---- nothing slides left of the measure ---- */
  const pulls = [
    ['.shot-aside', ruleBody(css, '.shot-aside {') + shot],
    ['.prose-body figure.bleed', ruleBody(css, '.prose-body figure.bleed {')],
  ];
  for (const [sel, body] of pulls) {
    const bad = body.match(/margin(?:-inline|-left)?:[^;]*-\d/);
    if (bad) {
      add('blog.css', `${sel} pulls itself left with a negative margin (${bad[0].trim()}).`,
          'Widen to the right into the device column instead. A block that starts left of the paragraph above it reads as a mistake.');
    }
  }

  /* ---- the stacked breakpoint resizes the token, not the phone ----
     `--phone-w` is derived from `--device-col` further down the file, so a
     breakpoint that sets `--phone-w` is silently overridden and the phone
     keeps its desktop width on a 430px screen. */
  if (/@media[^{]*max-width[^{]*\{[\s\S]*?\.shot-aside__device\s*\{[^}]*--phone-w/.test(css)) {
    add('blog.css', 'A breakpoint sets --phone-w on .shot-aside__device.',
        'Override --device-col on .post-wrap instead. --phone-w is derived from it later in the file, so setting it here does nothing.');
  }

  /* ---- the pull quote is the one prose device that is not a box ----
     The callout and the blockquote are both stamps. A third boxed device on
     the same page stops the boxes meaning anything, which is the whole
     reason `::: highlight` is rules and type instead. */
  const hl = ruleBody(css, '.prose-body > .highlight {');
  if (!hl) {
    add('blog.css', '.prose-body > .highlight has no rule.',
        'The ::: highlight directive renders a .highlight paragraph. Without a rule it falls back to body copy and the block does nothing.');
  } else if (/box-shadow\s*:(?!\s*none)/.test(hl)) {
    add('blog.css', '.prose-body > .highlight has been given a box shadow.',
        'It is a pull quote, not a stamp. The callout and the blockquote are the boxed devices; a third box flattens the hierarchy.');
  }

  /* ---- the phone stays on the right in both variants ---- */
  if (/\.shot-aside\.reverse\s*>\s*\.shot-aside__(text|device)\s*\{[^}]*order\s*:/.test(css)) {
    add('blog.css', '.shot-aside.reverse reorders its columns.',
        'Alternation is the phone tilt, not the side. Swapping sides costs the shared left edge, and swapping order without swapping grid-template-columns puts the text in the phone column.');
  }
}

/* ============================================================
   What the generator actually emitted
   ============================================================ */
function builtPosts() {
  const blog = join(ROOT, 'blog');
  if (!existsSync(blog)) return [];
  return readdirSync(blog)
    .filter((e) => e !== 'posts' && existsSync(join(blog, e, 'index.html')))
    .map((e) => `blog/${e}/index.html`);
}

const STORE_HOSTS = /(?:apps\.apple\.com|play\.google\.com)/;

/* The display serif sets one glyph per page. Unsubset it is roughly 40KB on
   a page budgeted to LCP 2.5s, so the subset is the reason it is affordable
   at all rather than a nicety. */
function checkDropcapFont(rel, src, add2) {
  const links = src.match(/<link\b[^>]*fonts\.googleapis\.com[^>]*>/g) || [];
  const serif = links.filter((l) => /family=Fraunces/.test(l));
  if (!serif.length) {
    add2(rel, 'No drop cap font is loaded.',
         'The first letter falls back to a system serif, which is not the face the cap was sized for.');
    return;
  }
  for (const link of serif) {
    if (!/[?&]text=/.test(link)) {
      add2(rel, 'The drop cap font is requested without a text= subset.',
           'Subset it to A-Z. The family is roughly 40KB to set a single letter.');
    }
  }
}

function checkPage(rel) {
  const src = read(rel);
  const prose = (src.match(/<div class="prose-body">([\s\S]*?)<\/div>\s*\n(?:<aside|\s*<div class="post-foot")/) || [])[1] || src;

  /* ---- store links are stamps, never pasted URLs ---- */
  const bare = prose.match(new RegExp(`>[^<]*${STORE_HOSTS.source}[^<]*<`));
  if (bare) {
    add(rel, 'A store URL is printed as text in the body.',
        'Use the store buttons. They carry the App Store and Google Play icons and the stamp styling the rest of the site uses.');
  }

  /* ---- flow clips hold their last frame ---- */
  for (const tag of src.match(/<video\b[^>]*>/g) || []) {
    if (/\bloop\b/.test(tag)) {
      add(rel, 'A device clip still carries the loop attribute.',
          'A browser loop restarts on the last frame, which is the screen the step is about. Let blog.js hold it, then replay.');
    }
    if (!/\bdata-replay\b/.test(tag)) {
      add(rel, 'A device clip is missing data-replay.',
          'Without it blog.js never rewinds the clip and it stops after one pass.');
    }
    if (!/\bposter=/.test(tag)) {
      add(rel, 'A device clip has no poster.',
          'The phone screen is black until the video arrives, which is a layout shift on a page budgeted to CLS 0.1.');
    }
  }

  checkDropcapFont(rel, src, add);

  /* ---- app-tour posts cite nothing, because they show our own screens ---- */
  const isAppTour = /<body[^>]*data-cat="app"/.test(src);
  if (isAppTour && /<aside class="sources">/.test(src)) {
    add(rel, 'An app showcase post carries a "Checked against" block.',
        'These posts show screens captured from our own app. There is no external source to cite, so the block is noise.');
  }
}

/* ============================================================
   Report
   ============================================================ */
checkStylesheet();
for (const page of builtPosts()) checkPage(page);

if (AS_MD) {
  console.log(findings.length
    ? `**${findings.length} layout contract issue(s).**\n`
    : '**Layout contract holds.**\n');
  for (const f of findings) {
    console.log(`- \`${f.file}\` ${f.message}\n  - fix: ${f.fix}`);
  }
} else if (findings.length) {
  for (const f of findings) {
    console.log(`  error  ${f.file}`);
    console.log(`         ${f.message}`);
    console.log(`         fix: ${f.fix}`);
  }
  console.log(`\n  ${findings.length} layout contract issue(s).`);
} else {
  console.log('  Layout contract holds.');
}

exit(findings.length ? 1 : 0);
