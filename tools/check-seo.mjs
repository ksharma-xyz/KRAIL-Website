#!/usr/bin/env node
/* ============================================================
   Title, slug and description gate.

   The Journal is how someone who has never heard of KRAIL finds
   it. They do not search for the app, they search for the problem:
   live Sydney train times, a bus stop by route number, whether the
   Park & Ride at Tallawong has room. A post whose title says
   "Do not know the stop name? Pick it on the map" answers that
   question perfectly and matches none of those searches, because
   it never says Sydney and never says bus.

   So three things are checked, and only one of them is reversible
   after publishing:

     Title        length, keyword cover, uniqueness. Editable
                  forever, so this blocks on shape and advises on
                  strength.
     Description  length and keyword cover. Also editable forever.
     Slug         the URL. Once a post is on main it is a live page
                  at krail.app, other people link to it, and search
                  engines have it indexed. Changing it then throws
                  that away. So a published slug is FROZEN, and the
                  check for that reads origin/main rather than
                  trusting anyone to remember.

   The vocabulary below is deliberately the allowed half of the
   trademark rules in CLAUDE.md. Station names, bare mode names and
   `Park & Ride` are ours to use. Branded line names, `Opal` and the
   operator names are not, and tools/gates.mjs blocks those already.
   Nothing here should ever tempt an author back toward them.

   On picking the best title: a gate cannot do that. It can measure
   length, keyword cover and uniqueness, and it can rank what it
   measured, which is what the advisory scores at the end are for.
   Choosing between two titles that both score well is a human call.

   Usage:
     node tools/check-seo.mjs
     node tools/check-seo.mjs --md      markdown, for a PR comment
   ============================================================ */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { argv, exit } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AS_MD = argv.includes('--md');

/* ---------- what a Sydney commuter actually types ---------- */

/* The place half. Without one of these a title competes with every
   transit app on earth instead of the handful serving this city. */
const PLACES = [
  'sydney', 'nsw', 'tallawong', 'kellyville', 'bella vista', 'schofields',
  'hornsby', 'town hall', 'wynyard', 'central', 'circular quay', 'parramatta',
  'chatswood', 'epping', 'auburn', 'manly', 'bondi', 'newtown', 'strathfield',
  'campbelltown', 'ashfield', 'brookvale', 'cherrybrook', 'beverly hills',
  'museum', 'macquarie', 'penrith', 'liverpool', 'blacktown', 'redfern',
  /* The walks. This list was written against ten app posts, all of which
     could say Sydney and be done. A post about a specific walk names the
     place people actually search for, and the gate should know those too
     rather than push a title toward a vaguer word. */
  'coogee', 'bronte', 'tamarama', 'clovelly', 'watsons bay', 'dover heights',
  'bundeena', 'cronulla', 'berowra', 'cowan', 'cremorne', 'mosman',
  'wentworth falls', 'blue mountains', 'balmain', 'barangaroo', 'seven hills',
  'north sydney', 'milsons point', 'darling harbour', 'olympic park', 'hurstville',
];

/* The thing half. A mode or the job being done. */
const TOPICS = [
  'train', 'bus', 'ferry', 'metro', 'light rail', 'coach',
  'commute', 'commuter', 'timetable', 'departure', 'departures',
  'stop', 'station', 'platform', 'wharf', 'trip', 'transport',
  'park & ride', 'park and ride', 'parking', 'car park', 'carpark', 'fare', 'map',
  'live times', 'times', 'travel',
];

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'for', 'from', 'with',
  'on', 'in', 'at', 'by', 'is', 'it', 'its', 'be', 'do', 'not', 'that',
  'this', 'your', 'you', 'my', 'me', 'we', 'us', 'our', 'what', 'how',
  'when', 'where', 'all', 'any', 'once', 'want', 'need', 'way', 'ways',
  'know', 'see', 'get', 'go', 'make', 'take', 'here', 'there', 'out',
]);

/* Google truncates a title around 60 characters and a description
   around 160. Under-length is the more common failure: a four word
   title wastes the only line a searcher reads. */
const TITLE_MIN = 28;
const TITLE_MAX = 60;
const DESC_MIN = 110;
const DESC_MAX = 160;
const SLUG_MAX = 45;

/* ---------- helpers ---------- */

const findings = [];
const notes = [];
const add = (file, message, fix) => findings.push({ file, message, fix });
const note = (file, message, fix) => notes.push({ file, message, fix });

const has = (text, list) => list.filter((k) => text.includes(k));

function frontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { head: '', body: raw };
  return { head: m[1], body: m[2] };
}

const field = (head, key) => {
  const m = head.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};

