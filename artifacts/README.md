# Artifacts

Self-contained components extracted from the iBoost site, designed to be
reused on other projects without any build step or external dependencies.

## Contents

### `hero.html`

The full iBoost homepage hero section — header, copy + CTAs, animated
12-month credit scorecard with trend chart, and 3 supporting mini-stat
cards. Everything (HTML, CSS, JS, SVG icons and logo) is inlined in a
single file.

**To use:**
1. Open directly in a browser — it works standalone
2. Or copy the entire file to a new project and start editing
3. To tell a different journey: edit the `MONTHS` array inside the
   `<script>` block near the bottom
4. To re-theme: change the CSS variables at the top of the `<style>`
   block (primary, accent, spacing tokens)
5. To swap the logo: replace the two `<svg>` paths in the header's
   `.logo-mark` and update `.logo-wordmark` text

**Design tokens used:**
- Primary navy: `#0A2540`
- Accent emerald: `#2ECC71`
- Emerald soft: `#d1fae5`
- Font stack: system fonts (no external load)

**Key interactions:**
- Scorecard: 2.4s per month, 3.5s rest at month 12, auto-loops
- Play/pause button + scrubber slider for manual control
- Tab-visibility pause (stops animation when tab hidden, resumes on focus)
- Hero CTA: pulsing emerald glow (2.5s cycle), arrow scoots right on hover
- Mini-stats: lift 1px on hover with brightened emerald border
- Full-viewport height on desktop (≥860px), natural flow on mobile

**Browser support:**
Modern Chrome, Safari, Firefox, Edge. Uses `100dvh` with `100vh` fallback.
No build tools needed.
