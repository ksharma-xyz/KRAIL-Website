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

  /* ---- the drop cap stays inside the paragraph it opens ----
     The cap floats two lines deep. Berowra opened on a one line
     paragraph, and the float hung into the next one and pushed its
     first line in. A flow root on the opening paragraph contains it. */
  if (/p:first-of-type::first-letter\s*\{[^}]*float\s*:\s*left/.test(css)) {
    const opener = ruleBody(css, '.prose-body > p:first-of-type {');
    if (!/display\s*:\s*flow-root|overflow\s*:\s*hidden/.test(opener)) {
      add('blog.css', 'The drop cap floats but the opening paragraph does not contain it.',
          'Give .prose-body > p:first-of-type display: flow-root, or a one line opener lets the cap hang into the next paragraph.');
    }
  }

  /* ---- numbered steps are stamps, not plain numbers ---- */
  /* Anchored on the newline: the shared `.prose-body ul, .prose-body ol {`
     rule earlier in the file would otherwise match first. */
  const ol = ruleBody(css, '\n.prose-body ol {');
  const step = ruleBody(css, '.prose-body ol > li::before {');
  if (!/list-style\s*:\s*none/.test(ol) || !/counter\(step\)/.test(step)) {
    add('blog.css', 'Numbered lists render as plain numbers.',
        'Steps are drawn as stamp squares from a counter. Keep list-style: none on .prose-body ol and content: counter(step) on its ::before.');
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

/* Fonts are served from our own origin. Going back to Google Fonts costs
   four cross-origin requests across two domains, and CI measured those
   handshakes as the largest single cost on every page: 30 to 41ms before a
   byte moved, against 2 to 4ms for everything local. */
function checkFonts(rel, src, add2) {
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(src)) {
    add2(rel, 'A page requests fonts from Google.',
         'Serve them from /fonts/ instead. See fonts/README.md. The handshakes alone were most of the LCP budget.');
  }
  for (const font of ['/fonts/roboto-900-latin.woff2', '/fonts/fraunces-900-caps.woff2']) {
    if (!existsSync(join(ROOT, font.replace(/^\//, '')))) {
      add2(rel, `A font file is missing: ${font}`,
           'Both faces are self-hosted. fonts/README.md says how to fetch them again.');
    }
    if (!src.includes(`href="${font}"`)) {
      add2(rel, `The page does not preload ${font}.`,
           'A font discovered only after the stylesheet parses arrives too late to paint with.');
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

  /* ---- a wrapped line never becomes a list ----
     Berowra's source wrapped "leaves from platform" and put "8. It gets
     to Berowra" at the start of the next line. Markdown read that as
     item 8 of a new list: the platform number vanished from the
     sentence and the rest became a nested step. Nothing in the Journal
     uses a list that starts past 1 or a list inside a step, so either
     one is a wrapped line. */
  for (const m of prose.matchAll(/<ol start="(\d+)"/g)) {
    if (m[1] !== '1') {
      add(rel, `A numbered list starts at ${m[1]}.`,
          `A wrapped line began with "${m[1]}." and markdown made it a list, so the number is missing from the sentence above it. Rejoin that line in the post source.`);
    }
  }
  if (/<li>(?:(?!<\/li>)[\s\S])*?<(ol|ul)[ >]/.test(prose)) {
    add(rel, 'A list is nested inside a list item.',
        'Usually a wrapped line that began with a number and a full stop, or with "- ". Rejoin the line in the post source.');
  }

  /* ---- practical-stuff icon lists keep one straight text column ----
     The icons are a rendering decision, not something a writer types,
     so the failure mode is not a typo in a post. It is someone later
     editing the builder and producing a list where some rows have a
     gutter and some do not, which reads as a bug rather than a style.
     Both halves of the contract are checked: every row carries a
     gutter element, and enough of them carry a real icon that the
     list is worth converting at all. */
  for (const list of prose.match(/<ul class="ico-list">[\s\S]*?<\/ul>/g) || []) {
    const rows = list.match(/<li>[\s\S]*?<\/li>/g) || [];
    const gutters = rows.filter((r) => /^<li>\s*<(svg|span) class="li-ico"/.test(r)).length;
    const icons = rows.filter((r) => /^<li>\s*<svg class="li-ico"/.test(r)).length;
    if (gutters !== rows.length) {
      add(rel, `An icon list has ${rows.length - gutters} row(s) with no gutter element.`,
          'Every row needs the icon slot, empty or not, or the text column steps in and out down the list.');
    }
    if (rows.length < 4 || icons / rows.length < 0.7) {
      add(rel, `An icon list matched only ${icons} of ${rows.length} rows.`,
          'Below the threshold the list is mostly blank gutters, so it should render as plain accent squares instead. Check ICON_LIST_MIN_HIT in build-blog.mjs.');
    }
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
    const poster = (tag.match(/\bposter="([^"]*)"/) || [])[1];
    if (!poster) {
      add(rel, 'A device clip has no poster.',
          'The phone screen is black until the video arrives, which is a layout shift on a page budgeted to CLS 0.1.');
    } else if (!existsSync(join(ROOT, poster.replace(/^\//, '')))) {
      /* The poster path is derived from the clip name rather than authored,
         so the attribute is always present and always looks right. Checking
         the string proves nothing; only the file on disk does. A missing one
         is a 404 and a black phone above the fold. */
      add(rel, `A device clip points at a poster that does not exist: ${poster}`,
          'Generate it beside the clip. The attribute is derived, so it is there whether the file is or not.');
    }
  }

  checkFonts(rel, src, add);

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
