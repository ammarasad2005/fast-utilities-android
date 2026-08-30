#!/usr/bin/env python3
"""
Generate the per-widget-type launcher picker preview PNGs.

v2.1.0: families are color-coded (user decision — category color reflects in
the widget since the picker has no folders):
  timetable = blue glass   (@drawable/widget_bg)          [previews unchanged]
  exams     = amber/bronze (@drawable/widget_bg_exam)
  semester  = emerald/teal (@drawable/widget_bg_semester)

Surviving exam/semester previews (the Countdown/My Exams/Month/Timeline-4x4
widgets were removed): exam_next {standard,wide}, semester_countdown
{compact,standard}, semester_timeline {wide — journey rail design}.

Pixel sizes (contract): compact 330x330 · standard 540x330 · wide 720x330.

Run from the repo root:  python3 scripts/gen_widget_previews.py
Output: modules/widget-store/android/src/main/res/drawable-nodpi/
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = "modules/widget-store/android/src/main/res/drawable-nodpi"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# ── palette (renderer constants, themed) ────────────────────────────────────
WHITE = (255, 255, 255)
META = (185, 198, 216)        # #B9C6D8
SUB = (147, 165, 191)         # #93A5BF
AMBER = (255, 194, 75)        # #FFC24B   — exam accent
EMERALD = (110, 231, 183)     # #6EE7B7   — semester accent
EMERALD_DEEP = (16, 185, 129) # #10B981   — rail gradient start
SURFACE_T = (11, 46, 38)      # pin centers on teal bg

THEMES = {
    "exam":     {"top": (74, 50, 8),  "bottom": (26, 18, 3),  "edge": (255, 194, 75, 48), "accent": AMBER},
    "semester": {"top": (14, 70, 56), "bottom": (4, 31, 25),  "edge": (110, 231, 183, 48), "accent": EMERALD},
}

SIZES = {"compact": (330, 330), "standard": (540, 330), "wide": (720, 330)}


def font(path, size):
    return ImageFont.truetype(path, size)


def text_w(d, s, f):
    return d.textlength(s, font=f)


def canvas(size_key, theme_key, aa=3):
    """Supersampled rounded themed-glass card (mirrors the bg drawables)."""
    th = THEMES[theme_key]
    w, h = SIZES[size_key]
    img = Image.new("RGBA", (w * aa, h * aa), (0, 0, 0, 0))
    grad = Image.new("RGBA", (w * aa, h * aa))
    gd = ImageDraw.Draw(grad)
    # diagonal 315° look approximated with a vertical ramp + slight horizontal mix
    for y in range(h * aa):
        t = y / (h * aa - 1)
        r = int(th["top"][0] + (th["bottom"][0] - th["top"][0]) * t)
        g = int(th["top"][1] + (th["bottom"][1] - th["top"][1]) * t)
        b = int(th["top"][2] + (th["bottom"][2] - th["top"][2]) * t)
        gd.line([(0, y), (w * aa, y)], fill=(r, g, b, 242))
    radius = int(22 * 3.2 * aa / 3)
    mask = Image.new("L", (w * aa, h * aa), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, w * aa - 1, h * aa - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w * aa - 1, h * aa - 1], radius=radius, outline=th["edge"], width=max(2, aa))
    return img, d, aa


def finish(img, name, aa):
    w, h = img.size
    img = img.resize((w // aa, h // aa), Image.LANCZOS)
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    print(f"  {name}.png {w//aa}x{h//aa}")


def header(d, x, y, text, aa, accent):
    d.text((x, y), text, font=font(BOLD, 11 * aa), fill=accent)


# ── Exams · Next exam (amber family) ────────────────────────────────────────
def exam_next(size_key, name):
    img, d, aa = canvas(size_key, "exam")
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "NEXT EXAM", aa, AMBER)
    y = pad + 26 * aa
    d.text((pad, y), "Database Systems", font=font(BOLD, 17 * aa), fill=WHITE)
    d.text((pad, y + 25 * aa), "CS2001 · Multi-Purpose Hall", font=font(REG, 11 * aa), fill=META)
    d.text((pad, y + 48 * aa), "in 2d 4h", font=font(BOLD, 26 * aa), fill=AMBER)
    d.text((pad, y + 92 * aa), "Mon 12 Jan · 09:00 AM – 11:00 AM", font=font(REG, 10 * aa), fill=SUB)
    finish(img, name, aa)


# ── Semester · Next milestone (emerald family) ──────────────────────────────
def semester_countdown(size_key, name):
    img, d, aa = canvas(size_key, "semester")
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "SEMESTER", aa, EMERALD)
    y = pad + 26 * aa
    d.text((pad, y + 14 * aa), "21", font=font(BOLD, 56 * aa), fill=EMERALD)
    d.text((pad, y + 76 * aa), "days until", font=font(REG, 11 * aa), fill=META)
    y2 = y + 102 * aa
    d.text((pad, y2), "Final Examinations", font=font(BOLD, 15 * aa), fill=WHITE)
    d.text((pad, y2 + 22 * aa), "Mon 19 Jan", font=font(REG, 10 * aa), fill=SUB)
    finish(img, name, aa)


# ── Semester · Timeline — journey rail (emerald family) ─────────────────────
def semester_timeline(size_key, name):
    img, d, aa = canvas(size_key, "semester")
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))  # translucent strokes live here
    od = ImageDraw.Draw(ov)
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "SEMESTER TIMELINE", aa, EMERALD)
    hw = text_w(d, "SEMESTER TIMELINE", font(BOLD, 11 * aa))
    d.text((pad + hw + 8 * aa, pad - 4 * aa), "43%", font=font(BOLD, 11 * aa), fill=EMERALD)

    w, h = img.size
    margin = 52 * aa
    rail_y = int(h * 0.62)
    track_w = w - 2 * margin

    # glass track (12% white)
    od.line([(margin, rail_y), (w - margin, rail_y)], fill=(255, 255, 255, 31), width=10 * aa)

    # progress: halo + emerald gradient, to 43%
    px = int(margin + track_w * 0.43)
    od.line([(margin, rail_y), (px, rail_y)], fill=(110, 231, 183, 20), width=18 * aa)
    for x in range(margin, px):
        t = (x - margin) / max(1, px - margin)
        r = int(EMERALD_DEEP[0] + (EMERALD[0] - EMERALD_DEEP[0]) * t)
        g = int(EMERALD_DEEP[1] + (EMERALD[1] - EMERALD_DEEP[1]) * t)
        b = int(EMERALD_DEEP[2] + (EMERALD[2] - EMERALD_DEEP[2]) * t)
        od.line([(x, rail_y - 5 * aa), (x, rail_y + 5 * aa)], fill=(r, g, b, 255))
    od.ellipse([px - 5 * aa, rail_y - 5 * aa, px + 5 * aa, rail_y + 5 * aa], fill=EMERALD + (255,))

    # milestones: (label, pct, state) — lanes alternate above/below like the renderer
    ms = [("START", 0.0, "passed"), ("S1", 0.30, "passed"), ("S2", 0.62, "next"),
          ("FE", 0.86, "future"), ("END", 1.0, "future")]
    f_lbl = font(REG, 9 * aa)
    f_lbl_b = font(BOLD, 9 * aa)
    for i, (label, pct, state) in enumerate(ms):
        x = int(margin + track_w * pct)
        rdot = 9 * aa
        if state == "passed":
            od.ellipse([x - rdot, rail_y - rdot, x + rdot, rail_y + rdot], fill=EMERALD + (255,))
            r2 = 3.5 * aa
            od.ellipse([x - r2, rail_y - r2, x + r2, rail_y + r2], fill=SURFACE_T + (255,))
        else:
            od.ellipse([x - rdot, rail_y - rdot, x + rdot, rail_y + rdot], fill=SURFACE_T + (255,))
            ring = EMERALD if state == "next" else SUB
            od.ellipse([x - rdot, rail_y - rdot, x + rdot, rail_y + rdot], outline=ring + (255,), width=3 * aa)
            if state == "next":
                rr = 14.5 * aa
                od.ellipse([x - rr, rail_y - rr, x + rr, rail_y + rr], outline=(110, 231, 183, 85), width=2 * aa)
        f = f_lbl_b if state == "next" else f_lbl
        col = WHITE if state == "next" else META
        tw = text_w(d, label, f)
        lx = min(max(x, 6 * aa + tw / 2), w - 6 * aa - tw / 2)
        ly = rail_y - 34 * aa if i % 2 == 0 else rail_y + 20 * aa
        d.text((lx - tw / 2, ly), label, font=f, fill=col)

    # TODAY: pill + stem + glowing node
    pill = "DAY 43"
    f_pill = font(BOLD, 10 * aa)
    pw = text_w(d, pill, f_pill) + 22 * aa
    ph = 24 * aa
    pcx = min(max(px, margin - 14 * aa + pw / 2), w - margin + 14 * aa - pw / 2)
    od.rounded_rectangle([pcx - pw / 2, 26 * aa, pcx + pw / 2, 26 * aa + ph],
                         radius=ph / 2, fill=(110, 231, 183, 46), outline=(110, 231, 183, 153), width=2 * aa)
    d.text((pcx - text_w(d, pill, f_pill) / 2, 26 * aa + ph / 2 - 5.6 * aa), pill, font=f_pill, fill=EMERALD)
    od.line([(px, 26 * aa + ph + 2 * aa), (px, rail_y - 12 * aa)], fill=(255, 255, 255, 64), width=2 * aa)
    for rr, alpha in ((18, 34), (12, 68)):
        od.ellipse([px - rr * aa, rail_y - rr * aa, px + rr * aa, rail_y + rr * aa],
                   fill=(255, 255, 255, alpha))
    od.ellipse([px - 8 * aa, rail_y - 8 * aa, px + 8 * aa, rail_y + 8 * aa], fill=WHITE + (255,))
    ri = 4.5 * aa
    od.ellipse([px - ri, rail_y - ri, px + ri, rail_y + ri], fill=EMERALD + (255,))

    out = Image.alpha_composite(img, ov)
    d2 = ImageDraw.Draw(out)
    d2.text((pad, h - 30 * aa), "Day 43 of 112 · Fall 2025", font=font(REG, 11 * aa), fill=META)
    finish(out, name, aa)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    exam_next("standard", "widget_preview_exam_next_standard")
    exam_next("wide", "widget_preview_exam_next_wide")
    semester_countdown("compact", "widget_preview_semester_countdown_compact")
    semester_countdown("standard", "widget_preview_semester_countdown_standard")
    semester_timeline("wide", "widget_preview_semester_timeline_wide")
    print("done — 5 previews (exam amber ×2, semester emerald ×3)")
