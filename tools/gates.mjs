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

/* ============================================================
   Image licensing.

   The rule is absolute: we publish an image only when we are
   legally allowed to and the credit is on the page. Otherwise we
   do not use it. There is no "ship it and sort the licence out
   later" state, because the shipping is the part that matters.

   images/CREDITS.json is the register. Presence of a credit line
   was never enough on its own, a heroCredit reading "TODO, needs a
   real photo" passed the old check while saying in plain words
   that the image was not cleared. So three things are checked:
   the image is registered, the register entry is real rather than
   a placeholder, and for anything we did not make ourselves the
   creator and licence actually appear in the visible credit.
   ============================================================ */
const CREDITS_PATH = join(ROOT, 'images', 'CREDITS.json');
let CREDITS = {};
try {
  CREDITS = JSON.parse(readFileSync(CREDITS_PATH, 'utf8'));
} catch (err) {
  console.error(`Cannot read images/CREDITS.json: ${err.message}`);
  process.exit(2);
}

/* Words that mean the licence question is still open. Any of these
   in a credit or a register entry is treated as "not cleared". */
const PLACEHOLDER = /\b(TODO|TBD|FIXME|placeholder|swap for|needs? a real|coming soon|temp(?:orary)?)\b/i;

const OWN_WORK = /^own work$/i;

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

  /* ---- notes to ourselves ----

     The Tallawong draft carried a comment reading "PLACEHOLDER POST,
     the numbers are not real", and it was reaching the served HTML
     because markdown passes comments through. The generator strips
     them now, but stripping is not the whole answer: a post whose own
     note says the content is invented should not be publishable at
     all, whether or not the note is visible.

     The comment also ended "it is status: draft so it cannot ship as
     is", which stopped being true the moment someone set it to ready.
     A note is not a gate. This is the gate. */
  for (const m of body.matchAll(/<!--[\s\S]*?-->/g)) {
    const note = m[0];
    add(status === 'ready' ? 'error' : 'warn', 'copy', `blog/posts/${file}`,
        headLines + lineOf(body, m.index),
        'Comment in the post body.',
        'Comments are notes to us. Delete it, or move it to a frontmatter field that is never rendered.');
    if (PLACEHOLDER.test(note) || /\b(not real|do not ship|don't ship|rewrite|delete this file)\b/i.test(note)) {
      add('error', 'copy', `blog/posts/${file}`, headLines + lineOf(body, m.index),
          'The post says of itself that it is a placeholder or that its content is not real.',
          'Believe it. Rewrite it from something true, or delete the file. Do not publish it and fix it later.');
    }
  }

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
    const heroCredit = fm(head, 'heroCredit');
    if (!heroCredit) {
      add('error', 'legal', `blog/posts/${file}`, 1, 'Hero image has no heroCredit.',
          'Record the licence or source for every published image.');
    }
    checkAsset(hero, `blog/posts/${file}`, 1, MAX_HERO_BYTES);
    checkLicence(hero, heroCredit, `blog/posts/${file}`, 1, status, 'Hero image');
  }

  for (const m of clean.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g)) {
    const [, alt, src, title] = m;
    const line = at(m.index);
    if (!alt.trim()) {
      add('error', 'a11y', `blog/posts/${file}`, line, 'Image has empty alt text.',
          'Describe the image, or explain in review why it is decorative.');
    }
    checkAsset(src, `blog/posts/${file}`, line, MAX_IMAGE_BYTES);
    /* The title doubles as the style token and the caption, and it is
       the caption half that carries the credit on the page. */
    const caption = (title || '').includes('|')
      ? (title || '').slice((title || '').indexOf('|') + 1).trim()
      : (title || '').trim();
    checkLicence(src, caption, `blog/posts/${file}`, line, status, `Image ${src}`);
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
  /* App-tour posts show our own screens, so there is nothing external
     to cite. Every other series still has to say what it checked. */
  const series = fm(head, 'series');
  if (series !== 'app' && (!/^sources:/m.test(head) || /^sources:\s*\[\]\s*$/m.test(head))) {
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

/* ============================================================
   The licence check.

   Blocks a ready post, warns on a draft, which is the same shape
   the `sources` gate uses. Drafting with a rough image is fine.
   Publishing one that is not cleared is not.
   ============================================================ */
function checkLicence(src, credit, file, line, status, label) {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) {
    add(status === 'ready' ? 'error' : 'warn', 'legal', file, line,
        `${label} is hotlinked from another origin.`,
        'Copy it into images/, register it in images/CREDITS.json, and serve it ourselves.');
    return;
  }

  const level = status === 'ready' ? 'error' : 'warn';
  const entry = CREDITS[src];

  if (!entry) {
    add(level, 'legal', file, line, `${label} is not in images/CREDITS.json.`,
        'Add an entry naming the creator and the licence. An image we cannot credit is an image we do not publish.');
    return;
  }

  const licence = String(entry.licence || '').trim();
  const creator = String(entry.creator || '').trim();

  if (!licence || PLACEHOLDER.test(licence)) {
    add(level, 'legal', file, line, `${label} has no settled licence in the register.`,
        'Name the actual licence, or drop the image. "Sort it out later" is not a licence.');
    return;
  }
  if (!creator || PLACEHOLDER.test(creator)) {
    add(level, 'legal', file, line, `${label} has no creator in the register.`,
        'Name who made it. "Own work" images still need a creator.');
    return;
  }

  if (credit && PLACEHOLDER.test(credit)) {
    add(level, 'legal', file, line, `${label} has a placeholder credit on the page.`,
        'The credit is what the reader sees. It has to be the real one before this ships.');
    return;
  }

  /* Our own work needs no visible credit and no source URL. Anything
     else does, and the attribution has to be on the page rather than
     only in the register, which is the whole point of attribution. */
  if (OWN_WORK.test(licence)) return;

  if (!entry.source) {
    add(level, 'legal', file, line, `${label} is third party but has no source URL in the register.`,
        'Record where it came from, so the licence claim can be checked by someone who is not us.');
  }
  if (/^CC\b/i.test(licence) && !entry.licenceUrl) {
    add(level, 'legal', file, line, `${label} is Creative Commons but has no licenceUrl in the register.`,
        'Creative Commons attribution has to link the licence deed.');
  }

  if (!credit) {
    add(level, 'legal', file, line, `${label} is third party but carries no visible credit.`,
        `Put the credit in the caption: photo by ${creator}, licensed ${licence}.`);
    return;
  }
  if (!credit.includes(creator)) {
    add(level, 'legal', file, line, `${label} does not name ${creator} in its visible credit.`,
        'Attribution means the creator is named on the page, not only in the register.');
  }
  if (!credit.toLowerCase().includes(licence.toLowerCase())) {
    add(level, 'legal', file, line, `${label} does not name its licence (${licence}) in the visible credit.`,
        'State the licence next to the creator, so a reader can see the terms the image is used under.');
  }
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

  /* Belt and braces on "nothing internal escapes". The build strips
     comments now, but a comment reaching the served HTML is the kind
     of leak that is only ever found by a reader, so it is checked on
     the output too rather than trusted to the generator. */
  for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) {
    add('error', 'legal', label, lineOf(src, m.index),
        `HTML comment in built output: ${m[0].slice(0, 60).replace(/\s+/g, ' ')}...`,
        'Comments in a post are notes to us. Delete it, or move it to frontmatter.');
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

/* ============================================================
   Hand-authored pages.

   The gates above only ever saw blog/, so the landing page drifted:
   it carried a middle dot in its own <title>, in nine alt attributes
   and in a CSS ::before that generated one into the footer. The
   punctuation rules are voice rules, they do not stop at the Journal.

   Only the two punctuation rules run here. The legal rules would
   misfire on the FAQ, which legitimately names TfNSW as the source
   it cites, and that is the documented citation exception.
   ============================================================ */
/* privacy-policy/ is deliberately absent. It is reproduced verbatim
   from krail.app and is a legal document, so its punctuation is not
   ours to rewrite. A voice rule does not outrank an exact copy. */
const HAND_WRITTEN = ['index.html'];

for (const rel of HAND_WRITTEN) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, 'utf8');

  /* Stylesheets, scripts and comments are not user-visible, and the
     comments are full of section headers that use these characters
     deliberately. What survives this strip is what a reader sees.

     Newlines are kept so a reported line number still points at the
     real line in the file. Blanking them out would make every
     finding after the first <style> block cite the wrong place. */
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const visible = src
    .replace(/<style[\s\S]*?<\/style>/gi, blank)
    .replace(/<script[\s\S]*?<\/script>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);

  /* A rule can also fire from generated content, which no amount of
     reading the markup will reveal. Checked separately, and only
     inside a content: property so a section header comment is safe. */
  for (const m of src.matchAll(/content\s*:\s*(['"])([^'"]*)\1/g)) {
    if (/[—·•‧∙]/.test(m[2])) {
      add('error', 'copy', rel, lineOf(src, m.index),
          `CSS generates "${m[2]}" into the page.`,
          'Draw the separator as a box with content:"" plus width, height and background.');
    }
  }

  for (const rule of COPY_RULES.slice(0, 2)) {
    rule.re.lastIndex = 0;
    for (const m of visible.matchAll(rule.re)) {
      add('error', 'copy', rel, lineOf(visible, m.index), rule.msg, rule.fix);
    }
    rule.re.lastIndex = 0;
  }
}

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
