# KRAIL Website — context for Claude

A working file for anyone (human or Claude) editing this site. Read before
making changes. Rules below are derived from real iteration with Karan —
some are zero-tolerance, others are strong defaults.

---

## 1. Brand identity

- **Name:** KRAIL® (registered trademark — Karan owns it).
- **Wordmark logo:** the literal text `KRAIL` in **Roboto Black 900**, no
  square icon, no mark beside it. The "K-square" badge is **not** the logo —
  never reintroduce it.
- **`®` placement:** small superscript `0.58em`, opacity 0.85, beside the
  brand wordmark. Use sparingly — once prominently per page is enough
  (nav + footer copyright is the convention).
- **Hashtag:** `#LET'S KRAIL` (with apostrophe, with space, ALL CAPS, **bold
  italic**, tightened `word-spacing: -0.18em`). It is treated as a
  hashtag-style accent, not a wordmark replacement.
- **Tagline:** `Ride the rail without fail.` — punchline always italic
  pink with the marker squiggle under "without fail."
- **Greeting line:** `Hello Sydney,` opens the hero. Refined italic display,
  not a hand-printed font (Patrick Hand is **out** — read kiddish).

---

## 2. Copy rules — zero tolerance

| Forbidden | Why | Use instead |
|---|---|---|
| Em dash `—` anywhere user-visible | Karan's voice rule | `·` (middle dot) or rephrase to a period/comma |
| Competitor names: `TripView`, `Opal Travel`, `Google Maps`, `Citymapper`, etc. | We never bash competitors | Refer generically: "other transit apps", "the official ones" |
| Tech jargon: `Compose`, `Kotlin`, `Multiplatform`, `OLED`, `Vector`, `Sub-second`, `Open source on GitHub`, `IDFA`, `SDK` | Marketing site, not a dev page | Consumer-friendly: "Available on iPhone & Android", "Lightning fast", "Smooth" |
| Founder personal details: `1-bedroom flat`, `paid for in long blacks`, `no investors`, sleeping habits, etc. | Not for the website | Stick to the public founder line: "Built by one Sydney commuter" |
| Internal/private analytics: `12.6× reopens`, `67% Android dark mode`, `2,204 saved trips`, `175 daily savers`, BigQuery numbers | Don't share private data | Use coverage numbers: `5 modes`, `6+ Park & Ride stations`, `24/7 TfNSW data` |
| `Stays free forever`, `Anything free today stays free forever` | Avoid promising forever-free | Just say `Free* until December 2026` with the asterisk |
| Bashing language: `looks like 1995`, `looks like Windows 95` | Reframe positive | "Sydney commuters deserve a modern way to ride" |

### Asterisks (always use these exact lines)

- `*Free for every Sydney commuter until December 2026.`
- `*No ads during launch period.`

The `*Free` and `*No ads` claims are the only place asterisks appear. They live in **one place** on the page — currently the CTA section. Don't duplicate them in the footer.

---

## 3. Visual / design rules

### Colours

- **Primary brand:** bright pink `#FF2F8F` + bright cyan `#1ADBFF`. Use
  these subtly — never as dominant page background.
- **Mode colours** (per Sydney transport mode, never override):
  | Mode | Hex |
  |---|---|
  | Train | `#F6891F` |
  | Metro | `#009B77` |
  | Bus | `#00B5EF` |
  | Ferry | `#5AB031` |
  | Light Rail | `#E4022D` |
  | Coach | `#742282` |
- **Per-section accent.** Set `--accent` at the section/block level so
  eyebrow, h2 em, squiggle, FAQ +/- icons, etc. all inherit. Each section
  rotates through mode colours so pink isn't everywhere:
  - Stats → bus blue
  - Features intro → metro teal
  - Saved Trips block → barbie pink
  - Park & Ride block → train orange
  - Map block → metro teal
  - Real-time block → bus blue
  - Testimonials → ferry green
  - Founder → coach purple
  - FAQ → light rail red
- **Body background.** ONE continuous soft pink/blue radial-gradient blob
  layer on `<body>`. No per-section blob `::before` (causes visible seams).
  Opacity ≈ 0.16–0.22 — ambient, not dominant.

### Mode icons (T M B F L C circles)

- **Always full alpha** — never `opacity < 1` even on small viewports.
- **White ring** (`2.5px solid #fff`) around each circle in the footer
  pill row.
- They appear as floating decoration in the hero (above the fold,
  staying clear of H1 text) and in the footer. They are NOT used as a
  labeled strip with words ("Train · on the track…") — that read poorly.

### Stamp pattern (Sumi-style)

Used everywhere a button sits: nav CTA, store buttons, email pill,
social stamps, FAQ open border, hero eyebrow chip, stat cards.

```
border: 2px solid var(--ink);
border-radius: 0;                /* sharp corners */
background: var(--ink);
color: #fff;
on hover:  transform: translate(-3px, -3px);
           box-shadow: 6px 6px 0 var(--accent-or-pink);
on active: transform: translate(0, 0);
           box-shadow: 3px 3px 0 var(--accent-or-pink);
```

Never use blurry drop-shadows or "glow halos" on buttons — looked yuck.

### Squiggle underline

Hand-drawn marker-pen squiggle under every italic accent word. Two
overlaid SVG paths (bold under-layer + thin top layer), draws in via
`stroke-dasharray` on `IntersectionObserver` viewport entry. Colour
follows `var(--accent)`.

