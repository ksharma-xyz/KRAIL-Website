# KRAIL Journal, how the blog works

Everything about writing, checking and shipping a post. The goal is that
Karan writes or reviews, reads one report, and says ship it. Every other
step is automated.

Status legend used below: **built** means it exists and runs today,
**planned** means it is designed but not written yet.

---

## 1. The short version

```
write markdown  →  open a PR  →  gates run and report  →  you say ship it
                                                          →  merge to main
                                                          →  HTML is built
                                                          →  krail.app/blog
```

You never write HTML. You never touch the deploy. If a gate fails, the PR
tells you exactly which line and why.

---

## 2. Where things live

| Path | What | Status |
|---|---|---|
| `blog/drafts/*.md` | Work in progress. The generator never looks here. | optional |
| `blog/queue/*.md` | Not used. Superseded by the `status` field, see below. | dropped |
| `blog/posts/*.md` | The only directory the generator reads. Ships only when `status: ready`. | **built** |
| `blog/index.html` | Generated index page. Do not hand-edit. | **generated** |
| `blog/<slug>/index.html` | Generated post page. Do not hand-edit. | **generated** |
| `blog/feed.xml`, `sitemap.xml`, `llms.txt` | Generated. | **built** |
| `blog.css` | The whole blog design system. Hand-written. | built |
| `blog.js` | Reveal, sticky nav, filter, reading progress, share. | built |
| `blog.tokens.css` | **Generated.** The accent triplets. Never hand-edit. | built |
| `tools/build-blog.mjs` | Markdown to HTML generator. | **built** |
| `tools/a11y-contrast.mjs` | Contrast gate, and generator for `blog.tokens.css`. | built |
| `tools/a11y-static.mjs` | 14 structural accessibility checks over built HTML. | built |
| `images/blog/` | Post images. | planned |

**Promotion is one field.** A post lives in `blog/posts/` from the start
and carries `status: draft`. Flipping it to `status: ready` in a merged PR
is what "make this prod" means. Nothing else publishes anything.

This replaced the original three-directory plan on purpose: the status
lives in the file, so the change is visible in the PR diff as one line
rather than as a file move, which is far easier to review on a phone. If
you would rather keep unfinished drafts out of the posts directory
entirely, put them in `blog/drafts/`, which the generator never reads.
Both work together.

---

## 3. Writing a post

### Frontmatter

The schema matches the one already in use in `KRAIL-SHORTS`, so posts can
move between the two without rewriting.

```markdown
---
title: Auburn Cherry Blossom Festival without a car
slug: auburn-cherry-blossom-festival-without-a-car
series: things-to-do
summary: Every ticket is booked online, there is no buying one at the gate, and street parking near the gardens is limited. Here is the train and shuttle that gets you there instead.
updated: 2026-08-14
hero: /images/blog/auburn-cherry-blossom.webp
heroAlt: Cherry blossoms in flower at Auburn Botanic Gardens
heroCredit: Photo by Name, licensed under X
imageStyle: plain
sources:
  - url: https://www.cumberland.nsw.gov.au/sydneycherryblossomfestival
    for: dates, hours, ticket prices, shuttle timing, parking
status: draft
sourceRef: v_cherryblossomfestivalauburn
publishedUrl: null
---
```

| Key | Required | Notes |
|---|---|---|
| `title` | yes | Also becomes the `<h1>`. Keep the page `<title>` 30 to 60 chars. |
| `slug` | yes | Lowercase, hyphens, no dates. Becomes `/blog/<slug>/`. |
| `series` | yes | One of the five categories in section 4. Drives the accent colour. |
| `summary` | yes | Becomes the deck, the meta description and the card excerpt. 70 to 160 chars for the meta description to pass the SEO gate. |
| `updated` | yes | ISO date. Drives sort order and `dateModified`. |
| `hero`, `heroAlt` | yes | Alt text is not optional, the a11y gate fails without it. |
| `heroCredit` | yes | Licence line. The legal gate fails without it. |
| `imageStyle` | no | `plain` (default) or `phone`. Sets the default for bare images in the body. |
| `sources` | yes | Becomes the "Checked against" block and the last-checked date. |
| `status` | yes | `draft` blocks the build. `ready` lets it through the gates. |
| `sourceRef` | no | Internal only. **Stripped from published HTML.** |
| `publishedUrl` | no | Filled in by the build after the post goes live. |

