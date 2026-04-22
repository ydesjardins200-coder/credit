# Creatify Brief — iBoost Pricing Hero Background

**Target file**: `public/assets/img/brand/hero-pricing.jpg`  
**Purpose**: Background image for the `<main>` hero of `/pricing.html`  
**Date created**: 2026-04-22  
**For**: Yan

---

## 1. Technical specs

| Spec | Value | Why |
|------|-------|-----|
| **Dimensions** | `1920 × 720 px` minimum | Wide format to cover desktop hero; excess will be cropped `center bottom` |
| **Aspect ratio** | ~`8:3` (or 16:6 if Creatify restricts) | Matches the hero container |
| **Format** | `.jpg` | Photographic/gradient content, smaller than PNG |
| **File size target** | `< 50 KB` | Loads fast; current `hero-city.jpg` is 25 KB |
| **Compression** | `quality 75-80%` | Image is heavily overlaid anyway (details smooth out) |
| **Color profile** | `sRGB` | Web standard; don't upload Adobe RGB or P3 |

**Important**: The image will be rendered with:
- **~75-80% dark navy overlay** → only the BOLD shapes, strong highlights, and biggest contrasts will be visible
- **center bottom / cover** positioning → the BOTTOM of the image matters most; the TOP will often be cropped on widescreen
- **Radial gradient overlays** (emerald bottom-right, cyan top-left) will tint certain areas

**Rule of thumb**: if you can see the image detail clearly on your screen → it'll be **barely visible** on the site. If you can BARELY see the detail → it'll be invisible. Make it **stronger than feels right**.

---

## 2. Creative direction

### Theme
**Pricing & plans = transparent architectural blueprint**

The page sells 3 subscription tiers (Free / $15 / $30). The visual metaphor is "building your credit as a construction project — we show you the blueprints, nothing is hidden". Pricing that you can actually understand.

### Style keywords
`architectural blueprint` · `engineering schematic` · `technical drawing` · `wireframe buildings` · `modernist structure` · `navy + emerald`

### Style keywords to AVOID
`cityscape photograph` (we already have that on homepage) · `neon cyberpunk` · `futuristic sci-fi` · `3D render with dramatic lighting` · `people` · `hands holding phones` · `money/cash imagery` · `credit card mockups` · `warm colors`

---

## 3. Composition requirements

**Layout** (see ASCII sketch below):

```
  ┌────────────────────────────────────────────────┐
  │                                                │
  │              [ EMPTY — TEXT GOES HERE ]        │  ← top 40-50%:
  │                                                │    minimal content,
  │                                                │    faint grid only
  │                                                │
  ├────────────────────────────────────────────────┤
  │                                                │
  │   ▓▓  ▓▓▓▓  ▓▓▓      ▓▓▓▓   ▓▓  ▓▓▓▓▓  ▓▓      │  ← bottom 40-50%:
  │   ██  ████  ███▓▓▓▓▓▓████   ██  █████  ██      │    architectural
  │   ██  ████  ██████████████  ██  █████  ██      │    content (skyline,
  └────────────────────────────────────────────────┘    platforms, structures)
          ↑                            ↑
        faint glow                   emerald glow
        (top-left)                   (bottom-right)
```

**Key zones**:
- **Top 40-50%** (where the H1 copy sits): should be MOSTLY EMPTY or have only very subtle elements (faint grid lines, a few scattered glowing dots). **Do not put buildings, text, or high-contrast elements here.**
- **Bottom 40-50%**: this is where the visual anchor lives. Architectural/structural content goes here.
- **Right side**: should have an emerald-toned glow or highlight (the CSS radial gradient will sit there)
- **Left side**: can be slightly denser or darker (the CSS cyan accent is subtle)

---

## 4. Color palette (hard rules)

| Role | Hex | Usage |
|------|-----|-------|
| Primary dark (base) | `#0A2540` | Main background, ~60% of surface |
| Secondary dark | `#0f2e4d` | Subtle variations, gradients |
| Deep shadow | `#041426` | Bottom vignette, shadows |
| Emerald accent | `#2ECC71` | ALL structural elements, lines, highlights |
| Light emerald | `#6ee7a8` | Subtle highlights, glows |
| Cyan accent (sparse) | `#06b6d4` | Rare secondary accent, 1-2 places max |
| Pure white | `#FFFFFF` | Avoid — reserved for text only |

**Rules**:
- **NO warm colors** (no orange, no pink, no red, no amber, no yellow). This is non-negotiable.
- **NO bright/saturated colors** other than emerald. Everything should feel measured and professional.
- **Building outlines / structural lines = emerald** (not white). This is crucial — white lines will blow out under the overlay.
- Saturation of emerald should be **HIGH** (so it survives the overlay). Don't use desaturated teal or sage green.

