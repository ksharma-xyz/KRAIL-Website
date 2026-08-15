#!/usr/bin/env node
/* ============================================================
   Contrast gate.

   The KRAIL mode colours are brand colours, not text colours.
   Several of them fail WCAG when used as text on white. This
   script checks every text-on-background pair the blog actually
   renders, and can derive a passing variant of any colour that
   fails, so the brand hue survives while the text stays legible.

   Usage:
     node tools/a11y-contrast.mjs           check the pairs, exit 1 on fail
     node tools/a11y-contrast.mjs --derive  print passing variants
   ============================================================ */

const AA_NORMAL = 4.5;   // body text
const AA_LARGE  = 3.0;   // >= 24px, or >= 18.66px bold
const AA_UI     = 3.0;   // borders, icons, focus rings

/* ---------- colour maths ---------- */

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const rgbToHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

const channelLuminance = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(channelLuminance);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/* Walk a colour toward black (or white) until it clears the ratio.
   Scaling in linear-ish sRGB space keeps the hue recognisable. */
const derive = (hex, bg, target) => {
  const toward = luminance(bg) > 0.5 ? 0 : 255;
  const rgb = hexToRgb(hex);
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const candidate = rgbToHex(rgb.map((c) => c + (toward - c) * t));
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return toward === 0 ? '#000000' : '#FFFFFF';
};

/* ---------- what the blog actually renders ---------- */

const PAPER = '#FFFFFF';
const INK_BG = '#131316';   // dark mode surface
const INK = '#1C1B1A';
const INK_DARK = '#FCF6F1';

const MODES = {
  train: '#F6891F',
  bus:   '#00B5EF',
  metro: '#009B77',
  ferry: '#5AB031',
  coach: '#742282',
  lr:    '#E4022D',
  pink:  '#FF2F8F',
};

const PAIRS = [
  { name: 'body text on paper',        fg: '#2E2E2E', bg: PAPER,   need: AA_NORMAL },
  { name: 'muted text on paper',       fg: '#6B6157', bg: PAPER,   need: AA_NORMAL },
  { name: 'body text on ink',          fg: '#E2E2E2', bg: INK_BG,  need: AA_NORMAL },
  { name: 'muted text on ink',         fg: '#A9A5A2', bg: INK_BG,  need: AA_NORMAL },
  { name: 'paper on ink stamp',        fg: PAPER,     bg: INK,     need: AA_NORMAL },
  { name: 'disclaimer label on ink',   fg: '#FFFFFF', bg: '#DB287B', need: AA_NORMAL },
];

/* The accent triplet as blog.css actually declares it. Keep these in
   sync with the [data-cat] blocks. --accent itself is not checked: it
   only ever paints stamp shadows, the squiggle and small squares, all
   of which sit beside ink text or an ink border carrying the same
   meaning. WCAG 1.4.11 covers UI that conveys information on its own,
   which none of those do. */
const TOKENS = {
  train: { light: '#B16316', dark: MODES.train, fill: '#B16316' },
  bus:   { light: '#007FA7', dark: MODES.bus,   fill: '#007FA7' },
  metro: { light: '#008768', dark: MODES.metro, fill: '#008768' },
  ferry: { light: '#448425', dark: MODES.ferry, fill: '#448425' },
  coach: { light: '#742282', dark: '#A26BAB',   fill: '#742282' },
  lr:    { light: '#E4022D', dark: '#E93557',   fill: '#E4022D' },
  pink:  { light: '#DB287B', dark: MODES.pink,  fill: '#DB287B' },
};

for (const [mode, t] of Object.entries(TOKENS)) {
  PAIRS.push({ name: `${mode} accent-ink on paper`,  fg: t.light,   bg: PAPER,  need: AA_NORMAL });
  PAIRS.push({ name: `${mode} accent-ink on ink`,    fg: t.dark,    bg: INK_BG, need: AA_NORMAL });
  PAIRS.push({ name: `white on ${mode} accent-fill`, fg: '#FFFFFF', bg: t.fill, need: AA_NORMAL });
}

/* ---------- generate blog.tokens.css ----------
   The accent triplet is computed, never hand-picked. Running with
   --write regenerates the stylesheet so the decision is made once,
   by maths, and then frozen in a committed file. Nothing downstream
   recomputes it and nobody has to eyeball a hex again. */

const CATEGORIES = {
  'things-to-do':      'train',
  'eat-and-drink':     'ferry',
  'app':               'metro',
  'behind-the-scenes': 'coach',
  'news':              'bus',
};

const fillFor = (hex) => {
  if (contrast('#FFFFFF', hex) >= AA_NORMAL) return hex;
  const rgb = hexToRgb(hex);
  for (let step = 0; step <= 100; step++) {
    const candidate = rgbToHex(rgb.map((c) => c * (1 - step / 100)));
    if (contrast('#FFFFFF', candidate) >= AA_NORMAL) return candidate;
  }
  return '#000000';
};

