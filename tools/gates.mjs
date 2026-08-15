#!/usr/bin/env node
/* ============================================================
   Content gates for the Journal.

   Four gates over post markdown and, where a post is ready, the
   HTML it builds into: copy and brand, legal and trademark, SEO,
   and answer-engine readiness. A fifth pass checks links and image
   weight.

   Findings are `error` (blocks the merge) or `warn` (reported,
   does not block). Every finding carries file, line and a fix.

   Scope note that matters for the legal gate: rules run over the
   post body, never over the frontmatter `sources` block. That is
   how the citation exception in CLAUDE.md is implemented. A source
   you are citing and linking may name its real publisher; body
   copy may not.

   Usage:
     node tools/gates.mjs                 human output
     node tools/gates.mjs --md            markdown, for a PR comment
     node tools/gates.mjs --strict        warnings block too
   ============================================================ */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = join(ROOT, 'blog', 'posts');
const AS_MD = process.argv.includes('--md');
const STRICT = process.argv.includes('--strict');

/* Budgets. Mobile is the primary surface, so these are deliberately tight. */
const MAX_IMAGE_BYTES = 300 * 1024;
const MAX_HERO_BYTES  = 400 * 1024;

const findings = [];
const add = (level, gate, file, line, message, fix) =>
  findings.push({ level, gate, file, line, message, fix });

/* ============================================================
   Helpers
   ============================================================ */

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/* Strips fenced code and inline code so a rule cannot fire on a
   code sample that is legitimately quoting a forbidden string. */
const stripCode = (md) =>
  md.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

const splitFrontmatter = (raw) => {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { head: '', body: raw, headLines: 0 };
  return { head: m[1], body: m[2], headLines: m[1].split('\n').length + 2 };
};

const fm = (head, key) => {
  const m = head.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};

const words = (s) => s.split(/\s+/).filter(Boolean).length;

/* ============================================================
   Rule tables

   Each rule is a pattern plus the replacement to reach for. Kept
   as data so the tables read like the CLAUDE.md sections they
   enforce, and so adding a rule is a one line change.
   ============================================================ */

const COPY_RULES = [
  { re: /—/g, msg: 'Em dash in user-visible copy.',
    fix: 'Rephrase to a period or comma. Do not substitute a middle dot.' },
  { re: /[·•‧∙]/g, msg: 'Middle dot in user-visible copy.',
    fix: 'Break the sentence, use a comma, or use the drawn separator element.' },
  { re: /\b(TripView|Opal Travel|Citymapper|Moovit|AnyTrip|Google Maps)\b/gi,
    msg: 'Competitor named.', fix: 'Refer generically, such as "other transit apps".' },
  { re: /\b(Kotlin|Jetpack Compose|Multiplatform|OLED|sub-second|IDFA|SDK)\b/gi,
    msg: 'Developer jargon on a marketing page.',
    fix: 'Write it the way a commuter would say it.' },
  { re: /\b(free forever|stays free forever|always be free)\b/gi,
    msg: 'Promises free forever.',
    fix: 'Say "Free* until December 2026" with the asterisk line.' },
  { re: /\b(1-bedroom|one-bedroom|long blacks|no investors)\b/gi,
    msg: 'Founder personal detail.',
    fix: 'Stick to the public line, "Built by one Sydney commuter".' },
  { re: /\b(looks like 1995|Windows 95)\b/gi,
    msg: 'Bashing language.', fix: 'Reframe positively.' },
  { re: /\b\d+(\.\d+)?×\s*(reopens|sessions)|\b\d+%\s+(of\s+)?(users|Android|iOS)|\bBigQuery\b|\b\d{3,}\s+(saved trips|daily savers)\b/gi,
    msg: 'Looks like private product analytics.',
    fix: 'Use coverage numbers instead, such as modes covered or stations.' },
];

