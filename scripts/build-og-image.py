#!/usr/bin/env python3
"""
Generate the iBoost Open Graph / social preview image.

Output: public/assets/img/brand/og-home.png (1200×630 PNG)

Matches the home-page hero visual language:
  - Navy gradient background (#0A2540 diagonal to #0e2d4d / #041426)
  - Emerald glow bottom-left + subtle blue glow top-right
  - iBoost shield logo + wordmark top-left
  - Main headline "Build the credit that opens doors." with "opens
    doors" in the emerald gradient treatment
  - Trust line + URL bottom-left

Why hand-rolled instead of a screenshot:
  - No browser available in this environment
  - A real screenshot would include header nav, floating satellite
    cards, hub animations — too busy for a 1200×630 crop
  - This is purpose-built for social unfurls: big text, high contrast,
    readable at thumbnail size on mobile
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, sys

# ---------- Config ----------

W, H = 1200, 630
OUT_DIR = "public/assets/img/brand"
OUT_PATH = os.path.join(OUT_DIR, "og-home.png")

# Brand palette (mirrors main.css .hero-dark and related vars).
NAVY_TOP    = (14, 45, 77)      # #0e2d4d — gradient lighter edge
NAVY_MID    = (10, 37, 64)      # #0A2540 — canonical brand navy
NAVY_DEEP   = (4, 20, 38)       # #041426 — gradient deep edge

EMERALD     = (46, 204, 113)    # #2ECC71 — accent
EMERALD_L   = (110, 231, 168)   # #6ee7a8 — accent dark/light shift
WHITE       = (255, 255, 255)
WHITE_SOFT  = (230, 236, 243)   # for lead text
WHITE_MUTE  = (160, 178, 199)   # for trust line / minor copy
BLUE_GLOW   = (56, 189, 248)    # sky-400, used sparingly

FONT_DIR = "/usr/share/fonts/truetype/google-fonts"
def F(weight, size):
    """Load Poppins at given weight + size."""
    return ImageFont.truetype(os.path.join(FONT_DIR, f"Poppins-{weight}.ttf"), size)

# ---------- Helpers ----------

def gradient_bg(im):
    """Diagonal three-stop navy gradient filling the whole canvas.
    Top-left lighter navy, mid brand navy, bottom-right deep navy.
    Done per-pixel on a shrunken copy then upscaled — 8x faster than
    full-resolution per-pixel computation and the softness is indis-
    tinguishable at the OG image scale."""
    small = Image.new("RGB", (W // 4, H // 4))
    px = small.load()
    sw, sh = small.size
    diag_max = (sw ** 2 + sh ** 2) ** 0.5
    for y in range(sh):
        for x in range(sw):
            # t = 0 at top-left, 1 at bottom-right (normalized diagonal)
            t = ((x ** 2 + y ** 2) ** 0.5) / diag_max
            if t < 0.5:
                # First half: NAVY_TOP -> NAVY_MID
                k = t * 2
                r = int(NAVY_TOP[0] + (NAVY_MID[0] - NAVY_TOP[0]) * k)
                g = int(NAVY_TOP[1] + (NAVY_MID[1] - NAVY_TOP[1]) * k)
                b = int(NAVY_TOP[2] + (NAVY_MID[2] - NAVY_TOP[2]) * k)
            else:
                # Second half: NAVY_MID -> NAVY_DEEP
                k = (t - 0.5) * 2
                r = int(NAVY_MID[0] + (NAVY_DEEP[0] - NAVY_MID[0]) * k)
                g = int(NAVY_MID[1] + (NAVY_DEEP[1] - NAVY_MID[1]) * k)
                b = int(NAVY_MID[2] + (NAVY_DEEP[2] - NAVY_MID[2]) * k)
            px[x, y] = (r, g, b)
    im.paste(small.resize((W, H), Image.BICUBIC))


def radial_glow(im, cx, cy, radius, color, intensity=0.35):
    """Paint a soft radial glow at (cx, cy). Used for the emerald
    bottom-left and subtle blue top-right atmospheric accents.
    Renders on a separate RGBA layer and alpha-composites so we don't
    have to hand-blend per pixel against the gradient."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    # Concentric circles, each slightly more opaque toward center,
    # gives a smooth-ish gradient after Gaussian blur.
    steps = 24
    for i in range(steps, 0, -1):
        r = int(radius * (i / steps))
        alpha = int(255 * intensity * (1 - (i / steps)))
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=(color[0], color[1], color[2], alpha),
        )
    layer = layer.filter(ImageFilter.GaussianBlur(radius=radius // 6))
    im.paste(layer, (0, 0), layer)


def draw_text_with_gradient(im, text, pos, font, color_from, color_to):
    """Draw `text` at `pos` in a left-to-right horizontal gradient.
    Used for 'opens doors' in the headline — matches the
    .hero-headline-gradient treatment on the live site.

    Technique: build a text-sized canvas with the text drawn at (0, 0),
    fill a horizontal gradient rectangle of the same size, then paste
    the gradient through the text-as-mask onto the main image at `pos`.
    """
    # Measure from a throwaway draw context so we don't perturb anything.
    tmp = Image.new("L", (1, 1))
    tmp_draw = ImageDraw.Draw(tmp)
    bbox = tmp_draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Add padding so descenders/ascenders don't clip.
    pad_x, pad_y = 6, 8
    cw, ch = tw + pad_x * 2, th + pad_y * 2

    # Text as an alpha mask at local (pad_x - bbox[0], pad_y - bbox[1]).
    # bbox[0] / bbox[1] are the native origin offsets; subtracting them
    # places the text flush with the padding corner.
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).text(
        (pad_x - bbox[0], pad_y - bbox[1]),
        text, font=font, fill=255,
    )

    # Horizontal gradient across the full canvas width.
    grad = Image.new("RGB", (cw, ch))
    gpx = grad.load()
    for x in range(cw):
        k = x / max(1, cw - 1)
        r = int(color_from[0] + (color_to[0] - color_from[0]) * k)
        g = int(color_from[1] + (color_to[1] - color_from[1]) * k)
        b = int(color_from[2] + (color_to[2] - color_from[2]) * k)
        for y in range(ch):
            gpx[x, y] = (r, g, b)

    # Paste using mask; position so the visible glyphs land at `pos`.
    im.paste(grad, (pos[0] - pad_x, pos[1] - pad_y), mask)


# ---------- Main compose ----------

def build():
    im = Image.new("RGB", (W, H), NAVY_MID)
    gradient_bg(im)

    # Atmospheric glows (before any text so text sits on top)
    radial_glow(im, cx=-80, cy=H + 80, radius=500, color=EMERALD, intensity=0.35)
    radial_glow(im, cx=W + 60, cy=-60, radius=420, color=BLUE_GLOW, intensity=0.18)

    draw = ImageDraw.Draw(im)

    # Subtle star dots (matches .hero-stars on the live page).
    # Hand-placed for balanced composition — spread across the canvas
    # but avoiding the center where the headline will sit.
    stars = [
        # (x, y, radius, alpha)
        (120, 80, 2, 90),
        (280, 120, 1, 60),
        (440, 90, 2, 100),
        (1000, 100, 2, 90),
        (1100, 180, 1, 60),
        (60, 280, 2, 80),
        (1120, 310, 2, 80),
        (100, 530, 1, 60),
        (1050, 550, 2, 100),
        (1140, 590, 1, 60),
    ]
    star_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(star_layer)
    for x, y, r, a in stars:
        sd.ellipse([x - r, y - r, x + r, y + r],
                   fill=(EMERALD[0], EMERALD[1], EMERALD[2], a))
    im.paste(star_layer, (0, 0), star_layer)

    # ---------- TOP-LEFT: logo + wordmark ----------
    # Shield mark — scaled from shield-192.png which has transparency.
    shield_path = os.path.join(OUT_DIR, "shield-192.png")
    if os.path.exists(shield_path):
        shield = Image.open(shield_path).convert("RGBA")
        target_h = 56
        ratio = target_h / shield.height
        shield = shield.resize((int(shield.width * ratio), target_h), Image.LANCZOS)
        im.paste(shield, (64, 56), shield)
        logo_x_end = 64 + shield.width + 14
    else:
        # Fallback: no shield available, draw a simple emerald circle
        draw.ellipse([64, 56, 120, 112], fill=EMERALD)
        logo_x_end = 134

    # Wordmark "iBoost"
    brand_font = F("Bold", 40)
    draw.text((logo_x_end, 65), "iBoost", font=brand_font, fill=WHITE)

    # Small tagline pill to the right of wordmark
    tagline = "Credit building for Canada & U.S."
    tagline_font = F("Medium", 15)
    tbbox = draw.textbbox((0, 0), tagline, font=tagline_font)
    tw = tbbox[2] - tbbox[0]
    pill_x = logo_x_end + 140
    pill_y = 76
    pill_h = 28

    # Pill internal layout: [left pad] [dot] [gap] [text] [right pad]
    pad_l = 12
    dot_r = 3
    gap = 8
    pad_r = 14
    pill_w = pad_l + dot_r * 2 + gap + tw + pad_r

    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        radius=pill_h // 2,
        fill=(46, 204, 113, 40),
        outline=(46, 204, 113, 120),
        width=1,
    )
    # Emerald dot
    dot_cx = pill_x + pad_l + dot_r
    dot_cy = pill_y + pill_h // 2
    draw.ellipse(
        [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
        fill=EMERALD,
    )
    # Tagline text — vertical-center via a measured offset
    text_y = pill_y + (pill_h - (tbbox[3] - tbbox[1])) // 2 - tbbox[1]
    draw.text(
        (pill_x + pad_l + dot_r * 2 + gap, text_y),
        tagline, font=tagline_font, fill=(180, 230, 200),
    )

    # ---------- CENTER: headline ----------
    # Two-line composition:
    #   Line 1: "Build the credit that"   (white)
    #   Line 2: "opens doors."             (emerald gradient)
    headline_font = F("Bold", 72)
    line1 = "Build the credit that"
    line2 = "opens doors."

    # Vertical centering baseline — we want the two lines clustered
    # a bit above vertical center since the trust line sits below.
    center_y = 260

    # Line 1 — measure then center horizontally
    bb1 = draw.textbbox((0, 0), line1, font=headline_font)
    w1 = bb1[2] - bb1[0]
    x1 = (W - w1) // 2
    draw.text((x1, center_y), line1, font=headline_font, fill=WHITE)

    # Line 2 — with gradient treatment (emerald -> lighter emerald)
    bb2 = draw.textbbox((0, 0), line2, font=headline_font)
    w2 = bb2[2] - bb2[0]
    h2 = bb2[3] - bb2[1]
    x2 = (W - w2) // 2
    y2 = center_y + 88  # tight line-height
    draw_text_with_gradient(im, line2, (x2, y2),
                            headline_font, EMERALD, EMERALD_L)

    # ---------- BELOW HEADLINE: lead copy ----------
    lead_font = F("Medium", 22)
    lead = "Report on-time payments to all 3 bureaus · Track your score · Get guidance"
    bb3 = draw.textbbox((0, 0), lead, font=lead_font)
    w3 = bb3[2] - bb3[0]
    x3 = (W - w3) // 2
    draw.text((x3, y2 + h2 + 38), lead, font=lead_font, fill=WHITE_SOFT)

    # ---------- BOTTOM STRIP: trust + URL ----------
    trust_font = F("Medium", 18)
    trust = "Free plan available  ·  No contract  ·  Cancel in 2 clicks"
    bb4 = draw.textbbox((0, 0), trust, font=trust_font)
    w4 = bb4[2] - bb4[0]
    x4 = (W - w4) // 2
    draw.text((x4, H - 90), trust, font=trust_font, fill=WHITE_MUTE)

    # URL banner — very small, bottom-center
    url_font = F("Bold", 16)
    url = "iboostcredit.netlify.app"
    bb5 = draw.textbbox((0, 0), url, font=url_font)
    w5 = bb5[2] - bb5[0]
    x5 = (W - w5) // 2
    draw.text((x5, H - 52), url, font=url_font, fill=EMERALD)

    # ---------- Save ----------
    os.makedirs(OUT_DIR, exist_ok=True)
    im.save(OUT_PATH, "PNG", optimize=True)
    print(f"Wrote {OUT_PATH} ({os.path.getsize(OUT_PATH) // 1024} KB)")


if __name__ == "__main__":
    build()