### Hero icons positioning

Icons must stay **clear of the H1 reading zone**. Safe positions are
(approx % of `.hero` bounds):
- Right column: `top: 4–60%`, `left: 50–96%` or `right: 4–10%`
- Left edges only at `left: 0–2%` (peeking from screen edge)
- Never `left: 4–22%` between rows 20%–60% (overlaps H1)

### Animations

- Footer `LET'S KRAIL` — circular rainbow sweep with white sheen peak,
  left → right direction, 12s loop, glass halo. **Never static.**
- Mode pills — wobble dance on hover (rotate ±10°, scale 1.05–1.10).
- Heart `♥` next to the "Built with" line — heartbeat pulse, click
  for random tagline (easter egg).
- Tagline rotator — context-aware (time of day + day of week + active-
  shipping signals). **Don't** include "Built X days ago" — reads "old".
- All animations must respect `prefers-reduced-motion: reduce`.

---

## 4. Content sources

| What | Pull from |
|---|---|
| Privacy policy | `https://www.krail.app/privacy-policy` (verbatim) |
| Disclaimer text | The exact paragraph Karan provided — see `index.html` footer |
| Social URLs | `KRAIL/social/state/.../KrailSocialType.kt` (LinkedIn, Instagram, Facebook, Reddit — no TikTok) |
| Store URLs | `KRAIL/feature/.../ReferFriendManager.kt`: iOS `apps.apple.com/.../id6738934832`, Android `play.google.com/store/apps/details?id=xyz.ksharma.krail` |
| Theme tag lines | `KRAIL/taj/.../KrailThemeStyle.kt` — the per-mode catchphrases used in feature blocks |
| Mode colour values | `KRAIL/taj/.../theme/Color.kt` (`train_theme`, `bus_theme`, etc.) |
| Tested copy / testimonials | `KRAIL-Marketing/testimonials/testimonials.md` (verbatim, edit only to remove competitor names) |

**Always check the KRAIL app code, not your memory** — colours and URLs
have changed before.

---

## 5. Trademark / asset usage

### Safe to use on the site

- Single-letter mode pills (T / M / B / F / L / C) on coloured circles —
  letters aren't copyrightable, colours aren't copyrightable.
- TfNSW open-data colour palette (sourced from `KrailColors.kt`).
- Sydney station names in copy ("Tallawong", "Town Hall", "Wynyard", etc.).
- Generic mode names ("Train", "Metro", "Bus", "Ferry", "Light Rail").
- The "unaffiliated with TfNSW" disclaimer (mandatory — see footer).

### Never put on the site

- TfNSW logo or wordmark
- NSW Government logo or any state-government mark
- Sydney Trains / Sydney Metro / Opal wordmarks or branded service names
- The **official numbered line shields** (T1/T2/T3 with their specific
  shape, gradients, white outlines). The current generic "T2" letter on
  a coloured circle is fine — importing the actual TfNSW shield SVG is not.
- Any claim of partnership, endorsement, or affiliation with TfNSW.

### Always include

- **Footer disclaimer** (verbatim, full screen-width, in the same dark
  footer area, with `Disclaimer` label in pink):
  > This app is not affiliated with or endorsed by Transport for New
  > South Wales (TfNSW). The data presented in this app is sourced from
  > public APIs and services provided by TfNSW, and while we strive to
  > ensure the accuracy and timeliness of the information, we cannot
  > guarantee it. Users should verify all information independently.
- **`®`** beside the wordmark on each page.

---

## 6. Pages

| Path | Purpose |
|---|---|
| `/` (index.html) | Marketing landing page |
| `/privacy.html` | Privacy policy (verbatim from krail.app) |

Anchors on `/`:
- `#top` — page top
- `#download` — store buttons in hero
- `#features` — feature blocks
- `#stats` — coverage numbers
- `#testimonials` — review marquee
- `#contact` — founder section (Karan + email)
- `#faq` — FAQ accordion

`Get the app` and store buttons auto-detect platform — iOS → App Store,
Android → Play Store, desktop/unknown → scroll to `#download`.

---

## 7. Layout / structure rules

- **Smart-sticky nav** — visible at top, hides on scroll-down past 200px,
  re-appears on scroll-up. Don't change to plain sticky or plain scroll.
- **Top hero padding** — small (`12px`) so the greeting + H1 sit up high.
  `align-items: start` on `.hero-grid` (not `center`).
- **Features section** — vertical stack of 4 alternating-side blocks.
  Each block has its own phone screen + `--accent` mode colour. **Never
  reintroduce the pinned-scroll/sticky version** — was too fragile.
- **Footer** — near-black `#0B0B0D` (not the warm brown). No dividers
  between sub-sections. Disclaimer sits inline in the same dark area
  with just the pink `Disclaimer` chip differentiating it (no separate
  band, no border-top, no background tint).

---

## 8. When in doubt

- **Match the app.** If the app does it (icon shape, colour, tagline),
  the site can do it.
- **Less pink.** Pink/blue are accents, never section backgrounds.
- **Solid text, gradient on accents only.** Headlines stay solid colour.
  Gradient is for the marker highlights and the giant `LET'S KRAIL`.
- **Stamp not glass.** Buttons are solid stamps with hard offset
  shadows. Liquid-glass blur was rejected.
- **Read like a marketing site, not a tech page.** A non-technical Sydney
  commuter is the audience.
