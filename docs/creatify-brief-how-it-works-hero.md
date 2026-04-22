# Creatify Brief — iBoost How It Works Hero Background

**Target file**: `public/assets/img/brand/hero-how-it-works.jpg`
**Purpose**: Background image for the `<main>` hero of `/how-it-works.html`
**Date created**: 2026-04-22
**For**: Yan

---

## 1. Technical specs

Same as the pricing hero — identical CSS treatment, identical constraints.

| Spec | Value | Why |
|------|-------|-----|
| **Dimensions** | `1920 × 720 px` minimum | Wide format, will be cropped `center bottom` |
| **Aspect ratio** | ~`8:3` (21:9 ratio in Nano Banana Pro) | Matches the hero container |
| **Format** | `.jpg` | Photographic content compresses better |
| **File size target** | `< 60 KB` after optimization | Faster load; we'll optimize after generation |
| **Compression** | `quality 75-80%` | Heavy overlay washes out fine detail anyway |
| **Color profile** | `sRGB` | Web standard |

**Critical reminder**: The image will be rendered with:
- **~75-80% dark navy overlay** → only bold shapes, strong highlights, and biggest contrasts survive
- **center bottom / cover** positioning → BOTTOM of the image matters most; TOP often gets cropped
- **Radial gradient overlays** (emerald center, subtle cyan top) will tint certain areas

**Rule of thumb**: if the detail is clearly visible on your screen → **barely visible** on the site. If barely visible → invisible. Generate with **stronger contrast than feels right**.

---

## 2. Creative direction

### Theme
**How credit building works = the upward score trajectory**

The page explains the mechanics of credit building — what actually moves your score, step by step, month after month. The visual metaphor is **an ascending line chart / trajectory**, representing the journey from a low score to a high one. Abstract, data-inspired, optimistic but not naive.

This page sits at the intersection of **education** and **proof**. The hero should communicate: "this isn't a gimmick — here's the actual trajectory we see, and below we'll explain how it happens."

### Style keywords
`upward trajectory` · `data visualization` · `abstract chart` · `progression curve` · `financial analytics` · `navy + emerald` · `measured ascent`

### Style keywords to AVOID
`blueprint / architectural` (that's pricing's aesthetic, don't duplicate) · `cityscape` (that's homepage) · `cryptocurrency chart` · `neon / cyberpunk` · `rocket / moon / hockey-stick hype` · `literal calendar or clock` · `people / hands / faces` · `warm colors` · `glass-morphism / frosted panels`

**Important**: This is NOT a stock-photo financial chart with y-axis labels and candlesticks. It's an ARTISTIC representation of ascending trajectory — smoother, more atmospheric.

---

## 3. Composition requirements

**Layout**:

```
  ┌────────────────────────────────────────────────┐
  │                                                │
  │              [ EMPTY — TEXT GOES HERE ]        │  ← top 50%:
  │                                                │    dark navy with
  │                                                │    very subtle
  │                                                │    atmospheric fade
  ├────────────────────────────────────────────────┤
  │                              ╱╱╱╱╱╱╱→          │  ← middle to bottom:
  │                    ╱╱╱╱╱╱╱╱╱                   │    the ascending
  │         ╱╱╱╱╱╱╱╱╱╱                             │    trajectory line
  │  ╱╱╱╱╱╱╱                                       │    goes from bottom-
  │                                                │    left to top-right
  └────────────────────────────────────────────────┘
       ↑                                  ↑
   low start                       high destination
   (subtle)                        (glowing endpoint)
```

**Key zones**:
- **Top 50%** (where H1 sits): dark navy, mostly empty. Can have very faint glowing dots scattered (like stars) but nothing dense.
- **Middle to bottom diagonal**: a single prominent upward curve from bottom-left to top-right. Multiple secondary softer curves underneath for depth.
- **Bottom-left**: subtle, almost faded — represents "starting point, unknown credit future"
- **Top-right**: glowing emerald accent — represents "achieved goal, score destination"
- **Right side overall**: slightly brighter than left (the direction of progress)