const LEGAL_RULES = [
  { re: /\bT\d\s+[A-Z][A-Za-z]*(\s+(and|&)\s+[A-Z][A-Za-z]*)*\s+Line\b/g,
    msg: 'Full branded line name.',
    fix: 'Use the bare line code, such as "the T2 line".' },
  { re: /\b(Inner West Line|Western Line|Bankstown Line|Airport Line|North Shore Line)\b/gi,
    msg: 'Branded service name.', fix: 'Use the bare line code or "the train".' },
  { re: /\bOpal\b/g, msg: 'Opal is a registered wordmark.',
    fix: 'Write "fare" or "off-peak fare". The number is the fact, the brand is not.' },
  { re: /\b(Sydney Trains|Sydney Metro|NSW TrainLink)\b/g,
    msg: 'Operator wordmark.', fix: 'Use a generic mode name, "the train", "the metro".' },
  { re: /\bSydney rail\b|\bthe rail network\b/gi,
    msg: 'Reads as the network itself rather than someone writing about it.',
    fix: 'Write "the Sydney commute" or "catching the train".' },
  { re: /\bTransport\s+(publishes|says|provides|confirms|advises)\b/g,
    msg: 'Makes the transport authority the subject of our sentence.',
    fix: 'Write "the public transport data feed" or "published open data".' },
  { re: /\b(in partnership with|endorsed by|official app|approved by)\b/gi,
    msg: 'Possible affiliation claim.',
    fix: 'Remove it. The only permitted mention is the disclaimer denying affiliation.' },
];

/* ============================================================
   Per-post checks
   ============================================================ */

function checkPost(file) {
  const path = join(POSTS, file);
  const raw = readFileSync(path, 'utf8');
  const { head, body, headLines } = splitFrontmatter(raw);
  const clean = stripCode(body);
  const status = fm(head, 'status');
  const slug = fm(head, 'slug');
  const title = fm(head, 'title');
  const summary = fm(head, 'summary');

  const at = (index) => headLines + lineOf(clean, index);

  /* ---- copy and brand, body only ---- */
  for (const rule of COPY_RULES) {
    for (const m of clean.matchAll(rule.re)) {
      add('error', 'copy', `blog/posts/${file}`, at(m.index),
          `${rule.msg} Found "${m[0].trim()}".`, rule.fix);
    }
  }
  /* The same rules apply to the fields that become the title and
     meta description, which is where a stray dot most often hides. */
  for (const rule of COPY_RULES.slice(0, 2)) {
    for (const field of ['title', 'summary']) {
      const v = fm(head, field);
      if (v && rule.re.test(v)) {
        add('error', 'copy', `blog/posts/${file}`, 1,
            `${rule.msg} In frontmatter "${field}".`, rule.fix);
      }
      rule.re.lastIndex = 0;
    }
  }

  /* ---- legal, body only, so cited sources keep their publisher ---- */
  for (const rule of LEGAL_RULES) {
    for (const m of clean.matchAll(rule.re)) {
      add('error', 'legal', `blog/posts/${file}`, at(m.index),
          `${rule.msg} Found "${m[0].trim()}".`, rule.fix);
    }
  }

  /* ---- required frontmatter ---- */
  for (const key of ['title', 'slug', 'series', 'summary', 'updated']) {
    if (!fm(head, key)) {
      add('error', 'seo', `blog/posts/${file}`, 1,
          `Missing required frontmatter "${key}".`, 'Add it to the frontmatter block.');
    }
  }
  if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    add('error', 'seo', `blog/posts/${file}`, 1,
        `Slug "${slug}" is not lowercase-hyphenated.`, 'Use lowercase words joined by hyphens, no dates.');
  }

  /* ---- SEO lengths, measured on the strings that actually ship ---- */
  if (title && (title.length < 25 || title.length > 60)) {
    add(title.length > 60 ? 'error' : 'warn', 'seo', `blog/posts/${file}`, 1,
        `Title is ${title.length} characters.`, 'Aim for 25 to 60 so it is not truncated in results.');
  }
  if (summary && (summary.length < 70 || summary.length > 160)) {
    add(summary.length > 160 ? 'error' : 'warn', 'seo', `blog/posts/${file}`, 1,
        `Summary is ${summary.length} characters and becomes the meta description.`,
        'Aim for 70 to 160.');
  }

  /* ---- images: alt text, licence, weight, existence ---- */
  const hero = fm(head, 'hero');
  if (hero) {
    if (!fm(head, 'heroAlt')) {
      add('error', 'a11y', `blog/posts/${file}`, 1, 'Hero image has no heroAlt.',
          'Describe what the image shows. Alt text is not optional.');
    }
    if (!fm(head, 'heroCredit')) {
      add('error', 'legal', `blog/posts/${file}`, 1, 'Hero image has no heroCredit.',
          'Record the licence or source for every published image.');
    }
    checkAsset(hero, `blog/posts/${file}`, 1, MAX_HERO_BYTES);
  }

  for (const m of clean.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g)) {
    const [, alt, src] = m;
    const line = at(m.index);
    if (!alt.trim()) {
      add('error', 'a11y', `blog/posts/${file}`, line, 'Image has empty alt text.',
          'Describe the image, or explain in review why it is decorative.');
    }
    checkAsset(src, `blog/posts/${file}`, line, MAX_IMAGE_BYTES);
  }

  /* ---- answer-engine readiness ---- */
  const firstPara = clean.trim().split(/\n\s*\n/)[0] || '';
  if (words(firstPara) > 60) {
    add('warn', 'ai', `blog/posts/${file}`, headLines + 1,
        `Opening paragraph is ${words(firstPara)} words.`,
        'Answer the question in the first 40 or so words. Engines quote the opening.');
  }
  if (!/^::: +facts/m.test(body)) {
    add('warn', 'ai', `blog/posts/${file}`, 1, 'No facts block.',
        'Add a ::: facts block. It is the part readers skim and engines lift.');
  }
  if (!/^sources:/m.test(head) || /^sources:\s*\[\]\s*$/m.test(head)) {
    add(status === 'ready' ? 'error' : 'warn', 'ai', `blog/posts/${file}`, 1,
        'No sources listed.', 'Cite what the post was checked against, with a URL and what it covers.');
  }
  const h2s = [...clean.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  if (h2s.length && !h2s.some((h) => /^(how|what|when|where|why|can|is|do|does)\b/i.test(h) || h.includes('?'))) {
    add('warn', 'ai', `blog/posts/${file}`, 1, 'No question-shaped headings.',
        'At least one heading phrased as the question a reader would ask helps engines match the page.');
  }

  return { file, slug, status, title };
}

