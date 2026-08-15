#!/usr/bin/env node
/* ============================================================
   KRAIL Journal generator.

   Reads blog/posts/*.md and writes the whole Journal: the index,
   one page per post, plus feed.xml, sitemap.xml and llms.txt.

   Two rules shape everything here.

   1. Deterministic. No timestamps, no clock, no random ordering.
      An unchanged post must produce a byte-identical file, because
      the deploy works by committing this output back to main and a
      churning diff would make those commits meaningless.

   2. Nothing internal escapes. `sourceRef` and anything else marked
      internal is read but never rendered.

   Usage:
     node tools/build-blog.mjs
     node tools/build-blog.mjs --check    build to memory, write nothing
   ============================================================ */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'blog', 'posts');
const OUT_DIR = join(ROOT, 'blog');
const SITE = 'https://krail.app';
const CHECK_ONLY = process.argv.includes('--check');

/* ============================================================
   Categories. `series` in frontmatter maps to a label and the
   mode colour that drives the whole page accent.
   ============================================================ */
const CATEGORIES = {
  'things-to-do':      { label: 'Things to do',      order: 1 },
  'eat-and-drink':     { label: 'Eat and drink',     order: 2 },
  'app':               { label: 'App showcase',      order: 3 },
  'behind-the-scenes': { label: 'Behind the scenes', order: 4 },
  'news':              { label: 'News',              order: 5 },
};

/* ============================================================
   Small helpers
   ============================================================ */

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

/* Dates are parsed as plain fields, never through Date(), so the
   output cannot drift with the machine's timezone. */
const parseDate = (iso) => {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Bad date "${iso}". Use YYYY-MM-DD.`);
  return { y: +m[1], m: +m[2], d: +m[3], iso: `${m[1]}-${m[2]}-${m[3]}` };
};
const longDate  = (d) => `${d.d} ${MONTHS[d.m - 1]} ${d.y}`;
const shortDate = (d) => `${d.d} ${MONTHS[d.m - 1].slice(0, 3)} ${d.y}`;
const rfcDate   = (d) => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][
  /* Zeller, so no Date object is needed */
  (() => { let y = d.y, m = d.m; if (m < 3) { m += 12; y -= 1; }
    const K = y % 100, J = Math.floor(y / 100);
    return (d.d + Math.floor(13 * (m + 1) / 5) + K + Math.floor(K / 4) + Math.floor(J / 4) + 5 * J) % 7;
  })()]}, ${String(d.d).padStart(2,'0')} ${MONTHS[d.m-1].slice(0,3)} ${d.y} 00:00:00 +1000`;

const readingTime = (markdown) => {
  const words = markdown.replace(/[#*_>`\[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
};

/* ============================================================
   Frontmatter. A deliberately small YAML subset: scalars, and one
   level of list-of-objects for `sources`. Anything more exotic is
   a bug in the post, not a feature we are missing.
   ============================================================ */
function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: no frontmatter block.`);
  const [, head, body] = m;

  const data = {};
  let listKey = null;
  let current = null;

  const unquote = (v) => {
    const t = v.trim();
    if (t === 'null' || t === '') return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  };

  for (const line of head.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const item = line.match(/^\s{2,}-\s+(\w+):\s*(.*)$/);   //   - url: ...
    if (item && listKey) {
      current = { [item[1]]: unquote(item[2]) };
      data[listKey].push(current);
      continue;
    }
    /* A plain scalar list item, as tags use. Checked after the
       key/value form so `- url: https://...` is not mistaken for one.
       A tag containing a colon would misparse, so do not use one. */
    const scalar = line.match(/^\s{2,}-\s+(.+)$/);
    if (scalar && listKey) { data[listKey].push(unquote(scalar[1])); current = null; continue; }
    const cont = line.match(/^\s{4,}(\w+):\s*(.*)$/);       //     for: ...
    if (cont && current) { current[cont[1]] = unquote(cont[2]); continue; }

    const top = line.match(/^(\w+):\s*(.*)$/);
    if (top) {
      const [, key, value] = top;
      if (value.trim() === '') { data[key] = []; listKey = key; current = null; }
      else { data[key] = unquote(value); listKey = null; current = null; }
    }
  }
  return { data, body: body.trim() };
}

/* ============================================================
   Container blocks.

   Pulled out before marked runs, rendered by hand, then put back.
   Doing it this way keeps us off marked's extension API, which has
   changed shape between major versions.

     ::: facts The trip, in short
     When: **22 to 30 August 2026**
     :::

     ::: callout Do this first
     Book the ticket before you plan the trip.
     :::
   ============================================================ */
function extractContainers(md) {
  const blocks = [];
  const out = md.replace(/^::: +(facts|callout)(?: +([^\n]*))?\n([\s\S]*?)^:::\s*$/gm,
    (_all, kind, title, content) => {
      blocks.push({ kind, title: (title || '').trim(), content: content.trim() });
      return `\n\nKRAILBLOCK${blocks.length - 1}KRAILBLOCK\n\n`;
    });
  return { md: out, blocks };
}

function renderContainer(block) {
  const inline = (s) => marked.parseInline(s);
  if (block.kind === 'facts') {
    const rows = block.content.split(/\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const i = line.indexOf(':');
      if (i < 0) return '';
      return `        <div><dt>${esc(line.slice(0, i).trim())}</dt>` +
             `<dd>${inline(line.slice(i + 1).trim())}</dd></div>`;
    }).filter(Boolean).join('\n');
    return `    <div class="facts">\n` +
           `      <p class="block-title">${esc(block.title || 'In short')}</p>\n` +
           `      <dl>\n${rows}\n      </dl>\n    </div>`;
  }
  return `    <div class="callout">\n` +
         (block.title ? `      <span class="callout-label">${esc(block.title)}</span>\n` : '') +
         `      ${inline(block.content)}\n    </div>`;
}

