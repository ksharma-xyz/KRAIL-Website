# Fonts

Self-hosted, not pulled from Google Fonts at runtime.

The Journal is budgeted to a 2.5s largest contentful paint on a throttled
phone. Two Google Fonts families cost four cross-origin requests across two
domains (`fonts.googleapis.com` for the CSS, then `fonts.gstatic.com` for the
file), and on that connection the DNS and TLS handshakes alone were the
largest single cost on every page. Measured in CI: every local request
answered in 2 to 4ms while the font origins took 30 to 41ms before transfer
even began. Serving these two files from our own origin removed that.

It is also the more private option. Nobody reading the Journal makes a
request to Google to do it.

| File | Family | Subset | Source | Licence |
|---|---|---|---|---|
| `roboto-900-latin.woff2` | Roboto 900 | latin | Google Fonts | Apache 2.0 |
| `fraunces-900-caps.woff2` | Fraunces 900, optical size 144 | A-Z only | Google Fonts | SIL Open Font License 1.1 |

Both licences permit redistribution and self-hosting.

`fraunces-900-caps.woff2` sets exactly one glyph per page, the drop cap, so
it is subset to the twenty six capitals it could ever need. That is 4KB
against roughly 40KB for the family. If a post ever needs the serif for
anything else, the subset has to be regenerated first, or the new characters
will silently fall back to the system serif.

To refresh either file, request the CSS from Google Fonts with a current
browser User-Agent (an old one is served TTF rather than woff2), take the
`src` URL from the block whose subset comment matches, and download it.