### Body

Plain markdown. Headings start at `##`, never `#`, since the title
already supplies the only `<h1>`.

Two extras the generator understands:

**Facts block.** The scannable answer near the top. Readers skim it and
answer engines lift it. Write it as a definition list:

```markdown
::: facts The trip, in short
When: **22 to 30 August 2026**, open 9am to 4:45pm daily
Station: Auburn, on the **T2 Leppington and Inner West Line**, every day
Fare from Central: About **$3.76** off peak, $5.38 peak
:::
```

**Callout.** One boxed instruction:

```markdown
::: callout Do this first
Book the ticket before you plan the trip. A sold-out weekend is the one
thing a good train plan cannot fix.
:::
```

### Images

The style is picked per image, in the markdown title slot.

```markdown
![Live parking on the trip screen](/images/blog/x.webp)
```
Plain framed card. Ink border, hard offset shadow, caption from the alt.

```markdown
![Live parking on the trip screen](/images/blog/x.webp "phone")
```
Device frame, on a tinted stage. Use raw screen captures for this, not the
marketing renders, because those already have a phone frame baked in and
would double up.

One phone per stage, centred and square on. Two framed devices side by
side never sit symmetrically, the frames fight each other. If a post
genuinely needs two screens, use two separate stages.

Anything after a pipe in the title slot becomes the caption:

```markdown
![Departures](/img/a.webp "phone | Save it once, tap it every day")
```

```markdown
![Map of the gardens](/images/blog/map.webp "bleed | Wider than the text")
```
Breaks out past the prose column.

---

## 4. Categories and colour

Each category owns a Sydney transport mode colour. Set once via `series`,
inherited by the tag, the card shadow, the squiggle and the headings.

| `series` | Label | Mode colour |
|---|---|---|
| `things-to-do` | Things to do | Train orange |
| `eat-and-drink` | Eat and drink | Ferry green |
| `app` | App showcase | Metro teal |
| `behind-the-scenes` | Behind the scenes | Coach purple |
| `news` | News | Bus blue |

### The accent triplet

Brand colours are not text colours. Several mode colours sit near 2.4:1 on
white, well under the 4.5:1 WCAG asks for. So every accent resolves to
three tokens:

| Token | Use | Contrast duty |
|---|---|---|
| `--accent` | Stamp shadows, squiggle, small squares, blobs. Decoration only. | None. Never the sole carrier of meaning. |
| `--accent-ink` | Any text. Headline accent word, tag label, links, drop cap. | 4.5:1 against the current surface. |
| `--accent-fill` | Solid chips, flags, counters where white text sits on top. | White on it clears 4.5:1. |

**These values are decided once, by maths, and then frozen.** They live in
`blog.tokens.css`, which is generated. Nothing recomputes them at build
time and nobody picks a hex by eye. The only time they change is if a
brand colour itself changes, and then you run:

```bash
node tools/a11y-contrast.mjs --write    # regenerate blog.tokens.css
node tools/a11y-contrast.mjs            # verify, exits non-zero on fail
```

`blog.css` carries fallback values for the case where the generated file
fails to load, and nothing else.

---

## 5. Copy rules

Full list lives in `CLAUDE.md` section 2 and is enforced by the copy gate.
The two that catch people most often:

- **No em dash** anywhere a reader can see it. Rephrase to a period or a
  comma. Do not substitute a middle dot.
