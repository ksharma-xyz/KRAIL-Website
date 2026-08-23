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

    if (!res.ok) {
      failed++;
      line = `  [FAIL ${res.status}] ${job.url}\n             ${job.file}`;
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