/* Local assets are resolved from the repo root, since that is what
   the deployed site serves. */
function checkAsset(src, file, line, maxBytes) {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return;
  const rel = src.replace(/^\//, '');
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    add('error', 'links', file, line, `Image not found: ${src}`,
        'Add the file, or fix the path. It resolves from the repo root.');
    return;
  }
  const bytes = statSync(abs).size;
  if (bytes > maxBytes) {
    add('warn', 'mobile', file, line,
        `${src} is ${Math.round(bytes / 1024)}KB, over the ${Math.round(maxBytes / 1024)}KB budget.`,
        'Re-export smaller. Most readers are on a phone, often on mobile data.');
  }
}

/* ============================================================
   Built HTML checks. Only ready posts produce HTML, so this runs
   over whatever the generator actually wrote.
   ============================================================ */

const DISCLAIMER = 'not affiliated with or endorsed by Transport for New South Wales';

function checkBuilt(htmlPath, label) {
  const src = readFileSync(htmlPath, 'utf8');

  /* The footer disclaimer must name the authority to do its job, so
     it is removed before the legal rules run over the page. */
  const body = src.replace(/<p class="foot-disclaimer">[\s\S]*?<\/p>/g, '')
                  .replace(/<aside class="sources">[\s\S]*?<\/aside>/g, '');

  for (const rule of LEGAL_RULES) {
    for (const m of body.matchAll(rule.re)) {
      add('error', 'legal', label, lineOf(body, m.index),
          `${rule.msg} Found "${m[0].trim()}" in built output.`, rule.fix);
    }
  }
  for (const rule of COPY_RULES.slice(0, 2)) {
    for (const m of body.matchAll(rule.re)) {
      add('error', 'copy', label, lineOf(body, m.index),
          `${rule.msg} Found in built output.`, rule.fix);
    }
    rule.re.lastIndex = 0;
  }

  if (!src.includes(DISCLAIMER)) {
    add('error', 'legal', label, 1, 'Footer disclaimer missing.',
        'Every page must carry it verbatim.');
  }
  if (!/KRAIL<span class="reg">&reg;<\/span>/.test(src)) {
    add('error', 'legal', label, 1, 'Registered mark missing beside the wordmark.',
        'The wordmark carries the mark on every page.');
  }

  const title = (src.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  if (title.length < 25 || title.length > 60) {
    add(title.length > 60 ? 'error' : 'warn', 'seo', label, 1,
        `Page title is ${title.length} characters.`, 'Aim for 25 to 60.');
  }
  const desc = (src.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  if (!desc) add('error', 'seo', label, 1, 'No meta description.', 'Comes from the summary field.');

  for (const [tag, what] of [['canonical', 'canonical link'], ['og:title', 'Open Graph title'], ['og:image', 'Open Graph image']]) {
    if (!src.includes(tag)) {
      add(tag === 'og:image' ? 'warn' : 'error', 'seo', label, 1, `Missing ${what}.`,
          'Needed for correct indexing and share cards.');
    }
  }

  const ld = [...src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!ld.length) {
    add('error', 'ai', label, 1, 'No structured data.', 'Engines rely on it to understand the page.');
  }
  for (const m of ld) {
    try { JSON.parse(m[1]); }
    catch (e) { add('error', 'ai', label, lineOf(src, m.index), `Structured data is not valid JSON: ${e.message}`, 'Fix the generator template.'); }
  }

  /* Internal links must resolve to something the site actually serves. */
  for (const m of src.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = m[1];
    if (href.startsWith('//')) continue;
    const rel = href.replace(/^\//, '');
    const candidates = [rel, join(rel, 'index.html'), rel + 'index.html'];
    if (!candidates.some((c) => c && existsSync(join(ROOT, c)))) {
      add('warn', 'links', label, lineOf(src, m.index), `Internal link may not resolve: ${href}`,
          'Check the path, or ignore if the target ships in the same commit.');
    }
  }
}

/* ============================================================
   Run
   ============================================================ */

const posts = existsSync(POSTS) ? readdirSync(POSTS).filter((f) => f.endsWith('.md')).sort() : [];
const summaries = posts.map(checkPost);

const built = [];
const blogDir = join(ROOT, 'blog');
if (existsSync(blogDir)) {
  for (const entry of readdirSync(blogDir)) {
    const p = join(blogDir, entry, 'index.html');
    if (entry !== 'posts' && existsSync(p)) built.push([p, `blog/${entry}/index.html`]);
  }
  const idx = join(blogDir, 'index.html');
  if (existsSync(idx)) built.push([idx, 'blog/index.html']);
}
for (const [p, label] of built) checkBuilt(p, label);

/* ---- report ---- */
const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
const GATES = ['copy', 'legal', 'a11y', 'seo', 'ai', 'links', 'mobile'];
const NAMES = { copy: 'Copy and brand', legal: 'Legal and trademark', a11y: 'Accessibility',
                seo: 'SEO', ai: 'Answer engines', links: 'Links and assets', mobile: 'Mobile budget' };

if (AS_MD) {
  console.log('### Content gates\n');
  console.log(`${posts.length} post(s) checked, ${built.length} built page(s).`);
  const ready = summaries.filter((s) => s.status === 'ready');
  const draft = summaries.filter((s) => s.status !== 'ready');
  if (draft.length) {
    console.log(`\n**Not publishing** (${draft.length}): ` + draft.map((d) => `\`${d.file}\``).join(', '));
  }
  console.log(`\n**Publishing** (${ready.length}): ` + (ready.length ? ready.map((d) => `\`${d.slug}\``).join(', ') : 'none') + '\n');

  console.log('| Gate | Result |');
  console.log('|---|---|');
  for (const g of GATES) {
    const e = errors.filter((f) => f.gate === g).length;
    const w = warns.filter((f) => f.gate === g).length;
    console.log(`| ${NAMES[g]} | ${e ? `**${e} blocking**` : 'pass'}${w ? `, ${w} advisory` : ''} |`);
  }
  if (findings.length) {
    console.log('\n<details><summary>Findings</summary>\n');
    console.log('| | File | Line | Finding | Fix |');
    console.log('|---|---|---|---|---|');
    for (const f of [...errors, ...warns]) {
      console.log(`| ${f.level === 'error' ? 'block' : 'note'} | \`${f.file}\` | ${f.line} | ${f.message.replace(/\|/g, '\\|')} | ${f.fix.replace(/\|/g, '\\|')} |`);
    }
    console.log('\n</details>');
  }
} else {
  console.log(`\n  Content gates over ${posts.length} post(s), ${built.length} built page(s)\n`);
  for (const g of GATES) {
    const e = errors.filter((f) => f.gate === g).length;
    const w = warns.filter((f) => f.gate === g).length;
    const state = e ? `FAIL ${e}` : 'PASS  ';
    console.log(`  [${state}] ${NAMES[g]}${w ? `  (${w} advisory)` : ''}`);
  }
  if (findings.length) console.log('');
  for (const f of [...errors, ...warns]) {
    console.log(`  ${f.level === 'error' ? 'BLOCK' : ' note'}  ${f.file}:${f.line}`);
    console.log(`         ${f.message}`);
    console.log(`         fix: ${f.fix}`);
  }
  console.log('');
  for (const s of summaries) {
    console.log(`  ${s.status === 'ready' ? 'publishing' : 'holding   '}  ${s.file}${s.status === 'ready' ? '' : `  (status: ${s.status || 'unset'})`}`);
  }
  console.log('');
}

process.exit(errors.length || (STRICT && warns.length) ? 1 : 0);