- **No middle dot** `·` or `•` or `‧` or `∙` anywhere a reader can see it,
  including page titles, meta descriptions and share card text. Where a
  separator is genuinely needed, the design draws one as an element
  (`<span class="sep"></span>`), which renders a small square in the
  accent colour.

Also enforced: no competitor names, no tech jargon, no forever-free
promises, no private analytics numbers, no founder personal details, and
accent highlights of one or two words maximum.

---

## 6. The gates

Every gate runs on the pull request. A single comment reports pass or fail
per gate with file and line. Blocking gates must be green before merge.

### 6.1 Copy and brand gate (planned, blocking)

Regex checks driven by `CLAUDE.md` section 2. Runs against the markdown
**and** the generated HTML, so `<title>` and OG text are covered too.

### 6.2 Legal gate (planned, blocking)

- TfNSW disclaimer present verbatim in the footer
- Registered mark beside the wordmark
- No TfNSW, Sydney Trains, Sydney Metro, Opal or NSW Government wordmarks
- No full branded line names such as `T2 Leppington and Inner West Line`.
  Bare line codes like `T2` are fine
- No phrasing that reads as the network itself rather than someone writing
  about it, such as `Sydney rail` or `Transport publishes`
- No official numbered line shields
- No partnership or endorsement claim
- Every image has a `heroCredit` or per-image licence line

Scope matters here. The gate runs over visible copy, `<title>`, meta
descriptions, OG and share card text, alt text **and JSON-LD**. The
structured data is the easiest place for a branded name to survive a
review, and it is exactly what answer engines quote back.

The full string-by-string table lives in `CLAUDE.md` section 5, including
the citation exception: a source being cited and linked may be named by
its real publisher, because hiding it makes the citation weaker.

An audit of the first three demo pages found five violations, all since
fixed: two full branded line names, two uses of `Opal`, and one sentence
that made TfNSW the subject. Three of them were also sitting inside the
FAQ JSON-LD.

### 6.3 Accessibility gate (partly built, blocking)

Four layers:

| Layer | Tool | Status |
|---|---|---|
| Token contrast | `tools/a11y-contrast.mjs` | built, green |
| Structural markup, 14 checks | `tools/a11y-static.mjs` | built, green |
| WCAG 2.2 AA violations | axe-core against the built pages | planned |
| Headline score | Lighthouse, reusing `audit/a11y.sh` | planned |

The 14 structural checks: html lang, non-empty title, exactly one `h1`,
no skipped heading levels, alt on every image, unhelpful alt text,
meaningful link text, button accessible names, decorative svg hidden from
screen readers, duplicate ids, `main` landmark and labelled `nav`
landmarks, positive tabindex, toggle buttons exposing `aria-pressed`, a
`prefers-reduced-motion` block, and outlines not removed without a
`:focus-visible` replacement.

They need no dependencies and no browser, so they run in about a second
and can gate every push. On first run against the demo pages they found
26 real failures, all since fixed.

Output is a markdown summary on the PR plus the full HTML report uploaded
as a build artifact, retained 90 days.

Already handled in the design: reduced motion disables every animation and
reveals all content, the squiggle draws only as decoration and is
`aria-hidden`, mode colour is never the only signal because every tag
carries text, and the reading progress bar is `aria-hidden`.

### 6.4 SEO gate (planned, blocking)

Title 30 to 60 characters, description 70 to 160, exactly one `h1`, no
skipped heading levels, alt text everywhere, hero present and under the
weight budget, canonical set, OG and Twitter tags present, valid
`BlogPosting` JSON-LD, at least one internal link, slug format, word count
floor.

### 6.5 AI and answer-engine gate (planned, blocking)

Generative engines cite structure, not prose. This gate requires:

- The question answered in the opening 40 words
- A facts block
- Question-shaped `h2` headings
- `FAQPage` and `Speakable` schema
- Author `Person` schema with `sameAs`
- A sources block with a last-checked date

It also regenerates `llms.txt`, `feed.xml` and `sitemap.xml` on every
build.