/* ============================================================
   Image styles, chosen per image in the markdown title slot.

     ![alt](src)                       plain framed card
     ![alt](src "Caption here")        plain, with caption
     ![alt](src "phone")               device frame
     ![alt](src "phone | Caption")     device frame, with caption
     ![alt](src "bleed | Caption")     breaks past the prose column

   One phone per stage. Two framed devices side by side never sit
   symmetrically, so a post needing two screens uses two stages.
   ============================================================ */
const STYLES = new Set(['plain', 'phone', 'bleed']);

function renderImage(href, title, alt, defaultStyle) {
  let style = defaultStyle;
  let caption = '';
  if (title) {
    const [first, ...rest] = title.split('|');
    if (STYLES.has(first.trim())) { style = first.trim(); caption = rest.join('|').trim(); }
    else caption = title.trim();
  }
  const img = `<img src="${esc(href)}" alt="${esc(alt)}" loading="lazy" decoding="async" />`;
  const cap = caption ? `\n      <figcaption>${esc(caption)}</figcaption>` : '';

  if (style === 'phone') {
    return `<figure class="shot-stage">\n      <div class="shot-row">\n` +
           `        <div class="phone">\n          <div class="notch"></div>\n` +
           `          <div class="screen">${img}</div>\n        </div>\n` +
           `      </div>${cap}\n    </figure>`;
  }
  const cls = style === 'bleed' ? ' class="bleed"' : '';
  return `<figure${cls}>\n      ${img}${cap}\n    </figure>`;
}

function renderMarkdown(md, defaultStyle) {
  const { md: stripped, blocks } = extractContainers(md);

  const renderer = {
    image(href, title, text) { return renderImage(href, title, text, defaultStyle); },
    link(href, title, text) {
      const external = /^https?:\/\//.test(href) && !href.startsWith(SITE);
      const extra = external ? ' target="_blank" rel="noopener"' : '';
      const t = title ? ` title="${esc(title)}"` : '';
      return `<a href="${esc(href)}"${t}${extra}>${text}</a>`;
    },
  };
  marked.use({ renderer, mangle: false, headerIds: false });

  let html = marked.parse(stripped);
  html = html.replace(/<p>KRAILBLOCK(\d+)KRAILBLOCK<\/p>/g, (_m, i) => renderContainer(blocks[+i]));
  return html.trim();
}

