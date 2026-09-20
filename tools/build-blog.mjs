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

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  const out = md.replace(/^::: +(facts|callout|shot|highlight)(?: +([^\n]*))?\n([\s\S]*?)^:::\s*$/gm,
    (_all, kind, title, content) => {
      blocks.push({ kind, title: (title || '').trim(), content: content.trim() });
      return `\n\nKRAILBLOCK${blocks.length - 1}KRAILBLOCK\n\n`;
    });
  return { md: out, blocks };
}

/* ============================================================
   ::: shot · the step, beside the screen it happens on

   A tall phone screenshot run full width across a reading column is a
   bad trade: the column is 760px and the screen is 1206 by 2622, so it
   arrives either enormous or letterboxed, and either way the sentence
   explaining it has scrolled off. The landing page already solved this
   for features, with copy one side and the device the other and a
   `reverse` class to alternate. This is the same block for prose.

     ::: shot
     ![The Park and Ride card opened](/images/krail/x.mp4 "One tap to open.")

     Tap the station and the three car parks unfold, each with its
     own count and its own update time.
     :::

   The first image line in the block is the device. Everything else is
   the text column, so it takes ordinary markdown: paragraphs, a list,
   bold, a sub-heading. `::: shot flip` puts the device on the left.

   One device per block. Two frames side by side never sit symmetrically,
   which is the same reason `.shot-row` only ever holds one.
   ============================================================ */
function renderShot(block) {
  const m = block.content.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)[ \t]*$/m);

  /* No image means no device to place. Degrade to the author's prose in a
     single column rather than swallowing the block. */
  if (!m) {
    return `    <div class="shot-aside shot-aside--bare">\n` +
           `      <div class="shot-aside__text">\n${indent(marked.parse(block.content), 8)}\n      </div>\n` +
           `    </div>`;
  }

  const [raw, alt, src, caption] = m;
  const prose = block.content.replace(raw, '').trim();
  const flip = /\b(flip|reverse)\b/i.test(block.title || '');
  const cap = caption
    ? `\n        <figcaption>${renderCredit(src, caption)}</figcaption>`
    : '';

  return `    <div class="shot-aside${flip ? ' reverse' : ''}">\n` +
         `      <div class="shot-aside__text">\n${indent(marked.parse(prose), 8)}\n      </div>\n` +
         `      <figure class="shot-aside__device">\n` +
         `        ${deviceFrame(mediaTag(src, alt))}${cap}\n` +
         `      </figure>\n` +
         `    </div>`;
}

const indent = (s, n) =>
  s.trimEnd().split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function renderContainer(block) {
  const inline = (s) => marked.parseInline(s);
  if (block.kind === 'shot') return renderShot(block);
  /* The pull quote. No label and no attribution, because nobody said it:
     it is the author's own line, stepped up because it is the one a reader
     skimming the post should not miss. */
  if (block.kind === 'highlight') {
    return `    <p class="highlight">${inline(block.content)}</p>`;
  }
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
/* ============================================================
   Stylesheet cache busting.

   The stylesheet URLs never changed, so a browser holding an old
   copy kept serving it after the tokens were regenerated. That is
   how a post with `tone: metro` still rendered train orange: the
   markup was right, the cached CSS simply had no [data-tone] rules
   in it yet. Hard-refreshing is not a fix, a real reader will not
   do that.

   A content hash keeps the build deterministic. Same bytes in,
   same URL out, so an unchanged post still produces a byte
   identical page and the deploy diff stays meaningful.
   ============================================================ */
const assetVersion = (rel) => {
  try {
    return createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex').slice(0, 8);
  } catch {
    return '0';
  }
};

/* ============================================================
   Image credits.

   images/CREDITS.json is the register the legal gate enforces. The
   build reads it too, so a credit can be rendered as real links
   rather than escaped text.

   That matters for more than tidiness. Creative Commons attribution
   asks for a link to the licence deed and a route back to the
   original, and a URL sitting in a figcaption as plain text is
   neither. Nothing here invents a credit: the author still writes
   the line, this only turns what is already in it into anchors.
   ============================================================ */
let CREDITS = {};
try {
  CREDITS = JSON.parse(readFileSync(join(ROOT, 'images', 'CREDITS.json'), 'utf8'));
} catch { /* The gate reports a missing register. The build carries on. */ }

const anchor = (href, label) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener nofollow">${label}</a>`;

/* Runs over already-escaped text, so the href is unescaped back to a
   real URL before it goes in the attribute and is then re-escaped. */
const linkifyUrls = (escaped) =>
  escaped.replace(/\b((?:https?:\/\/|www\.|creativecommons\.org\/)[^\s<)]+[^\s<).,])/g, (m) => {
    const raw = m.replace(/&amp;/g, '&');
    return anchor(/^https?:\/\//.test(raw) ? raw : `https://${raw}`, m);
  });

