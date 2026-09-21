#!/usr/bin/env node
/* ============================================================
   Source link checker.

   Why this exists. A source in the Tallawong post pointed at
   parknride.com.au, which answers HTTP 200 and then renders
   "404 Page Not Found" from JavaScript. curl said 200. The gates
   said 200. A search engine happily summarised content that was
   not there. The only thing that disagreed was a human opening it.

   So a status code is not the test. This fetches every source URL
   on a ready post and looks at what actually came back:

     - a non-200 status
     - a soft 404, meaning 200 with not-found wording in the body
     - a body with almost no text, which is the shape of an empty
       shell that fills itself in with JavaScript, and is the case
       that fooled us. Reported, not failed, because plenty of
       legitimate pages render client side.

   Network dependent by nature, so it is a separate script rather
   than part of the blocking gates. A flaky connection should not
   fail a content check.

   Usage:
     node tools/check-sources.mjs            ready posts only
     node tools/check-sources.mjs --all      drafts too
   ============================================================ */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = join(ROOT, 'blog', 'posts');
const ALL = process.argv.includes('--all');

/* Wording that means "this page is not here", even at 200. Kept
   tight on purpose: an article legitimately *about* 404s would
   trip a looser list. */
const NOT_FOUND = [
  /\b404\b[\s\S]{0,40}\b(page\s+)?not\s+found\b/i,
  /\bpage\s+not\s+found\b/i,
  /\bthis\s+page\s+(does\s+not|doesn't)\s+exist\b/i,
  /\bwe\s+can't\s+find\s+(that|this)\s+page\b/i,
];

const textOf = (html) =>
  html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

const posts = readdirSync(POSTS).filter((f) => f.endsWith('.md'));
/* ============================================================
   Route pages that are not route pages.

   transportnsw.info answers 200 for any path under /routes/details/,
   real or not, and renders the route itself in the browser. So a real
   route page and a made-up one both carry a few hundred characters of
   text, and the gap between them is too small to trust: on the day
   this was written, a fake id served 370 characters and real pages
   served 401 to 494. The threshold below sat inside that gap by luck.

   That is how the Auburn post came to cite
   /routes/details/sydney-trains-network/t2/02t2 for weeks. It is not
   the T2. The T2 is 020t2. 02t2 returns the same template byte for
   byte as a route id invented on purpose, and every check passed it.

   What does separate them is the page itself: a real route embeds its
   stops and timetable, so it is far bigger than the empty template.
   Rather than hard-code a size that the next redesign would break,
   this asks the site for a route that cannot exist on the same
   network and compares. If the cited page comes back the same size as
   the impossible one, it is the impossible one. The control is
   re-measured on every run, so it moves when the site does. */
const ROUTE_PAGE = /^https?:\/\/(www\.)?transportnsw\.info\/routes\/details\/([^/]+)\//;
const controls = new Map();

async function bodyOf(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (KRAIL Journal source check)' },
    signal: AbortSignal.timeout(20000),
  });
  return res.text();
}

async function isRouteShell(url, body) {
  const m = url.match(ROUTE_PAGE);
  if (!m) return false;
  const network = m[2];
  if (!controls.has(network)) {
    const control = `https://transportnsw.info/routes/details/${network}/zz9/krail_control_route`;
    controls.set(network, (await bodyOf(control)).length);
  }
  const shell = controls.get(network);
  return Math.abs(body.length - shell) / shell < 0.03;
}

const jobs = [];

for (const file of posts) {
  const raw = readFileSync(join(POSTS, file), 'utf8');
  const head = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [, ''])[1];
  const status = (head.match(/^status:\s*(.+)$/m) || [, ''])[1].trim();
  if (!ALL && status !== 'ready') continue;
  for (const m of head.matchAll(/^\s*-?\s*url:\s*(\S+)\s*$/gm)) {
    jobs.push({ file, status, url: m[1] });
  }
}

if (!jobs.length) {
  console.log('\n  No source URLs on any ready post.\n');
  process.exit(0);
}

console.log(`\n  Checking ${jobs.length} source URL(s)\n`);
let failed = 0;

for (const job of jobs) {
  let line;
  try {
    const res = await fetch(job.url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (KRAIL Journal source check)' },
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    const text = textOf(body);

    if (/\/trip-planner\//.test(job.url)) {
      /* A trip planner link is a calculation, not a document. It
         computes the journey in the browser, so the page a reader lands
         on proves nothing we cite it for, and the date baked into the
         query goes stale the day after. Cite the route page instead. */
      failed++;
      line = `  [PLANNER ] ${job.url}\n             A trip planner result, not a page. It computes in the browser and the date in it goes stale.\n             Cite the route page for the line, and phrase the time as the regular service for the day. ${job.file}`;
    } else if (!res.ok) {
      failed++;
      line = `  [FAIL ${res.status}] ${job.url}\n             ${job.file}`;
    } else if (await isRouteShell(job.url, body)) {
      failed++;
      line = `  [NO ROUTE] ${job.url}\n             The same page the site serves for a route that does not exist. Wrong route id.\n             Find the real id on transportnsw.info/routes/train, /routes/bus or /routes/ferry. ${job.file}`;
    } else if (NOT_FOUND.some((re) => re.test(text.slice(0, 4000)))) {
      failed++;
      line = `  [SOFT 404] ${job.url}\n             200, but the page says it is not found. ${job.file}`;
    } else if (text.length < 400) {
      /* This is the one that got through. The dead page answered 200
         and served 37 characters, because its "404 Page Not Found"
         was drawn by JavaScript and never appeared in the body. So
         there was nothing to match on except the emptiness itself.

         Failing rather than warning. A page we cannot verify without
         a browser is a page nobody has verified, and the whole reason
         we are here is a source that was cited but never opened. If
         it is genuine, open it, confirm it, and say so in the post's
         `for:` line so the next person knows it was checked by eye. */
      failed++;
      line = `  [EMPTY   ] ${job.url}\n             200 with only ${text.length} chars of text, so the server sent a shell.\n             Open it in a browser. This is exactly how a dead page passed before. ${job.file}`;
    } else {
      line = `  [OK      ] ${job.url}`;
    }
  } catch (err) {
    failed++;
    line = `  [ERROR   ] ${job.url}\n             ${err.message}. ${job.file}`;
  }
  console.log(line);
}

if (failed) {
  console.log(`\n  ${failed} source(s) unreachable or not really there.`);
  console.log('  A source that does not resolve is not a source. Replace it or drop the claim.\n');
  process.exit(1);
}
console.log('\n  All sources resolve.\n');