/* ============================================================
   Shared chrome
   ============================================================ */
const ARROW = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>';

const SQUIGGLE = '<svg aria-hidden="true" class="sq-line" viewBox="0 0 100 10" preserveAspectRatio="none"><path class="stroke-bold" pathLength="100" d="M0 5 Q 5 0 10 5 T 20 5 T 30 5 T 40 5 T 50 5 T 60 5 T 70 5 T 80 5 T 90 5 T 100 5"/><path class="stroke-thin" pathLength="100" d="M0 5 Q 5 0 10 5 T 20 5 T 30 5 T 40 5 T 50 5 T 60 5 T 70 5 T 80 5 T 90 5 T 100 5"/></svg>';

const MODE_PILLS = ['train','metro','bus','ferry','lr','coach']
  .map((m, i) => `      <span class="mp" style="background:var(--${m})">${'TMBFLC'[i]}</span>`).join('\n');

const nav = (current) => `<nav class="top" aria-label="Main">
  <div class="row">
    <a href="/" class="brand">KRAIL<span class="reg">&reg;</span></a>
    <div class="nav-links">
      <a href="/#features">Features</a>
      <a href="/blog/" class="keep"${current === 'blog' ? ' aria-current="page"' : ''}>Journal</a>
      <a href="/#faq">FAQ</a>
    </div>
    <a href="/#download" class="stamp">Get the app ${ARROW}</a>
  </div>
</nav>`;

const footer = () => `<footer class="foot">
  <div class="container">
    <div class="foot-mark">
      <span class="lets-krail lets-krail-big">#LET'S KRAIL</span>
      <span class="made-in">Built with <span class="heart">&hearts;</span> in Sydney</span>
    </div>

    <div class="foot-pills" aria-hidden="true">
${MODE_PILLS}
    </div>
    <p class="foot-pills-caption">All Sydney transport modes covered.</p>

    <div class="foot-coda">
      <span class="copy">&copy; 2024 KRAIL<span class="reg">&reg;</span>, all rights reserved.</span>
      <nav class="foot-nav" aria-label="Footer">
        <a href="/blog/">Journal</a>
        <a href="/privacy-policy/">Privacy policy</a>
        <a href="/#contact">Contact</a>
      </nav>
    </div>

    <p class="foot-disclaimer">
      <span class="label">Disclaimer</span>
      This app is not affiliated with or endorsed by Transport for New South Wales (TfNSW).
      The data presented in this app is sourced from public APIs and services provided by TfNSW,
      and while we strive to ensure the accuracy and timeliness of the information, we cannot
      guarantee it. Users should verify all information independently.
    </p>
  </div>
</footer>`;