function renderCredit(src, text) {
  if (!text) return '';
  let out = linkifyUrls(esc(text));
  /* Point the creator's name at the original, so "by X" is a route
     back to the source rather than a name the reader has to search. */
  const entry = CREDITS[src];
  if (entry && entry.source && entry.creator) {
    const name = esc(entry.creator);
    if (out.includes(name) && !out.includes(`>${name}<`)) {
      out = out.replace(name, anchor(entry.source, name));
    }
  }
  return out;
}

const STYLES = new Set(['plain', 'phone', 'bleed']);

/* ============================================================
   Media in a device frame.

   A screen recording sits in the same slot as a screenshot. Inside the
   phone frame a short muted loop is what makes the frame read as a real
   phone rather than a picture of one, and these flows are three to five
   seconds, so there is nothing for a reader to operate: it plays, it
   loops, and the file carries no audio track at all.

   The poster still is not optional. Without it the screen is black until
   the video arrives, which is both an ugly first paint and a layout shift
   on a page that has to clear CLS 0.1. `trim-videos` writes one beside
   every clip, so the path is derived rather than authored.

   Autoplay respects a reader who asked for less motion: blog.js pauses
   every one of these when `prefers-reduced-motion` matches. CSS cannot
   stop a video, so that half has to be script.
   ============================================================ */
const isVideo = (src) => /\.(mp4|webm)$/i.test(src);

function mediaTag(href, alt, { eager = false } = {}) {
  if (!isVideo(href)) {
    return `<img src="${esc(href)}" alt="${esc(alt)}"` +
           (eager ? ' fetchpriority="high"' : ' loading="lazy"') +
           ' decoding="async" />';
  }
  const poster = href.replace(/\.(mp4|webm)$/i, '-poster.jpg');
  /* No `loop` attribute. These clips end on the screen the step is about,
     and a browser loop restarts on the last frame, which snatches that
     screen away before it can be read. blog.js holds the last frame for
     REPLAY_HOLD_MS and then replays, so every pass ends on a readable
     screenshot. `data-replay` is the marker it looks for. */
  /* `metadata`, never `auto`, even above the fold. The poster is what paints
     and it is preloaded; letting the clip pull its whole self down at the
     same time just takes bandwidth away from the paint being measured. */
  return `<video src="${esc(href)}" poster="${esc(poster)}" autoplay muted ` +
         `data-replay playsinline preload="metadata" ` +
         `aria-label="${esc(alt)}"></video>`;
}

/* A hero photo is the only image that fills the reading column, so it is the
   only one a phone downloads far more of than it paints. Where a `-800`
   variant sits beside it, hand the browser both and let it choose: the
   phone takes 51KB, the desktop still gets the full file. Shrinking the one
   file instead would have softened the hero everywhere to fix a budget only
   the phone was failing. */
