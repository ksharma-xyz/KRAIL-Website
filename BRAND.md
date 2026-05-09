# KRAIL — brand, voice & business rules

What KRAIL is, who it's for, what we say, what we never say. Read
this before writing any user-facing copy. For visual rules see
`STYLING.md`. For zero-tolerance copy bans see `CLAUDE.md`.

---

## What KRAIL is

A free Sydney-only public-transport app. Real-time arrivals across
**Trains, Metro, Buses, Ferries, Light Rail and Coaches**. Saved
trips. Live Park & Ride. A cleaner way to ride than the alternatives,
made by someone who actually rides Sydney's network every day.

iOS + Android. Built by **Karan**, one Sydney commuter. Open source.

## What KRAIL isn't

- A national / multi-city transit app (Sydney-only on purpose)
- An official Transport for NSW product (we are unaffiliated)
- A marketing-funded startup (no VC, no team, no agency)
- A subscription product (free during launch — see pricing rules below)
- A platform for ads, data brokers, or tracking

---

## Audience

A non-technical Sydney commuter. Probably gen-Z or younger millennial.
Cares how apps look and feel. Tired of subscription fatigue. Wants
something that respects their time and works on the platform they're
holding (iPhone or Android).

Write like you're talking to **a Sydney friend on the train**, not
to a developer or an investor.

---

## Voice & tone

- **Confident, playful, slightly cocky.** KRAIL is a beautifully-made
  Sydney transit app and we say so.
- **Sydney-anchored.** Real station names, real situations:
  *Tallawong at 7:05*, *T2 line at Redfern*, *Bondi-bound on Friday*.
  Specifics over abstractions.
- **First person.** "I built KRAIL", "we read every email" — never
  "the app does X" in third person.
- **Polite to everyone, especially competitors.** We never bash other
  apps. Reframe positively: "Sydney commuters deserve a modern way to
  ride", not "TripView is old".
- **No corporate words.** Never use: `journey` (the noun in marketing
  sense), `leverage`, `transformative`, `thrilled`, `excited`,
  `disrupt`, `revolutionise`, `next-gen`, `smart`, `AI-powered`.

---

## Mandatory copy rules

(See `CLAUDE.md` §2 for the full zero-tolerance table.)

### Always include

- **Trademark `®`** beside the KRAIL wordmark in nav + footer copyright.
- **TfNSW disclaimer** verbatim in the footer:
  > This app is not affiliated with or endorsed by Transport for New
  > South Wales (TfNSW). The data presented in this app is sourced
  > from public APIs and services provided by TfNSW, and while we
  > strive to ensure the accuracy and timeliness of the information,
  > we cannot guarantee it. Users should verify all information
  > independently.

### Forbidden — zero tolerance

- **Em dash `—`** anywhere user-visible. Use `·` or rephrase.
- **Competitor names**: TripView, Opal Travel, Google Maps, Citymapper,
  Apple Maps, Transit, etc. Refer generically.
- **Tech jargon**: Compose, Kotlin Multiplatform, OLED, Vector,
  sub-second, IDFA, SDK, GitHub, open-source-on-GitHub. Use consumer
  framing.
- **Internal analytics**: 12.6× reopens, 67% Android dark mode, 175
  daily savers, BigQuery numbers. These are private — don't surface
  them on public pages.
- **Founder personal details**: 1-bedroom flat, paid for in long
  blacks, sleeping habits, "no investors" bragging. Stick to "Built
  by one Sydney commuter."
- **"Forever" promises**: don't say "stays free forever" or "anything
  free today stays free forever". The asterisk (`*`) commitments are
  the only future promise.
- **Bashing**: "looks like 1995", "looks like Windows 95", "TripView
  hasn't shipped in years". Never.

---

## The Sydney-touchy taglines

Approved phrases the rotator and copy can pull from:

- `Hello Sydney,`
- `Where are you going today?`
- `Ride the rail without fail.`
- `LET'S KRAIL` / `#LET'S KRAIL` (always bold italic, hashtag form)
- `Built with ♥ in Sydney`
- `on the T2 line` / `on the M1 home`
- `parked at Tallawong`
- `between Wynyard & Town Hall`
- `from Tallawong to Town Hall`
- `riding the 7:05 with you`
- `last bus to Bondi`
- `Bondi-bound for the weekend`
- `Tallawong, again`
- `always shipping`
- `updated this week`
- `Tag us. Roast us. Praise us.`
- `Sydney commuters deserve a beautiful, modern way to ride.`

Theme tag lines from the app (KrailThemeStyle.kt) — used as "vibe"
labels per feature block:
- Train: `On the track, no lookin' back!`
- Metro: `Surf the sub, no cap!`
- Bus: `Hoppin' the concrete jungle!`
- Ferry: `Smooth sail, no fail!`
- Light Rail: `Dressed in pink, fastest link!`
- Purple Drip: `Purple drip, endless trip!`

---

## Pricing & monetisation rules

The brand promise is **"Free is Pro"** — competitors lock features
behind paywalls; KRAIL's core experience doesn't.

