#!/usr/bin/env node
/* ============================================================
   Runs every gate and prints one report.

   This is what CI calls and what the pull request comment is made
   from. The point is a single verdict: either the post is clear to
   publish, or here is the exact list standing in the way.

   Order matters. The blog is built first, because three of the
   gates read the HTML the generator produces rather than the
   markdown that went in.

   Usage:
     node tools/check-all.mjs
     node tools/check-all.mjs --md      markdown, for a PR comment
   ============================================================ */

import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AS_MD = process.argv.includes('--md');

const run = (args, label) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { label, ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};

/* Built pages only exist for posts marked ready, so the list is
   discovered rather than assumed. */
const builtPages = () => {
  const blog = join(ROOT, 'blog');
  if (!existsSync(blog)) return [];
  const out = [];
  if (existsSync(join(blog, 'index.html'))) out.push('blog/index.html');
  for (const e of readdirSync(blog)) {
    if (e !== 'posts' && existsSync(join(blog, e, 'index.html'))) out.push(`blog/${e}/index.html`);
  }
  return out;
};

const steps = [];

steps.push(run(['tools/build-blog.mjs'], 'Build'));
steps.push(run(['tools/a11y-contrast.mjs'], 'Colour contrast'));

const pages = builtPages();
steps.push(pages.length
  ? run(['tools/a11y-static.mjs', ...pages, ...(AS_MD ? ['--md'] : [])], 'Accessibility structure')
  : { label: 'Accessibility structure', ok: true, out: '  No published pages to check yet.\n' });

steps.push(run(['tools/gates.mjs', ...(AS_MD ? ['--md'] : [])], 'Content gates'));

const failed = steps.filter((s) => !s.ok);

if (AS_MD) {
  console.log('## Journal checks\n');
  console.log(failed.length
    ? `**${failed.length} of ${steps.length} checks failed.** Details below.\n`
    : `**All ${steps.length} checks passed.**\n`);
  console.log('| Check | Result |');
  console.log('|---|---|');
  for (const s of steps) console.log(`| ${s.label} | ${s.ok ? 'pass' : '**fail**'} |`);
  console.log('');
  for (const s of steps) {
    if (s.label === 'Build' && s.ok) continue;
    console.log(s.out.trim() ? s.out : '');
  }
} else {
  for (const s of steps) {
    console.log(`\n${'='.repeat(60)}\n  ${s.label}${s.ok ? '' : '   FAILED'}\n${'='.repeat(60)}`);
    console.log(s.out.trimEnd());
  }
  console.log(`\n  ${failed.length ? `${failed.length} check(s) failed.` : 'All checks passed.'}\n`);
}

process.exit(failed.length ? 1 : 0);
