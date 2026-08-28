# Privacy policy — editing guidance

The policy lives at `privacy-policy/index.html` and is served at
`https://krail.app/privacy-policy/`. Both app store listings point at that
exact URL — never move or rename it.

## Rules for every edit

- **Bump "Last updated"** to the day the change actually goes live.
- **Policy ships first.** If an app release changes what data is collected,
  the updated policy must be live before the first build of that release
  reaches a user.
- **Verbatim-legal carve-out.** This file is exempt from the site voice
  gates (`tools/gates.mjs` deliberately skips it), so em dashes and middle
  dots are fine here. Do not "fix" its punctuation, and do not remove the
  carve-out.
- **User-facing words only.** If a term exists in the codebase, rewrite it
  before it enters the policy: "pseudo ID" → "random identifier",
  "digit redaction" → "numbers are masked", never name internal tools or
  databases. Rule of thumb: a non-technical Sydney commuter should
  understand every sentence.
- **Keep it short.** The whole policy should stay around a one-minute read.
  Specifics that read like documentation belong in the app repo's telemetry
  spec, not here.

## Release checklist (repeat for every release that touches data)

1. Policy text updated and live at `/privacy-policy/`.
2. Apple App Store Connect → App Privacy label matches the policy
   (search text = "Search History", under Data Not Linked to You).
3. Google Play Console → Data safety form matches the policy
   (search history: collected, not shared, deletion via email).
4. Release notes mention the change — section 09 of the policy promises
   this, so it is not optional.

## Ideas backlog

- **"At a glance" box** at the top of the policy — three lines: no account
  needed; location never leaves your device; search text kept (masked,
  anonymous) to improve search. Most visitors will read only that.
- **Short privacy FAQ page** ("Can you see where I live?", "Do you sell my
  data?") — plainer trust signal than legal text, and good for search
  engines.