**The trajectory curve is the star of this image.** Not buildings, not dots, not a grid — a CURVE that ascends.

---

## 4. Color palette (hard rules)

Identical to pricing brief — keep the iBoost palette strict.

| Role | Hex | Usage |
|------|-----|-------|
| Primary dark (base) | `#0A2540` | Main background, ~65% of surface |
| Secondary dark | `#0f2e4d` | Subtle variations, gradients |
| Deep shadow | `#041426` | Bottom-left corner vignette |
| Emerald accent | `#2ECC71` | The ascending curve — main focus color |
| Light emerald | `#6ee7a8` | Glow at the top-right destination |
| Cyan accent (sparse) | `#06b6d4` | Optional: ONE secondary curve could be cyan |
| Pure white | `#FFFFFF` | AVOID — reserved for the H1 text overlay |

**Rules**:
- **NO warm colors** (no orange, pink, red, amber, yellow). Non-negotiable.
- **The curve itself should be emerald** (#2ECC71), not white. White lines will blow out under the overlay.
- **Glow at the top-right endpoint** should be noticeable but not blinding — think "soft lighthouse beam" not "nuclear explosion"
- Saturation high on the emerald curve (it must survive the 75% overlay)

---

## 5. Content direction — what to draw

### Primary subject: Ascending trajectory curve

Think: "A beautiful, confident upward curve. Like a stock chart but abstracted and atmospheric — no axis labels, no ticks, no data points as dots. Just the curve itself, stylized."

**Elements to include** (pick 3-5, don't cram):

1. **Main ascending curve** (MANDATORY)
   - Goes from bottom-left to top-right, but not in a straight diagonal — smooth S-curve or gentle parabola
   - Thick emerald line (~2-3px at 1920 width)
   - Can be a solid line or a gradient (fainter at bottom-left, brighter at top-right)
   - The curve can be filled underneath with a soft gradient (emerald fading to transparent) to suggest "area chart" feel
   - Reach at top-right should be higher than start at bottom-left (obviously)

2. **Secondary ghost curves** (optional, adds depth)
   - 1-2 additional curves behind the main one, lower opacity (~15-25%)
   - Slightly different shapes — suggesting "alternative paths" or "previous months"
   - Same emerald color family, fainter

3. **Endpoint accent** (MANDATORY)
   - Where the curve ends at top-right: a small circle / dot / glowing point
   - Soft radial glow around it (emerald)
   - This is the "destination" visual — subtle but meaningful

4. **Atmospheric dots** (optional)
   - 3-8 very small glowing dots scattered in the upper-left area (opposite of the curve)
   - Like faint stars — adds depth without clutter
   - Low opacity (~30%)

5. **Faint horizontal reference lines** (optional)
   - 3-4 very subtle horizontal lines across the canvas (like score bands: 550, 650, 750, 850)
   - Very low opacity (~5-8%), emerald or white
   - Do NOT label them — they just add structure without being literal

### What NOT to include

- ❌ Candlestick charts or OHLC bars (this isn't stock trading)
- ❌ Y-axis labels, X-axis labels, numbers
- ❌ "$" signs or credit-score numbers (e.g., "580 → 720")
- ❌ Arrows at the endpoint (the curve ending + glow is enough)
- ❌ Multiple steep rocket-like trajectories (not hype, measured ascent)
- ❌ Buildings, people, clocks, calendars, hands
- ❌ Bar charts, pie charts, donuts
- ❌ Glitchy / crypto aesthetic
- ❌ Text of any kind

---

## 6. Mood references

Think of the aesthetic of:

- **Stripe Atlas** dashboards → clean, minimalist, data-as-art
- **Linear** blog post backgrounds → soft curves, emerald accents, navy bases
- **Vercel / Bloomberg Terminal** abstracted → technical but artistic
- **Apple Health** summary cards → confident upward movement, health-monitoring aesthetic
- **Notion's AI product page** (hero sections) → abstract gradients + single meaningful line

**DO NOT reference**:
- Robinhood / Coinbase charts (too bright, too gamified)
- TradingView / stock-trading apps (too technical, axis-heavy)
- Actual credit karma or credit-report screenshots
- Motivational / hustle-culture stock images

---

## 7. Quick Nano Banana Pro prompt to paste

Copy this into Nano Banana Pro (or Creatify with Nano Banana Pro selected):

> Abstract financial trajectory illustration, wide 21:9 aspect ratio (1920×820px), designed as a hero background for a fintech education page.
>
> **Layout:**
> - Top 50% of the canvas: mostly empty dark navy (#0A2540) with only 3-6 very faint glowing dots like distant stars
> - Bottom 50%: a single smooth upward-curving line going from the bottom-left to the top-right, drawn in saturated emerald green (#2ECC71), thick line weight
>
> **Style details:**
> - The main curve should have a soft glowing area fill underneath (emerald gradient fading to transparent), like an area chart
> - 1-2 secondary ghost curves behind the main one at lower opacity, suggesting alternative paths
> - At the top-right endpoint of the main curve, a small glowing circle with a soft radial halo around it (light emerald #6ee7a8)
> - 3-4 very subtle horizontal reference lines across the canvas (8% white opacity), like graph paper score bands, with NO labels
> - Soft emerald glow in the top-right quadrant behind the endpoint
>
> **Color rules (strict):**
> - Base: dark navy #0A2540
> - Primary accent: emerald #2ECC71
> - Secondary accent: light emerald #6ee7a8 (for the endpoint glow)
> - Optional rare accent: cyan #06b6d4 (maximum 1 use)
> - Forbidden: warm colors (no orange, pink, red, yellow, amber), neon brightness, white curves
>
> **Critical negative prompts:**
> - No axis labels, numbers, ticks, or text of any kind
> - No candlestick bars, pie charts, dollar signs
> - No arrows (the curve endpoint + glow is the destination signifier)
> - No buildings, people, clocks, or literal objects
> - No rocket-like steep hockey-stick trajectories — a measured smooth ascent
> - No cyberpunk neon, no glass-morphism, no 3D rendered lighting effects
>
> **Aesthetic references:** Stripe Atlas dashboards, Linear blog backgrounds, Apple Health summary cards
> **Mood:** Confident, measured, atmospheric, data-as-art

---

## 8. Iteration checklist

When you get outputs from Nano Banana Pro, evaluate against:

- [ ] **Is there ONE prominent ascending curve** going bottom-left to top-right?
- [ ] **Top 50% is mostly empty**? (H1 title will go there)
- [ ] **The curve is emerald green**, not white or blue?
- [ ] **Endpoint at top-right has a glow** accent?
- [ ] **No axis labels, numbers, or text** anywhere?
- [ ] **No candlestick bars** or "trading chart" literalism?
- [ ] **No warm colors**?
- [ ] **Feels atmospheric and confident**, not gimmicky or hypey?

If 7+/8 → ship it.
If 5-6/8 → iterate with a specific call-out ("make the curve emerald not blue" or "remove the numbers").
If <5 → regenerate, possibly emphasizing "no axis labels" and "abstract not stock-chart-literal" in the retry.

---

## 9. After you upload

Same workflow as pricing:

1. Save the final file as `hero-how-it-works.jpg` in your local repo at `public/assets/img/brand/`
2. Tell me **"uploaded hero-how-it-works.jpg"**
3. I'll:
   - Optimize it to match the size/quality sweet spot (~50-60 KB target)
   - Commit the optimized version
   - Build the new hero CSS that integrates the image with the same overlay technique as `hero-city.jpg` and `hero-pricing.jpg`
   - Add the decorative SVG shapes overlay
   - Ship the hero
   - Then proceed with the rest of the how-it-works page redesign

---

## 10. Naming consistency with other pages

Pattern established across the site:
- `hero-city.jpg` — homepage
- `hero-pricing.jpg` — pricing page
- **`hero-how-it-works.jpg`** ← this one
- `hero-faq.jpg` — future
- `hero-about.jpg` — future

Stick to `hero-{page-slug}.jpg` to keep the pattern clean.