const writeTokens = async () => {
  const { writeFileSync } = await import('node:fs');
  const lines = [];
  lines.push('/* ============================================================');
  lines.push('   GENERATED FILE, DO NOT EDIT.');
  lines.push('   Regenerate with: node tools/a11y-contrast.mjs --write');
  lines.push('');
  lines.push('   Every value below is derived so that text clears WCAG AA');
  lines.push('   4.5:1 against the surface it sits on. The pure brand hue is');
  lines.push('   kept as --accent for decoration only.');
  lines.push('   ============================================================ */');
  lines.push('');

  const pinkInk = derive(MODES.pink, PAPER, AA_NORMAL);
  lines.push(':root {');
  lines.push(`  --accent:      var(--brand-pink);`);
  lines.push(`  --accent-ink:  ${pinkInk};   /* ${contrast(pinkInk, PAPER).toFixed(2)}:1 on paper */`);
  lines.push(`  --accent-fill: ${fillFor(MODES.pink)};`);
  lines.push('}');
  lines.push('');
  lines.push('[data-theme="dark"] {');
  const pinkInkDark = derive(MODES.pink, INK_BG, AA_NORMAL);
  lines.push(`  --accent-ink:  ${pinkInkDark};   /* ${contrast(pinkInkDark, INK_BG).toFixed(2)}:1 on ink */`);
  lines.push(`  --accent-fill: ${fillFor(MODES.pink)};`);
  lines.push('}');
  lines.push('');

  for (const [cat, mode] of Object.entries(CATEGORIES)) {
    const hex = MODES[mode];
    const light = derive(hex, PAPER, AA_NORMAL);
    const fill = fillFor(hex);
    lines.push(`[data-cat="${cat}"] {`);
    lines.push(`  --accent:      var(--${mode});`);
    lines.push(`  --accent-ink:  ${light};   /* ${contrast(light, PAPER).toFixed(2)}:1 on paper */`);
    lines.push(`  --accent-fill: ${fill};   /* white on it ${contrast('#FFFFFF', fill).toFixed(2)}:1 */`);
    lines.push('}');
  }
  lines.push('');
  for (const [cat, mode] of Object.entries(CATEGORIES)) {
    const hex = MODES[mode];
    const dark = derive(hex, INK_BG, AA_NORMAL);
    lines.push(`[data-theme="dark"] [data-cat="${cat}"] { --accent-ink: ${dark}; }   /* ${contrast(dark, INK_BG).toFixed(2)}:1 on ink */`);
  }
  lines.push('');

  const out = new URL('../blog.tokens.css', import.meta.url);
  writeFileSync(out, lines.join('\n'));
  console.log(`\n  Wrote blog.tokens.css with ${Object.keys(CATEGORIES).length + 1} accent triplets.\n`);
};

/* ---------- run ---------- */

if (process.argv.includes('--write')) {
  await writeTokens();
}

const deriveMode = process.argv.includes('--derive');
const fails = [];

console.log('\n  Contrast check\n');
for (const p of PAIRS) {
  const ratio = contrast(p.fg, p.bg);
  const pass = ratio >= p.need;
  if (!pass) fails.push(p);
  const badge = pass ? 'PASS' : 'FAIL';
  console.log(
    `  [${badge}] ${ratio.toFixed(2).padStart(5)}:1  needs ${p.need.toFixed(1)}  ${p.name}  ${p.fg} on ${p.bg}`
  );
}

if (deriveMode) {
  console.log('\n  Derived variants (hue preserved, luminance shifted)\n');
  for (const [mode, hex] of Object.entries(MODES)) {
    const onPaper = derive(hex, PAPER, AA_NORMAL);
    const onInk = derive(hex, INK_BG, AA_NORMAL);
    /* A fill needs to be dark enough that white text on it passes. */
    const fill = derive('#FFFFFF', hex, AA_NORMAL) === '#FFFFFF' && contrast('#FFFFFF', hex) >= AA_NORMAL
      ? hex
      : (() => {
          const rgb = hexToRgb(hex);
          for (let step = 0; step <= 100; step++) {
            const candidate = rgbToHex(rgb.map((c) => c * (1 - step / 100)));
            if (contrast('#FFFFFF', candidate) >= AA_NORMAL) return candidate;
          }
          return '#000000';
        })();
    console.log(`  --${mode}`);
    console.log(`      accent      ${hex}`);
    console.log(`      accent-ink  light ${onPaper} (${contrast(onPaper, PAPER).toFixed(2)}:1)   dark ${onInk} (${contrast(onInk, INK_BG).toFixed(2)}:1)`);
    console.log(`      accent-fill ${fill} (white on it ${contrast('#FFFFFF', fill).toFixed(2)}:1)`);
  }
}

console.log('');
if (fails.length) {
  console.log(`  ${fails.length} pair(s) below target.\n`);
  if (!deriveMode) console.log('  Run with --derive to get passing variants.\n');
  process.exit(1);
}
console.log('  All pairs pass.\n');
