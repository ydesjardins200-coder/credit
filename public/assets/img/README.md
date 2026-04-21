# Images

All image assets for iBoost live here. Served by Netlify at `/assets/img/...`.

## Folder structure

Feel free to create subfolders as the library grows. Suggested layout:

```
img/
├── brand/          # Logo variants, favicons, brand marks
├── hero/           # Landing page hero images
├── features/       # Feature section icons and illustrations
├── testimonials/   # Customer photos and avatars
├── og/             # Open Graph / social sharing images
└── icons/          # Custom UI icons (prefer lucide/heroicons inline where possible)
```

## How to use in HTML

```html
<img src="/assets/img/hero/rebuild.webp" alt="Descriptive alt text" width="800" height="600" />
```

Always use absolute paths (starting with `/`) so images resolve correctly regardless of the page they're used on.

## Naming conventions

- **All lowercase**, words separated by hyphens: `credit-score-chart.webp`, not `CreditScoreChart.png`
- **Descriptive, not contextual**: `woman-reviewing-laptop.webp` rather than `hero-image-1.webp`
- **Include size in name if multiple sizes exist**: `logo-48.png`, `logo-192.png`, `logo-512.png`

## Format recommendations

| Use case | Format | Why |
|---|---|---|
| Photos | **WebP** (fallback JPG) | 25-35% smaller than JPG at same quality |
| Illustrations / graphics | **SVG** | Crisp at any size, tiny file size |
| Screenshots with sharp edges | **PNG** or WebP | Lossless for UI screenshots |
| Logos | **SVG** | Scalable, crisp, theme-friendly |
| Favicons | **ICO** + **PNG** | Legacy browser support |

## Optimization rules

- Compress all raster images before committing. Tools: [Squoosh](https://squoosh.app), [TinyPNG](https://tinypng.com)
- **Target sizes**:
  - Hero images: under 200 KB
  - Section illustrations: under 80 KB
  - Avatars / small icons: under 15 KB
- Export at 2x the displayed size (for retina/HiDPI screens), then let the browser downscale via `width`/`height` attributes
- Always include `width` and `height` attributes in `<img>` tags to prevent layout shift (CLS)
- Always include meaningful `alt` text — if decorative, use `alt=""`

## What NOT to put here

- Stock photos you don't have the rights to. Use [Unsplash](https://unsplash.com), [Pexels](https://pexels.com), or [Pixabay](https://pixabay.com) for free, license-safe images
- Copyrighted characters, logos of other companies (except with explicit permission for partner/integration pages)
- Uncompressed originals — optimize before committing
- Files over 1 MB (unless there's a very good reason, e.g., high-res hero for retina displays)