---

## 5. Content direction — what to draw

### Primary subject: Abstract architectural skyline

Think: "What if you drew a city skyline but made it look like an architect's technical drawing instead of a photo"

**Elements to include** (pick 3-5, don't cram all of them):

1. **5-9 geometric building outlines** (wireframe style)
   - Varied heights, widths, and positions
   - Thin emerald lines (1-2px equivalent)
   - Internal horizontal lines suggesting floors (dashed is good)
   - Can overlap/interweave at different depths
   - Bottom of buildings should align along an implied ground line

2. **Fine background grid**
   - Very subtle, rgba emerald 0.06-0.10 alpha
   - Consistent spacing (~40-60px equivalent)
   - Optional: a slightly bolder grid every 4-5 cells
   - Should look like graph paper, not neon grid

3. **Technical annotations** (optional, OK if sparse)
   - Small dashed rectangles with tiny text inside ("scale 1:1", "v2.0", or small dimension numbers like "50'" or "∅30")
   - Only 1-3 across the whole canvas
   - Monospace-looking text, low opacity
   - Keep away from the text zone

4. **Scattered "stars" or glowing dots**
   - Similar to the homepage hero stars
   - 5-15 small dots scattered in the upper 50%
   - Emerald or cyan, 0.3-0.5 alpha
   - Some can be slightly larger (2-3px) for depth

5. **Connecting/reference lines**
   - Dashed lines (emerald, low opacity) connecting elements
   - Like annotation callouts from a construction blueprint

### What NOT to include

- ❌ Real photographic buildings or cityscapes
- ❌ People, faces, hands, bodies
- ❌ Credit card imagery, dollar signs prominent in foreground
- ❌ Fintech clichés (arrows going up, graphs, cash, piggy banks)
- ❌ Gradient mesh blobs (we already have those in the CSS)
- ❌ Lens flares, light beams, bokeh
- ❌ Text in English or any language that's readable without zooming (it will clash with the H1)

---

## 6. Mood references

Think of the aesthetic of:

- **Linear app** marketing pages → clean, measured, subtle structure
- **Stripe** homepage background abstractions → minimal, confident
- **Mercury Bank** hero treatments → navy, precise, professional
- **Apple keynote slides** about Vision Pro → dark, structural, calm
- **Notion architect/engineer templates** → grids, plans, technical

**DO NOT look at**:
- Crypto / DeFi marketing (too neon, too loud)
- Traditional banks (too stiff, too stock-looking)
- Fintech apps like Robinhood / Coinbase (too bright, gamified)

---

## 7. Quick Creatify prompt to paste

Copy this into Creatify as a starting prompt — adjust from there:

> Abstract architectural blueprint background, wide 16:6 format, dark navy base color (#0A2540), with emerald green (#2ECC71) wireframe skyline of modernist buildings at the bottom third of the image. Fine technical grid lines across the full canvas like graph paper, very subtle low opacity. A few faint glowing dots scattered in the upper area. Top half mostly empty to leave room for title text overlay. Soft emerald glow in the bottom-right corner. Professional engineering schematic aesthetic, like a cross between a city planning blueprint and a modern fintech marketing page. Minimal, measured, confident. No people, no photographs, no warm colors, no cyberpunk neon. Style references: Linear app, Stripe homepage, Mercury bank.

---

## 8. Iteration checklist

When Creatify gives you options, evaluate them against:

- [ ] **Top 40% is empty-ish**? (Can I comfortably put a big H1 there?)
- [ ] **Bottom 40% has structural content**? (Buildings, platforms, or similar?)
- [ ] **Emerald green clearly visible**? (Will it survive the 75% dark overlay?)
- [ ] **No warm colors anywhere**? (No orange, no pink, no yellow?)
- [ ] **Feels like a blueprint**, not a photo? (Technical/schematic, not realistic?)
- [ ] **No distracting focal point**? (Eye should not lock onto one specific spot)
- [ ] **Right side has an emerald glow**? (Matches the CSS radial gradient)
- [ ] **Under 50KB after compression**?

If 7+/8 → ship it. If 5-6/8 → iterate. If <5 → regenerate with different prompt.

---

## 9. After you upload

1. Save the final file as `hero-pricing.jpg` in `public/assets/img/brand/`
2. Tell me "uploaded hero-pricing.jpg"
3. I'll:
   - Integrate it into `pricing.html` with the same CSS overlay technique as `hero-city.jpg`
   - Tune the overlay alpha if the image is too strong/weak
   - Add the SVG grid + geometric shapes on top
   - Show you the result
   - Iterate on the overlay levels if needed