### Right now (until at least December 2026)

- **App is free.** No subscription. No in-app purchases.
- **No ads.** Zero advertising during the launch period.
- **No sign-up required.** No account, no login.

### Asterisk language (the only future promises we make)

- `*Free for every Sydney commuter until December 2026.`
- `*No ads during launch period.`

These are the **only** asterisk lines on the site. They live in **one
place** (currently the final CTA section). Don't duplicate them in the
footer or elsewhere.

### What MAY happen after launch

- Optional paid extras (e.g. Pro Insights, smart push notifications,
  family share) — anything new, never anything currently free.
- A small number of small, non-disruptive ads to fund Sydney-only
  development. Never auto-play video, never blocks your trip, never
  tracking ads.

### What WILL NEVER happen

- Locking saved trips behind a paywall
- Locking dark mode behind a paywall
- Locking real-time data behind a paywall
- Locking Park & Ride behind a paywall
- Selling user data
- Cross-app tracking / IDFA usage

If a feature exists in the free app today, it stays free in the free
app tomorrow. (We don't *say* "forever" on the website, but it's the
internal commitment.)

---

## Trademark & ownership

- **KRAIL is a registered trademark.** Karan owns it.
- Use the **`®`** mark beside the KRAIL wordmark on the first prominent
  occurrence per page (nav + footer copyright). Don't repeat
  everywhere. `® size: ~0.58em, opacity 0.85, vertical-align 0.45em`.
- Copyright line: `© 2024 KRAIL® · All rights reserved.`

### Don't put on the site

- TfNSW logo or wordmark
- NSW Government logo or any state-government mark
- "Sydney Trains" / "Sydney Metro" / "Opal" wordmarks or branded
  service names as our own brand
- The official **numbered line shields** (T1/T2/T3 with their specific
  shape, gradient, white outline). Generic letter-on-circle pills are
  fine — official shields are not.
- Any claim of partnership, endorsement, or affiliation with TfNSW.

### Safe to use

- Single-letter mode pills (T / M / B / F / L / C) on coloured circles
  — letters and colours aren't copyrightable.
- Sydney station names in copy ("Tallawong", "Town Hall", "Wynyard")
- Generic mode names ("Train", "Metro", "Bus", "Ferry", "Light Rail")
- TfNSW open-data colour palette (the specific hex values from the app)
- The unaffiliated disclaimer (mandatory)

---

## Marketing messaging anchors

Three positioning anchors. Every headline and section must trace
back to one of these.

1. **"Sydney commute, respected."**
   Built for the 7am Tallawong parking lottery, the T1 at Redfern,
   the "which side of the street is my bus stop" walk. Not a generic
   transit app skinned with NSW colours.

2. **"Free is Pro."**
   The Saved Trips / no-ads / no-subscription bundle competitors
   charge for stays free, permanent and non-negotiable.

3. **"Built by one Sydney commuter."**
   Solo dev, public progress, no VC, no team. Real flyers from
   Schofields Station, real testimonials, real Sydney photos —
   never stock imagery, never iPhone-on-marble.

---

## Hard pages structure

| Path | Purpose | Status |
|---|---|---|
| `/` (`index.html`) | Marketing landing page | Live |
| `/privacy.html` | Privacy policy (verbatim from krail.app) | Live |

Anchors on `/`:
- `#top` (page top)
- `#download` (store buttons in hero)
- `#features` · `#stats` · `#testimonials` · `#contact` (founder) · `#faq`

The `Get the app` and store buttons **auto-detect platform**:
- iOS → `https://apps.apple.com/us/app/krail-app/id6738934832`
- Android → `https://play.google.com/store/apps/details?id=xyz.ksharma.krail`
- Desktop / unknown → scroll to `#download`

Real social URLs (from KRAIL app `KrailSocialType.kt`):
- LinkedIn: `https://www.linkedin.com/company/krail/`
- Instagram: `https://www.instagram.com/krailapp/`
- Facebook: `https://www.facebook.com/krailapp`
- Reddit: `https://www.reddit.com/r/krailapp/`
(No TikTok — KRAIL is not on TikTok.)

---

## Documentation triangle

Three files together cover everything:

1. **`CLAUDE.md`** — brand/copy/IP zero-tolerance rules. Read first.
2. **`STYLING.md`** — design system, tokens, components, animations,
   what's been tried and rejected.
3. **`BRAND.md`** — this file. Voice, audience, positioning,
   monetisation rules, trademark, mandatory disclaimers.

When making changes:
- Copy / wording change? → check `CLAUDE.md` + this file
- Visual / styling change? → check `STYLING.md`
- New section / page? → check all three

---

## When in doubt

- **Match what's in these docs, not what feels right in the moment.**
- **Sydney-anchored, indie-confident, anti-corporate, polite.**
- **`®` once, asterisks once, disclaimer once, animations always.**
- **Mode colours per section, pink/blue subtle.**
- **Match the app — if KRAIL the app does it, the site can do it.**