/* The slug each post had the last time it shipped. Changing one breaks a
   URL other people already have, so it is the one rule here that blocks
   outright.

   This reads the slug out of the published frontmatter rather than off the
   filename. They are not the same thing and never had to be: a post can be
   renamed for search while its markdown file keeps whatever it was called
   the day it was written. Comparing against the filename looked right for
   as long as the two happened to match, then called every renamed post a
   broken URL the moment they stopped.

   If origin/main cannot be read we say so rather than quietly passing,
   because a silent pass is exactly how a live URL gets renamed. */
function publishedSlugs() {
  const ls = spawnSync('git', ['ls-tree', '-r', '--name-only', 'origin/main', '--', 'blog/posts/'],
    { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) return null;

  const map = new Map();
  for (const path of ls.stdout.split('\n').filter((l) => l.endsWith('.md'))) {
    const show = spawnSync('git', ['show', `origin/main:${path}`], { cwd: ROOT, encoding: 'utf8' });
    if (show.status !== 0) continue;
    const { head } = frontmatter(show.stdout);
    const slug = field(head, 'slug');
    if (slug) map.set(path.replace(/^blog\/posts\//, ''), slug);
  }
  return map;
}

/* ============================================================
   Sources have to be worth citing.

   A source is the body that runs the thing, or publishes the data, or
   manages the land. A walk site's page is somebody's write-up of a
   place they visited, and an encyclopedia article is a summary of
   other people's sources. Neither is where a distance, a grade, a
   fare or a departure time comes from, and citing one lends it an
   authority the page does not have. If the official body does not
   publish a number, the honest move is to say so, which several of
   these posts already do well.

   Government at any level qualifies, and so does the operator of the
   service being described, because a ferry company is primary for its
   own timetable.
   ============================================================ */
const OFFICIAL = [
  /(^|\.)nsw\.gov\.au$/, /(^|\.)gov\.au$/,
  /^transportnsw\.info$/, /^sydneymetro\.info$/,
  /^opendata\.transport\.nsw\.gov\.au$/,
  /^cronullaferries\.com\.au$/,     /* operates the Bundeena ferry */
];

function checkSourceQuality(file, head) {
  const block = (head.match(/^sources:\n((?:[ \t]+.*\n|\n(?=[ \t]))*)/m) || [])[1];
  if (!block) return;
  for (const entry of block.split(/(?=^[ \t]+- url: )/m)) {
    const url = (entry.match(/- url: (\S+)/) || [])[1];
    if (!url) continue;
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
    if (!OFFICIAL.some((re) => re.test(host))) {
      add(file, `Source is not an official one: ${host}`,
          'Cite the body that runs the service, publishes the data or manages the land. If none of them publishes the number, say that instead of borrowing somebody else\'s.');
    }
    /* A timetable PDF is the most tempting citation on a transport
       site and the worst one to leave in a post. The bus and ferry
       ones come back 403 to anyone the site does not recognise, so a
       reader clicking the source we gave them gets Access Denied and
       has no reason to believe the rest. The route pages are stable
       and the site itself always resolves, so schedule claims cite
       one of those instead. */
    if (/\/documents\/timetables\//.test(url)) {
      add(file, `Source deep-links a timetable PDF: ${url.split('/').pop()}`,
          'Cite the route page, or transportnsw.info itself. The PDFs answer 403 to a plain request and the filename carries a date that goes stale on the next timetable.');
    }
    if (/NOT READ/i.test(entry)) {
      add(file, `A source is listed that was never read: ${host}`,
          'A page you could not open is not a source. Take it out. If the gap matters, the body should say so in words.');
    }
    if (!/^\s+title: .+$/m.test(entry)) {
      add(file, `Source has no title: ${host}`,
          'The title is what shows on the page. Without one the reader gets a bare domain, and two links to the same site look identical.');
    }
  }
}

/* ---------- the checks ---------- */

const posts = readdirSync(join(ROOT, 'blog/posts'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const raw = readFileSync(join(ROOT, 'blog/posts', f), 'utf8');
    const { head } = frontmatter(raw);
    return {
      file: `blog/posts/${f}`,
      basename: f.replace(/\.md$/, ''),
      head,
      title: field(head, 'title'),
      slug: field(head, 'slug'),
      summary: field(head, 'summary'),
      status: field(head, 'status'),
    };
  });

const live = publishedSlugs();
if (live === null) {
  note('repo', 'Could not read origin/main, so published slugs were not checked.',
       'Run `git fetch origin main`. Until then nothing is stopping a live URL being renamed.');
}

const seenTitles = new Map();
const seenSlugs = new Map();
const scores = [];

for (const p of posts) {
  const t = p.title.toLowerCase();
  const s = p.slug.toLowerCase();
  const d = p.summary.toLowerCase();

  /* ---- the slug is the URL, and a live one is frozen ---- */
  const wasPublishedAs = live && live.get(`${p.basename}.md`);
  if (wasPublishedAs && wasPublishedAs !== p.slug) {
    add(p.file, `Slug changed on a published post: ${wasPublishedAs} became ${p.slug}.`,
        'That URL is live at krail.app and other people link to it. Keep the slug and change the title instead, or ship a redirect first.');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) {
    add(p.file, `Slug is not clean: ${p.slug}`,
        'Lowercase words joined by single hyphens, nothing else. It is a URL.');
  }
  if (p.slug.length > SLUG_MAX) {
    add(p.file, `Slug is ${p.slug.length} characters, over ${SLUG_MAX}.`,
        'Cut the filler words. The slug shows in results and gets truncated too.');
  }
  if (seenSlugs.has(p.slug)) {
    add(p.file, `Slug collides with ${seenSlugs.get(p.slug)}.`, 'Two posts cannot share a URL.');
  }
  seenSlugs.set(p.slug, p.file);

  const slugWords = p.slug.split('-');
  const slugStops = slugWords.filter((w) => STOP_WORDS.has(w));
  if (slugWords.length > 3 && slugStops.length / slugWords.length > 0.4) {
    note(p.file, `Slug is mostly filler: ${slugStops.join(', ')}.`,
         'A URL is keywords, not a sentence. Drop the words nobody searches for.');
  }
  if (!has(s.replace(/-/g, ' '), [...PLACES, ...TOPICS]).length) {
    add(p.file, `Slug carries no Sydney or transport keyword: ${p.slug}`,
        'Put the place or the mode in the URL. It is the part a search engine weighs hardest.');
  }

  /* ---- the title ---- */
  if (!p.title) {
    add(p.file, 'No title.', 'Every post needs one.');
  } else {
    if (p.title.length < TITLE_MIN) {
      add(p.file, `Title is ${p.title.length} characters, under ${TITLE_MIN}.`,
          'There is room for about sixty. A short title wastes the only line a searcher reads.');
    }
    if (p.title.length > TITLE_MAX) {
      add(p.file, `Title is ${p.title.length} characters, over ${TITLE_MAX}.`,
          'Google cuts it off around sixty, and the cut usually lands mid-word.');
    }
    if (seenTitles.has(p.title)) {
      add(p.file, `Title collides with ${seenTitles.get(p.title)}.`, 'Two posts cannot share a title.');
    }
    seenTitles.set(p.title, p.file);

    const places = has(t, PLACES);
    const topics = has(t, TOPICS);
    if (!topics.length) {
      add(p.file, 'Title names no mode and no transport topic.',
          'Say train, bus, ferry, metro, stop, timetable, trip or Park & Ride. Without one the title matches nothing anybody searches.');
    }
    if (!places.length) {
      add(p.file, 'Title names no place.',
          'Say Sydney, or name the station the post is about. Without it the post competes with every transit app on earth.');
    }
  }

  checkSourceQuality(p.file, p.head);

  /* ---- the description ---- */
  if (!p.summary) {
    add(p.file, 'No summary, so the page ships no meta description.',
        'Write one. It is the two lines under the title in a result.');
  } else {
    if (p.summary.length < DESC_MIN) {
      note(p.file, `Description is ${p.summary.length} characters, under ${DESC_MIN}.`,
           'There is room for about a hundred and sixty. Short ones get padded by the engine with whatever it finds.');
    }
    if (p.summary.length > DESC_MAX) {
      note(p.file, `Description is ${p.summary.length} characters, over ${DESC_MAX}.`,
           'It gets truncated around a hundred and sixty. Put the point first.');
    }
    if (!has(d, [...PLACES, ...TOPICS]).length) {
      add(p.file, 'Description carries no Sydney or transport keyword.',
          'It is the snippet under the title. Say where and what.');
    }
  }

  /* ---- the advisory score, for ranking rather than blocking ---- */
  if (p.title) {
    const places = has(t, PLACES);
    const topics = has(t, TOPICS);
    let score = 0;
    if (places.length) score += 3;
    if (topics.length) score += 3;
    if (topics.length > 1) score += 1;
    if (p.title.length >= 38 && p.title.length <= TITLE_MAX) score += 2;
    if (has(s.replace(/-/g, ' '), PLACES).length) score += 1;
    scores.push({ slug: p.slug, title: p.title, score, places, topics });
  }
}

/* ============================================================
   The things that are true of the site, not of one post.

   Every one of these was missing until the Journal went live, and
   none of them announces itself: a site with no robots.txt still
   serves, a page with no canonical still renders, and a link with no
   Open Graph tags still opens. They only show up as absence, which
   is why they need a check rather than a reviewer.
   ============================================================ */
function checkSiteWide() {
  const robots = join(ROOT, 'robots.txt');
  if (!existsSync(robots)) {
    add('robots.txt', 'No robots.txt.',
        'It is where a crawler looks for the sitemap. build-blog.mjs generates it.');
  } else if (!readFileSync(robots, 'utf8').includes('/sitemap.xml')) {
    add('robots.txt', 'robots.txt does not point at the sitemap.',
        'Add a Sitemap: line. Without it the sitemap is found by luck.');
  }

  const rootMap = join(ROOT, 'sitemap.xml');
  if (!existsSync(rootMap)) {
    add('sitemap.xml', 'No sitemap at the site root.',
        'A crawler looks there by convention. The Journal has its own, but nothing outside it was listed anywhere.');
    return;
  }
  const map = readFileSync(rootMap, 'utf8');

  /* Every page we actually publish has to be in it, including the two
     that are not part of the Journal and so are easy to forget. */
  const pages = [
    ['index.html', 'https://krail.app/'],
    ['privacy-policy/index.html', 'https://krail.app/privacy-policy/'],
  ];
  for (const [file, url] of pages) {
    if (!existsSync(join(ROOT, file))) continue;
    if (!map.includes(`<loc>${url}</loc>`)) {
      add('sitemap.xml', `${url} is published but not in the sitemap.`,
          'Add it to STATIC_PAGES in build-blog.mjs.');
    }
    const src = readFileSync(join(ROOT, file), 'utf8');
    if (!/<link[^>]+rel="canonical"/.test(src)) {
      add(file, 'No canonical link.',
          'Without one, any variant of the URL that gets linked competes with the real page.');
    }
    for (const tag of ['og:title', 'og:description', 'og:url']) {
      if (!src.includes(`property="${tag}"`)) {
        add(file, `No ${tag}.`,
            'A link to this page posted anywhere renders as a bare URL with no title and no description.');
      }
    }
  }

  /* The landing page is the one that has to explain what this is to a
     machine, because it is the one an answer engine is sent to first. */
  const home = join(ROOT, 'index.html');
  if (existsSync(home)) {
    const src = readFileSync(home, 'utf8');
    if (!/<script type="application\/ld\+json">/.test(src)) {
      add('index.html', 'The landing page carries no structured data.',
          'Describe the organisation, the site and the app. It is what an answer engine quotes back.');
    }
    /* Install counts and star ratings are private numbers, and
       CLAUDE.md keeps them off anything outward facing. Structured data
       is outward facing, and it is the easiest place to leak them. */
    for (const banned of ['aggregateRating', 'ratingCount', 'reviewCount', 'userInteractionCount']) {
      if (src.includes(banned)) {
        add('index.html', `Structured data carries ${banned}.`,
            'That is a private number on a public page. Describe the app without counting anything.');
      }
    }
  }
}

/* ---------- report ---------- */

checkSiteWide();

const line = (f) => `  ${f.file}\n    ${f.message}\n    fix: ${f.fix}`;

if (AS_MD) {
  console.log(findings.length
    ? `**${findings.length} search issue(s).**\n`
    : '**Titles, slugs and descriptions pass.**\n');
  for (const f of findings) console.log(`- \`${f.file}\` ${f.message}\n  - fix: ${f.fix}`);
  if (notes.length) {
    console.log('\n<details><summary>Advisory</summary>\n');
    for (const n of notes) console.log(`- \`${n.file}\` ${n.message}`);
    console.log('\n</details>');
  }
} else {
  for (const f of findings) {
    console.log(`  error  ${f.file}`);
    console.log(`         ${f.message}`);
    console.log(`         fix: ${f.fix}`);
  }
  for (const n of notes) {
    console.log(`  note   ${n.file}`);
    console.log(`         ${n.message}`);
    console.log(`         fix: ${n.fix}`);
  }
  if (scores.length) {
    console.log('\n  Title strength, weakest first. Advisory, nothing here blocks.');
    console.log('  A gate can rank what it can measure. Which of two strong titles');
    console.log('  is better is still yours to call.\n');
    for (const s of scores.sort((a, b) => a.score - b.score)) {
      const bar = '#'.repeat(s.score) + '.'.repeat(10 - s.score);
      console.log(`    ${bar}  ${String(s.score).padStart(2)}/10  ${s.title}`);
    }
  }
  console.log(findings.length
    ? `\n  ${findings.length} search issue(s).`
    : '\n  Titles, slugs and descriptions pass.');
}

exit(findings.length ? 1 : 0);