function heroCandidates(src) {
  if (!src) return null;
  const variant = src.replace(/(\.[a-z]+)$/i, '-800$1');
  if (!existsSync(join(ROOT, variant.replace(/^\//, '')))) return { href: src };
  return {
    href: src,
    srcset: `${variant} 800w, ${src} 1600w`,
    sizes: '(max-width: 780px) 100vw, 1096px',
  };
}

function heroImg(src, alt) {
  const c = heroCandidates(src);
  const set = c.srcset ? ` srcset="${esc(c.srcset)}" sizes="${esc(c.sizes)}"` : '';
  return `<img src="${esc(src)}"${set} alt="${esc(alt)}" fetchpriority="high" decoding="async" />`;
}

/* The bezel and notch are markup, not CSS, because the notch has to sit
   above the screen in the stacking order. Both the centred stage and the
   beside-the-text block use this, so the frame is described once. */
const deviceFrame = (media) =>
  `<div class="phone">\n          <div class="notch"></div>\n` +
  `          <div class="screen">${media}</div>\n        </div>`;

/* Mode colours a post may claim with `tone:` when its category
   default is the wrong one. Tallawong is a things-to-do post, but
   it is about the metro, so it should read metro teal rather than
   train orange. The category still sets the default. */
const TONES = new Set(['train', 'bus', 'metro', 'ferry', 'coach', 'lr', 'pink']);

function renderImage(href, title, alt, defaultStyle) {
  let style = defaultStyle;
  let caption = '';
  if (title) {
    const [first, ...rest] = title.split('|');
    if (STYLES.has(first.trim())) { style = first.trim(); caption = rest.join('|').trim(); }
    else caption = title.trim();
  }
  const img = mediaTag(href, alt);
  const cap = caption ? `\n      <figcaption>${renderCredit(href, caption)}</figcaption>` : '';

  if (style === 'phone') {
    return `<figure class="shot-stage">\n      <div class="shot-row">\n` +
           `        ${deviceFrame(img)}\n` +
           `      </div>${cap}\n    </figure>`;
  }
  const cls = style === 'bleed' ? ' class="bleed"' : '';
  return `<figure${cls}>\n      ${img}${cap}\n    </figure>`;
}

function renderMarkdown(md, defaultStyle) {
  /* Markdown passes HTML comments straight through, so an editorial
     note to ourselves ends up in the served page where View Source
     finds it. The Tallawong draft carried one reading "PLACEHOLDER
     POST, Claude wrote this, the numbers are not real" and it was
     sitting in the built HTML. Rule 2 at the top of this file says
     nothing internal escapes; `sourceRef` was covered and this was
     not. A comment in a post is always a note to us. */
  md = md.replace(/<!--[\s\S]*?-->/g, '');

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

/* Store buttons, same stamp pattern and icons as the landing page. */
const STORE_ROW = `<div class="store-row">
          <a href="https://apps.apple.com/us/app/krail-app/id6738934832" target="_blank" rel="noopener" class="store-btn" aria-label="Download KRAIL on the App Store">
            <svg class="badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
            <span class="text"><span class="big">App Store</span></span>
          </a>
          <a href="https://play.google.com/store/apps/details?id=xyz.ksharma.krail" target="_blank" rel="noopener" class="store-btn" aria-label="Get KRAIL on Google Play">
            <svg class="badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 20.5V3.5c0-.59.34-1.11.84-1.35l13.69 9.85L3.84 21.85c-.5-.25-.84-.76-.84-1.35zm14.81-8.91L5.39 2.04l11.05 6.34 1.37 3.21zM6.05 21.34l11.78-6.78-1.45-3.16-10.33 9.94zm15.97-9.83c.45.36.71.91.71 1.49s-.27 1.13-.72 1.5l-2.55 1.47-2.78-2.97 2.78-2.97 2.56 1.48z"/></svg>
            <span class="text"><span class="big">Google Play</span></span>
          </a>
        </div>`;

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

const head = ({ title, description, canonical, image, lcp, jsonld = [] }) => `<!doctype html>
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

<link rel="preload" as="font" type="font/woff2" href="/fonts/roboto-900-latin.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/fonts/fraunces-900-caps.woff2" crossorigin>

${lcp ? `<link rel="preload" as="image" href="${esc(lcp.href || lcp)}"${lcp.srcset ? ` imagesrcset="${esc(lcp.srcset)}" imagesizes="${esc(lcp.sizes)}"` : ''} fetchpriority="high">
` : ''}<link rel="stylesheet" href="/blog.css?v=${assetVersion('blog.css')}" />
<link rel="stylesheet" href="/blog.tokens.css?v=${assetVersion('blog.tokens.css')}" />
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
    ...(data.cardImage ? { image: SITE + data.cardImage } : {}),
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

  /* Whatever paints first above the fold. Without this the browser only
     discovers it after the stylesheet, which on a throttled phone is most
     of the way to the LCP budget already. A device clip never paints first,
     its poster does, so that is what gets preloaded. */
  const lcp = data.hero
    ? heroCandidates(data.hero)
    : (data.heroShot ? { href: data.heroShot.replace(/\.(mp4|webm)$/i, '-poster.jpg') } : null);

  return `${head({ title: data.title, description: data.summary, canonical: url, image: data.cardImage, lcp, jsonld })}
<body data-cat="${esc(data.series)}"${data.tone ? ` data-tone="${esc(data.tone)}"` : ''}>

<div class="progress" aria-hidden="true"></div>

${nav()}

<main class="post-wrap">

<header class="post-head${data.heroShot ? ' post-head--split' : ''}">
  <div class="container ${data.heroShot ? 'narrow' : 'prose'}">
    <div class="post-head__copy">
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
    </div>${data.heroShot ? `
    <div class="post-head__device">
      ${deviceFrame(mediaTag(data.heroShot, data.heroShotAlt || '', { eager: true }))}
    </div>` : ''}
  </div>
${data.hero ? `
  <div class="container narrow">
    <figure class="post-hero anim">
      ${heroImg(data.hero, data.heroAlt || '')}${data.heroCredit ? `
      <figcaption>${renderCredit(data.hero, data.heroCredit)}</figcaption>` : ''}
    </figure>
  </div>` : ''}
</header>

<article class="container ${data.heroShot ? 'narrow post-column' : 'prose'}">
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
        ${STORE_ROW}
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
${p.data.cardImage ? `        <div class="card-media"><img src="${esc(p.data.cardImage)}" alt="${esc(p.data.cardImageAlt)}" loading="lazy" decoding="async" /></div>` : ''}
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
    image: featured?.data.cardImage,
    /* The featured card is the first thing that paints here, and it was
       being discovered only after the stylesheet, same as the posts. */
    lcp: featured?.data.cardImage ? { href: featured.data.cardImage } : null,
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
${featured.data.cardImage ? `      <div class="featured-media">
        <span class="featured-flag">Latest</span>
        <img src="${esc(featured.data.cardImage)}" alt="${esc(featured.data.cardImageAlt)}" fetchpriority="high" decoding="async" />
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
    /* A typo here would silently fall back to the category colour, so
       it fails loudly instead. */
    if (data.tone && !TONES.has(data.tone)) {
      throw new Error(`${file}: unknown tone "${data.tone}". Valid: ${[...TONES].join(', ')}`);
    }

    if (data.status !== 'ready') { skipped.push(`${file} (status: ${data.status || 'unset'})`); continue; }

    /* Internal-only fields are read, never rendered. */
    delete data.sourceRef;

    /* One still per post for the places that need a flat rectangle: the
       Open Graph and JSON-LD image, the index card, the featured slab.
       A post whose opening image is a device recording has no `hero`, so
       without this it shipped with no share card at all and a blank card
       on the index. The poster frame beside every clip is the same image
       a reader sees before it plays, so it is the honest one to use. */
    data.cardImage = data.hero
      || (data.heroShot
        ? (isVideo(data.heroShot)
          ? data.heroShot.replace(/\.(mp4|webm)$/i, '-poster.jpg')
          : data.heroShot)
        : '');
    data.cardImageAlt = data.heroAlt || data.heroShotAlt || '';

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

  /* Anything previously generated for a post that is no longer
     published has to go, or unpublishing would leave the page live
     and reachable. The build output is a mirror of what is ready,
     not an accumulation of everything ever built. */
  const live = new Set(posts.map((p) => p.data.slug));
  for (const entry of readdirSync(OUT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'posts' || entry.name === 'drafts') continue;
    if (live.has(entry.name)) continue;
    if (!CHECK_ONLY) rmSync(join(OUT_DIR, entry.name), { recursive: true, force: true });
    console.log(`  Removed /blog/${entry.name}/, no longer published.`);
  }

  /* With nothing ready, the Journal does not exist. Publishing an
     empty index would put a live, linkable, contentless page on the
     site, so the whole section is removed instead. This is what makes
     "hold the Journal" the automatic outcome rather than a thing
     someone has to remember. */
  if (!posts.length) {
    for (const f of ['index.html', 'feed.xml', 'sitemap.xml', 'llms.txt']) {
      const p = join(OUT_DIR, f);
      if (existsSync(p) && !CHECK_ONLY) rmSync(p);
    }
    console.log(`\n  No posts marked ready, so no Journal is published.`);
    if (skipped.length) {
      console.log(`\n  Holding:`);
      for (const s of skipped) console.log(`    ${s}`);
    }
    console.log('');
    return { files: 0, posts: 0 };
  }

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