### 6.6 Link and performance gate (planned, blocking)

No dead internal links, every referenced image exists on disk and is
within the weight budget, HTML parses, and the existing Lighthouse budget
in `.github/workflows/lighthouse.yml` extended to cover the blog index and
one post.

### 6.7 Model QA (planned, advisory first)

A Claude step reads the post against `CLAUDE.md` and the commuter test,
then comments pass or fail with line notes. Starts non-blocking. Promoted
to blocking once its judgement has been trusted for a while.

---

## 6.8 Mobile gate (planned, blocking)

Most readers arrive on a phone, so mobile gets its own gate rather than
being a footnote on the desktop one.

- Lighthouse mobile preset with hard budgets: LCP under 2.5s, CLS under
  0.1, INP under 200ms, plus a total weight and image weight ceiling
- No horizontal overflow at 360, 390 and 430 CSS pixels
- Tap targets at least 44 by 44
- Body text at least 16px, so iOS does not zoom when a field is focused

Already handled in the design:

- The Journal link survives the mobile nav collapse. Only links that
  duplicate the landing page are dropped.
- The sticky nav drops its backdrop blur under 860px, since that blur is
  expensive to repaint on a low-end phone.
- The ambient background drops from six large radial gradients to three,
  for the same reason.
- The phone frame scales to 190px and the facts table stacks to one
  column.

---

## 7. Deploy

The site is served by GitHub Pages in **legacy** mode, from the `main`
branch root, at `krail.app`. There is no build step for the rest of the
site and that stays true.

```
push to main
  → .github/workflows/build-blog.yml
  → node tools/build-blog.mjs
  → regenerates blog/index.html, blog/<slug>/index.html,
    feed.xml, sitemap.xml, llms.txt
  → commits the result back to main
  → legacy Pages picks it up and serves it
```

Two details that matter:

- The workflow's path filters exclude the generated output, so the bot's
  own commit cannot retrigger the build. Pushes made with `GITHUB_TOKEN`
  do not trigger workflows either, so this is belt and braces.
- The generator is deterministic. No timestamps, no random ordering. An
  unchanged post produces a zero-line diff, which keeps the bot commits
  meaningful.

### Rolling back

Revert the commit that added or changed the post and push. The next build
regenerates without it. To pull a live post down fast without waiting for
a review cycle, move the markdown from `blog/posts/` back to `blog/queue/`
and merge, which removes the page on the next build.

---

## 8. Running things locally

```bash
# serve the site
python3 -m http.server 8080 --bind 127.0.0.1
# then open http://127.0.0.1:8080/blog/

# contrast gate
node tools/a11y-contrast.mjs
node tools/a11y-contrast.mjs --derive     # print passing variants

# accessibility score against a live URL
./audit/a11y.sh http://127.0.0.1:8080/blog/
```

---

## 9. The demo theme lab

The three demo pages carry a fixed panel in the bottom right with:

- **Paper / Ink / Auto** to compare light, dark and system themes
- **Accent contrast** to flip between the accessible tokens and the raw
  brand hues, so the tradeoff can be judged side by side. The vivid mode
  fails WCAG on purpose.
- **Accent swatches** to preview any mode colour on the current page

This panel is demo scaffolding. It is deleted before anything ships, along
with the `[data-vivid]` rule in `blog.css` and the lab block in `blog.js`.

---

## 10. Open decisions

1. **Default theme.** Paper, Ink, or follow the system. Currently Paper.
2. **Accent contrast.** Accessible tokens, which mute the orange and blue
   noticeably, or vivid brand hues with a documented WCAG failure.
   Currently accessible.
3. **Content source of truth.** The markdown moves into `KRAIL-Website`,
   which is public, or stays in `KRAIL-SHORTS`, which is private, with a
   sync step. Public is far simpler. Private keeps drafts private.
   Either way `sourceRef` is stripped from published HTML.
