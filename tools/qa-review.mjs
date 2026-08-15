#!/usr/bin/env node
/* ============================================================
   Model QA reviewer.

   The regex gates catch what a rule can express. This catches
   what it cannot: whether a post actually passes the commuter
   test, whether a claim is supported by its cited sources,
   whether the copy sounds like KRAIL.

   It reads the post and the project's own rules, then returns a
   structured verdict. Advisory to begin with: it comments, it
   does not block, until its judgement has earned that.

   Needs ANTHROPIC_API_KEY. Without one it exits 0 and says so,
   so a fork or a contributor without the secret is not blocked
   by a check that cannot run.

   Usage:
     node tools/qa-review.mjs                 review every ready post
     node tools/qa-review.mjs --all           review drafts too
     node tools/qa-review.mjs --md            markdown, for a PR comment
   ============================================================ */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = join(ROOT, 'blog', 'posts');
const AS_MD = process.argv.includes('--md');
const INCLUDE_DRAFTS = process.argv.includes('--all');

if (!process.env.ANTHROPIC_API_KEY) {
  console.log(AS_MD
    ? '### Editorial review\n\nSkipped: no `ANTHROPIC_API_KEY` available to this run.'
    : '\n  Editorial review skipped: no ANTHROPIC_API_KEY.\n');
  process.exit(0);
}

/* The reviewer is held to the project's own rules rather than a
   generic idea of good writing, so it reads them directly. */
const rules = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['ship', 'revise', 'reject'],
      description: 'ship: publishable as is. revise: fixable problems. reject: wrong at the premise.',
    },
    commuter_test: {
      type: 'object',
      description: 'Would a non-technical Sydney commuter instantly recognise the problem this post solves?',
      properties: {
        passes: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['passes', 'reason'],
      additionalProperties: false,
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'worth-fixing', 'nit'] },
          category: {
            type: 'string',
            enum: ['voice', 'commuter-test', 'accuracy', 'legal', 'structure', 'seo'],
          },
          quote: { type: 'string', description: 'The exact text at fault, or an empty string if it is about something missing.' },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'Concrete replacement wording where possible.' },
        },
        required: ['severity', 'category', 'quote', 'problem', 'fix'],
        additionalProperties: false,
      },
    },
    unsupported_claims: {
      type: 'array',
      description: 'Statements of fact that the listed sources do not obviously support. Being wrong in public is worse than being late.',
      items: { type: 'string' },
    },
    summary: { type: 'string', description: 'Two sentences at most.' },
  },
  required: ['verdict', 'commuter_test', 'findings', 'unsupported_claims', 'summary'],
  additionalProperties: false,
};

const SYSTEM = `You are the editor of the KRAIL Journal, a blog attached to a Sydney public transport app.

You are reviewing a post before it goes live on a public site. Judge it against the project's own rules, which follow, not against generic writing advice. The rules are not suggestions and several of them are absolute.

<project_rules>
${rules}
</project_rules>

What matters most, in order:

1. The commuter test. Every post must describe a situation a Sydney commuter has actually lived, or a benefit they actually want. Abstractions, feature counts and app internals fail it.
2. Accuracy. Flag any statement of fact the cited sources do not obviously support. A wrong fare or a wrong line is worse than a dull sentence.
3. Legal and trademark. Branded service names, operator wordmarks, and anything implying affiliation with the transport authority. A citation naming its publisher is allowed; body copy is not.
4. Voice. The forbidden punctuation and phrasing in the rules, and whether it sounds like one Sydney commuter writing, not a brand.

Be specific and quote the text at fault. Do not invent problems to seem useful: a clean post should come back with an empty findings list and a ship verdict. Rank a finding blocking only if publishing with it would embarrass the author or mislead a reader.`;

const client = new Anthropic();

const files = existsSync(POSTS) ? readdirSync(POSTS).filter((f) => f.endsWith('.md')).sort() : [];
const reviews = [];

for (const file of files) {
  const raw = readFileSync(join(POSTS, file), 'utf8');
  const isReady = /^status:\s*ready\s*$/m.test(raw);
  if (!isReady && !INCLUDE_DRAFTS) continue;

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    system: SYSTEM,
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: VERDICT_SCHEMA },
    },
    messages: [{
      role: 'user',
      content: `Review this post. The frontmatter is part of it: the summary becomes the meta description and the sources are what the facts are checked against.\n\n<post file="${file}">\n${raw}\n</post>`,
    }],
  });

  if (response.stop_reason === 'refusal') {
    reviews.push({ file, error: `Declined to review (${response.stop_details?.category ?? 'no category'}).` });
    continue;
  }

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  try {
    reviews.push({ file, review: JSON.parse(text), ready: isReady });
  } catch (err) {
    reviews.push({ file, error: `Could not parse the review: ${err.message}` });
  }
}

/* ---------- report ---------- */

const ICON = { ship: 'ship', revise: 'revise', reject: 'reject' };

if (!reviews.length) {
  console.log(AS_MD ? '### Editorial review\n\nNo posts are marked ready, so there was nothing to review.'
                    : '\n  No posts marked ready. Nothing to review.\n');
  process.exit(0);
}

if (AS_MD) {
  console.log('### Editorial review\n');
  console.log('_Advisory. This does not block a merge._\n');
  for (const r of reviews) {
    console.log(`**\`${r.file}\`**\n`);
    if (r.error) { console.log(`${r.error}\n`); continue; }
    const v = r.review;
    console.log(`Verdict: **${ICON[v.verdict]}**. ${v.summary}\n`);
    console.log(`Commuter test: ${v.commuter_test.passes ? 'passes' : '**fails**'}. ${v.commuter_test.reason}\n`);
    if (v.unsupported_claims.length) {
      console.log('Claims the sources do not obviously support:\n');
      for (const c of v.unsupported_claims) console.log(`- ${c}`);
      console.log('');
    }
    if (v.findings.length) {
      console.log('| Severity | Area | Problem | Suggested fix |');
      console.log('|---|---|---|---|');
      for (const f of v.findings) {
        const q = f.quote ? ` (“${f.quote.slice(0, 60)}”)` : '';
        console.log(`| ${f.severity} | ${f.category} | ${f.problem.replace(/\|/g, '\\|')}${q.replace(/\|/g, '\\|')} | ${f.fix.replace(/\|/g, '\\|')} |`);
      }
      console.log('');
    } else {
      console.log('No findings.\n');
    }
  }
} else {
  console.log('\n  Editorial review\n');
  for (const r of reviews) {
    if (r.error) { console.log(`  ${r.file}\n    ${r.error}\n`); continue; }
    const v = r.review;
    console.log(`  ${r.file}`);
    console.log(`    verdict: ${v.verdict}`);
    console.log(`    commuter test: ${v.commuter_test.passes ? 'pass' : 'FAIL'}  ${v.commuter_test.reason}`);
    console.log(`    ${v.summary}`);
    for (const c of v.unsupported_claims) console.log(`    unsupported: ${c}`);
    for (const f of v.findings) {
      console.log(`    [${f.severity}] ${f.category}: ${f.problem}`);
      console.log(`         fix: ${f.fix}`);
    }
    console.log('');
  }
}

/* Advisory for now: it reports, it does not block. */
process.exit(0);