const head = ({ title, description, canonical, image, jsonld = [] }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#FF2F8F">

<meta property="og:type" content="${canonical.endsWith('/blog/') ? 'website' : 'article'}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />${image ? `
<meta property="og:image" content="${esc(SITE + image)}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />

<link rel="alternate" type="application/rss+xml" title="KRAIL Journal" href="/blog/feed.xml" />

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Roboto:wght@900&display=swap">
<link rel="stylesheet" media="print" onload="this.media='all'" href="https://fonts.googleapis.com/css2?family=Roboto:wght@900&display=swap">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@900&display=swap"></noscript>

<link rel="stylesheet" href="/blog.css" />
<link rel="stylesheet" href="/blog.tokens.css" />
${jsonld.map((j) => `<script type="application/ld+json">\n${JSON.stringify(j, null, 2)}\n</script>`).join('\n')}
</head>`;

/* Splits a headline so the last word or two carry the accent and
   the squiggle. Frontmatter can override with `accent`. */
function splitHeadline(title, accent) {
  if (accent && title.endsWith(accent)) {
    return [title.slice(0, -accent.length).trim(), accent];
  }
  const words = title.trim().split(/\s+/);
  return [words.slice(0, -1).join(' '), words.slice(-1).join(' ')];
}

/* ============================================================
   Post page
   ============================================================ */
function renderPost(post, prev, next) {
  const { data, html, minutes, date, cat } = post;
  const [lead, accent] = splitHeadline(data.title, data.accent);
  const url = `${SITE}/blog/${data.slug}/`;

  const jsonld = [{
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: data.title,
    description: data.summary,
    datePublished: date.iso,
    dateModified: date.iso,
    author: { '@type': 'Person', name: data.author || 'Karan Sharma' },
    publisher: { '@type': 'Organization', name: 'KRAIL' },
    mainEntityOfPage: url,
    ...(data.hero ? { image: SITE + data.hero } : {}),
  }];

  const sources = Array.isArray(data.sources) && data.sources.length ? `
  <aside class="sources">
    <p class="block-title">Checked against</p>
    <ol>
${data.sources.map((s) => `      <li>
        <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>
        <span class="for">${esc(s.for || '')}</span>
      </li>`).join('\n')}
    </ol>
    <p class="checked">Last checked ${longDate(date)}. Details can change, so verify on the day.</p>
  </aside>` : '';

  const tags = Array.isArray(data.tags) && data.tags.length ? `
    <div class="tags-row">
${data.tags.map((t) => `      <span class="tag-pill">${esc(t)}</span>`).join('\n')}
    </div>` : '';

  const pn = (prev || next) ? `
    <div class="prevnext">
${prev ? `      <a class="pn prev" href="/blog/${prev.data.slug}/">
        <span class="dir">Previous</span>
        <span class="pn-title">${esc(prev.data.title)}</span>
      </a>` : ''}
${next ? `      <a class="pn next" href="/blog/${next.data.slug}/">
        <span class="dir">Next</span>
        <span class="pn-title">${esc(next.data.title)}</span>
      </a>` : ''}
    </div>` : '';

  return `${head({ title: data.title, description: data.summary, canonical: url, image: data.hero, jsonld })}
<body data-cat="${esc(data.series)}">

<div class="progress" aria-hidden="true"></div>

${nav()}

<main class="post-wrap">

<header class="post-head">
  <div class="container prose">
    <a class="backlink" href="/blog/">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 19l-7-7 7-7"/></svg>
      All stories
    </a>

    <div class="post-tag"><span class="tag">${esc(cat.label)}</span></div>

    <h1 class="post-title">${esc(lead)}
      <span class="accent-word">${esc(accent)}${SQUIGGLE}</span>
    </h1>

    <p class="post-deck">${esc(data.summary)}</p>

    <div class="post-meta">
      <span class="byline">${esc(data.author || 'Karan Sharma')}</span>
      <span class="sep"></span>
      <time datetime="${date.iso}">${longDate(date)}</time>
      <span class="sep"></span>
      <span>${minutes} min read</span>
    </div>
  </div>
${data.hero ? `
  <div class="container narrow">
    <figure class="post-hero anim">
      <img src="${esc(data.hero)}" alt="${esc(data.heroAlt || '')}" fetchpriority="high" decoding="async" />${data.heroCredit ? `
      <figcaption>${esc(data.heroCredit)}</figcaption>` : ''}
    </figure>
  </div>` : ''}
</header>

<article class="container prose">
  <div class="prose-body">
${html.split('\n').map((l) => (l ? '    ' + l : l)).join('\n')}
  </div>
${sources}

  <div class="post-foot">${tags}${pn}

    <section class="band anim">
      <div>
        <h2>${esc(data.ctaTitle || 'Check the next one on the day, not the day before.')}</h2>
        <p>${esc(data.ctaBody || 'Save the trip once and the next departure is one tap away. Free for every Sydney commuter until December 2026, no ads during the launch period.')}</p>
      </div>
      <div class="band-actions">
        <a class="stamp" href="/#download">Get the app ${ARROW}</a>
      </div>
    </section>
  </div>
</article>

</main>

${footer()}

<script src="/blog.js"></script>
</body>
</html>
`;
}

/* ============================================================
   Index page
   ============================================================ */
function renderIndex(posts) {
  const [featured, ...rest] = posts;
  const usedCats = [...new Set(posts.map((p) => p.data.series))]
    .sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order);

  const card = (p) => `      <a class="card anim" href="/blog/${p.data.slug}/" data-cat="${esc(p.data.series)}">
${p.data.hero ? `        <div class="card-media"><img src="${esc(p.data.hero)}" alt="${esc(p.data.heroAlt || '')}" loading="lazy" decoding="async" /></div>` : ''}
        <div class="card-body">
          <span class="tag">${esc(p.cat.label)}</span>
          <h3>${esc(p.data.title)}</h3>
          <p class="excerpt">${esc(p.data.summary)}</p>
          <div class="meta"><time datetime="${p.date.iso}">${shortDate(p.date)}</time><span class="sep"></span><span>${p.minutes} min read</span></div>
        </div>
      </a>`;

  const jsonld = [{
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'KRAIL Journal',
    url: `${SITE}/blog/`,
    description: 'Things to do, places to eat, app stories and behind the scenes, written for people who actually catch the train in Sydney.',
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.data.title,
      url: `${SITE}/blog/${p.data.slug}/`,
      datePublished: p.date.iso,
    })),
  }];

  return `${head({
    title: 'KRAIL Journal, stories from the Sydney commute',
    description: 'Things to do, places to eat, app stories and behind the scenes, all written for people who actually catch the train in Sydney.',
    canonical: `${SITE}/blog/`,
    image: featured?.data.hero,
    jsonld,
  })}
<body>

${nav('blog')}

<main>

<section class="masthead" style="--accent: var(--brand-pink);">
  <div class="container">
    <span class="eyebrow">The KRAIL Journal</span>
    <h1>Stories from the Sydney
      <span class="accent-word">commute.${SQUIGGLE}</span>
    </h1>
    <p class="deck">Where to go, where to eat, what we are building, and what it takes to run a transport app from a Sydney bedroom. Written for people who actually catch the train.</p>

    <div class="chips" role="group" aria-label="Filter posts by category">
      <button class="chip" data-filter="all" aria-pressed="true" style="--accent: var(--brand-pink);"><span class="dotk"></span>All</button>
${usedCats.map((c) => `      <button class="chip" data-filter="${c}" aria-pressed="false" data-cat="${c}"><span class="dotk"></span>${esc(CATEGORIES[c].label)}</button>`).join('\n')}
    </div>
  </div>
</section>
${featured ? `
<section class="featured">
  <div class="container">
    <a class="featured-card anim" href="/blog/${featured.data.slug}/" data-cat="${esc(featured.data.series)}">
${featured.data.hero ? `      <div class="featured-media">
        <span class="featured-flag">Latest</span>
        <img src="${esc(featured.data.hero)}" alt="${esc(featured.data.heroAlt || '')}" fetchpriority="high" decoding="async" />
      </div>` : ''}
      <div class="featured-body">
        <span class="tag">${esc(featured.cat.label)}</span>
        <h2>${esc(featured.data.title)}</h2>
        <p class="excerpt">${esc(featured.data.summary)}</p>
        <span class="stamp ghost">Read the story ${ARROW}</span>
        <div class="meta">
          <time datetime="${featured.date.iso}">${shortDate(featured.date)}</time>
          <span class="sep"></span>
          <span>${featured.minutes} min read</span>
        </div>
      </div>
    </a>
  </div>
</section>` : ''}
${rest.length ? `
<section class="grid-section">
  <div class="container">
    <div class="grid-head anim">
      <h2>Everything else</h2>
      <span class="count" id="postCount">${rest.length} ${rest.length === 1 ? 'story' : 'stories'}</span>
    </div>

    <div class="card-grid" id="cardGrid">
${rest.map(card).join('\n\n')}
    </div>
  </div>
</section>` : ''}

</main>

${footer()}

<script src="/blog.js"></script>
</body>
</html>
`;
}

/* ============================================================
   Feeds
   ============================================================ */
const renderFeed = (posts) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>KRAIL Journal</title>
    <link>${SITE}/blog/</link>
    <description>Stories from the Sydney commute.</description>
    <language>en-au</language>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml" />
${posts.map((p) => `    <item>
      <title>${esc(p.data.title)}</title>
      <link>${SITE}/blog/${p.data.slug}/</link>
      <guid isPermaLink="true">${SITE}/blog/${p.data.slug}/</guid>
      <pubDate>${rfcDate(p.date)}</pubDate>
      <description>${esc(p.data.summary)}</description>
      <category>${esc(p.cat.label)}</category>
    </item>`).join('\n')}
  </channel>
</rss>
`;

const renderSitemap = (posts) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/blog/</loc><changefreq>weekly</changefreq></url>
${posts.map((p) => `  <url><loc>${SITE}/blog/${p.data.slug}/</loc><lastmod>${p.date.iso}</lastmod></url>`).join('\n')}
</urlset>
`;

/* A plain-text map for answer engines. Cheap to produce, and it
   gives a crawler the shape of the Journal without parsing HTML. */
const renderLlms = (posts) => `# KRAIL Journal

Stories from the Sydney commute. Things to do, places to eat, app stories
and behind the scenes, written for people who actually catch the train.

KRAIL is a Sydney public transport app. It is not affiliated with or
endorsed by Transport for New South Wales.

## Posts

${posts.map((p) => `- [${p.data.title}](${SITE}/blog/${p.data.slug}/): ${p.data.summary} (${p.cat.label}, ${longDate(p.date)})`).join('\n')}
`;

/* ============================================================
   Build
   ============================================================ */
function build() {
  if (!existsSync(POSTS_DIR)) {
    console.log(`\n  No ${POSTS_DIR}. Nothing to build.\n`);
    return { files: 0, posts: 0 };
  }

  const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md')).sort();
  const posts = [];
  const skipped = [];

  for (const file of files) {
    const raw = readFileSync(join(POSTS_DIR, file), 'utf8');
    const { data, body } = parseFrontmatter(raw, file);

    for (const key of ['title', 'slug', 'series', 'summary', 'updated']) {
      if (!data[key]) throw new Error(`${file}: missing required frontmatter "${key}".`);
    }
    const cat = CATEGORIES[data.series];
    if (!cat) throw new Error(`${file}: unknown series "${data.series}". Valid: ${Object.keys(CATEGORIES).join(', ')}`);

    if (data.status !== 'ready') { skipped.push(`${file} (status: ${data.status || 'unset'})`); continue; }

    /* Internal-only fields are read, never rendered. */
    delete data.sourceRef;

    posts.push({
      data, cat,
      date: parseDate(data.updated),
      minutes: readingTime(body),
      html: renderMarkdown(body, STYLES.has(data.imageStyle) ? data.imageStyle : 'plain'),
    });
  }

  /* Newest first, slug as the tiebreak so ordering never depends on
     filesystem order. */
  posts.sort((a, b) => b.date.iso.localeCompare(a.date.iso) || a.data.slug.localeCompare(b.data.slug));

  const written = [];
  const write = (path, contents) => {
    written.push(path);
    if (CHECK_ONLY) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };

  posts.forEach((p, i) => {
    write(join(OUT_DIR, p.data.slug, 'index.html'),
          renderPost(p, posts[i + 1], posts[i - 1]));
  });
  write(join(OUT_DIR, 'index.html'), renderIndex(posts));
  write(join(OUT_DIR, 'feed.xml'), renderFeed(posts));
  write(join(OUT_DIR, 'sitemap.xml'), renderSitemap(posts));
  write(join(OUT_DIR, 'llms.txt'), renderLlms(posts));

  console.log(`\n  ${CHECK_ONLY ? 'Checked' : 'Built'} ${posts.length} post(s), ${written.length} file(s).`);
  for (const p of posts) console.log(`    /blog/${p.data.slug}/   ${p.cat.label}, ${p.minutes} min`);
  if (skipped.length) {
    console.log(`\n  Skipped, not marked ready:`);
    for (const s of skipped) console.log(`    ${s}`);
  }
  console.log('');
  return { files: written.length, posts: posts.length };
}

try {
  build();
} catch (err) {
  console.error(`\n  Build failed: ${err.message}\n`);
  process.exit(1);
}
