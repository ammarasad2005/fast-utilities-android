#!/usr/bin/env python3
"""
Generate the per-widget-type launcher picker preview PNGs.

These mirror the widget layouts + navy-glass surface exactly (same palette as
WidgetRenderer/ExamWidgetRenderer/SemesterWidgetRenderer and widget_bg.xml),
at the same pixel sizes the original preview set used:
  compact 330x330 · standard 540x330 · wide 720x330 · large 660x660

Output: modules/widget-store/android/src/main/res/drawable-nodpi/
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = "modules/widget-store/android/src/main/res/drawable-nodpi"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# ── palette (widget_bg + renderer constants) ────────────────────────────────
BG_TOP = (20, 50, 96)      # #143260
BG_BOTTOM = (7, 27, 56)    # #071B38
EDGE = (255, 255, 255, 56) # ~#38FFFFFF
AMBER = (255, 194, 75)     # #FFC24B
WHITE = (255, 255, 255)
META = (185, 198, 216)     # #B9C6D8
BRAND = (169, 204, 255)    # #A9CCFF
EMERALD = (110, 231, 183)  # #6EE7B7
SUB = (147, 165, 191)      # #93A5BF
TRACK = (51, 65, 92)       # #33415C

SIZES = {"compact": (330, 330), "standard": (540, 330), "wide": (720, 330), "large": (660, 660)}


def font(path, size):
    return ImageFont.truetype(path, size)


def canvas(size_key, aa=3):
    """Supersampled rounded navy-gradient card."""
    w, h = SIZES[size_key]
    img = Image.new("RGBA", (w * aa, h * aa), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # vertical navy gradient inside a rounded rect
    grad = Image.new("RGBA", (w * aa, h * aa))
    gd = ImageDraw.Draw(grad)
    for y in range(h * aa):
        t = y / (h * aa - 1)
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        gd.line([(0, y), (w * aa, y)], fill=(r, g, b, 242))
    radius = int(22 * 3.2 * aa / 3)
    # mask
    mask = Image.new("L", (w * aa, h * aa), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, w * aa - 1, h * aa - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w * aa - 1, h * aa - 1], radius=radius, outline=EDGE, width=max(2, aa))
    return img, d, aa


def finish(img, name, aa):
    w, h = img.size
    img = img.resize((w // aa, h // aa), Image.LANCZOS)
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    print(f"  {name}.png {w//aa}x{h//aa}")


def header(d, x, y, text, aa):
    d.text((x, y), text, font=font(BOLD, 11 * aa), fill=AMBER)


# ── Exams · Countdown ───────────────────────────────────────────────────────
def exam_countdown(size_key, name):
    img, d, aa = canvas(size_key)
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "EXAM COUNTDOWN", aa)
    w, _ = img.size
    y = pad + 26 * aa
    d.text((pad, y + 14 * aa), "12", font=font(BOLD, 56 * aa), fill=BRAND)
    d.text((pad, y + 76 * aa), "days left", font=font(REG, 11 * aa), fill=META)
    y2 = y + 102 * aa
    d.text((pad, y2), "Database Systems", font=font(BOLD, 15 * aa), fill=WHITE)
    d.text((pad, y2 + 22 * aa), "Mon 12 Jan · 09:00 AM – 11:00 AM", font=font(REG, 10 * aa), fill=SUB)
    finish(img, name, aa)


# ── Exams · Next exam ───────────────────────────────────────────────────────
def exam_next(size_key, name):
    img, d, aa = canvas(size_key)
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "NEXT EXAM", aa)
    y = pad + 26 * aa
    d.text((pad, y), "Database Systems", font=font(BOLD, 17 * aa), fill=WHITE)
    d.text((pad, y + 25 * aa), "CS2001 · Multi-Purpose Hall", font=font(REG, 11 * aa), fill=META)
    d.text((pad, y + 48 * aa), "in 2d 4h", font=font(BOLD, 26 * aa), fill=BRAND)
    d.text((pad, y + 92 * aa), "Mon 12 Jan · 09:00 AM – 11:00 AM", font=font(REG, 10 * aa), fill=SUB)
    finish(img, name, aa)


# ── Exams · My exams ────────────────────────────────────────────────────────
def exam_list(size_key, name):
    img, d, aa = canvas(size_key)
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "MY EXAMS", aa)
    y = pad + 24 * aa
    d.text((pad, y), "Next: Database Systems · Mon 12 Jan", font=font(BOLD, 13 * aa), fill=BRAND)
    rows = [
        ("Mon 12 Jan · CS2001 — Database Systems", True),
        ("Wed 14 Jan · MA1002 — Calculus II", False),
        ("Fri 16 Jan · CS1005 — Discrete Structures", False),
        ("Mon 19 Jan · EE2003 — Digital Logic Design", False),
        ("Wed 21 Jan · HU1001 — English Composition", False),
    ]
    if size_key == "wide":
        rows = rows[:3]
    yy = y + 26 * aa
    for text, first in rows:
        d.text((pad, yy), text, font=font(BOLD if first else REG, 11 * aa),
               fill=WHITE if first else META)
        yy += 21 * aa
    if size_key == "large":
        d.text((pad, yy), "+2 more", font=font(REG, 10 * aa), fill=SUB)
    finish(img, name, aa)


# ── Semester · Next milestone ───────────────────────────────────────────────
def semester_countdown(size_key, name):
    img, d, aa = canvas(size_key)
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "SEMESTER", aa)
    y = pad + 26 * aa
    d.text((pad, y + 14 * aa), "21", font=font(BOLD, 56 * aa), fill=BRAND)
    d.text((pad, y + 76 * aa), "days until", font=font(REG, 11 * aa), fill=META)
    y2 = y + 102 * aa
    d.text((pad, y2), "Final Examinations", font=font(BOLD, 15 * aa), fill=WHITE)
    d.text((pad, y2 + 22 * aa), "Mon 19 Jan", font=font(REG, 10 * aa), fill=SUB)
    finish(img, name, aa)


# ── Semester · Timeline ─────────────────────────────────────────────────────
def semester_timeline(size_key, name):
    img, d, aa = canvas(size_key)
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "SEMESTER TIMELINE", aa)
    d.text((pad + 138 * aa, pad - 4 * aa), "43%", font=font(BOLD, 11 * aa), fill=BRAND)

    w, h = img.size
    margin = 52 * aa
    mid_y = int(h * 0.55)
    track_w = w - 2 * margin

    # track + progress
    d.line([(margin, mid_y), (w - margin, mid_y)], fill=TRACK, width=8 * aa)
    prog_x = int(margin + track_w * 0.43)
    d.line([(margin, mid_y), (prog_x, mid_y)], fill=BRAND, width=8 * aa)

    # milestones: (label, pct, passed?)
    ms = [("START", 0.0, True), ("S1", 0.30, True), ("S2", 0.62, False), ("FE", 0.86, False), ("END", 1.0, False)]
    big = size_key == "large"
    r = 9 * aa if not big else 10 * aa
    for label, pct, passed in ms:
        x = int(margin + track_w * pct)
        if passed:
            d.ellipse([x - r, mid_y - r, x + r, mid_y + r], fill=EMERALD)
        else:
            d.ellipse([x - r, mid_y - r, x + r, mid_y + r], outline=AMBER, width=3 * aa)
        lx = x
        if pct >= 1.0:
            lx = x - 26 * aa
        elif pct <= 0.0:
            lx = x + 6 * aa
        d.text((lx - 12 * aa, mid_y + r + 8 * aa), label, font=font(REG, 9 * aa), fill=META)

    # TODAY marker at 43%
    tr = 13 * aa if not big else 15 * aa
    d.ellipse([prog_x - tr, mid_y - tr, prog_x + tr, mid_y + tr], fill=WHITE)
    tr2 = 7 * aa
    d.ellipse([prog_x - tr2, mid_y - tr2, prog_x + tr2, mid_y + tr2], fill=BRAND)
    d.text((prog_x - 17 * aa, mid_y - tr - 20 * aa), "TODAY", font=font(BOLD, 8 * aa), fill=WHITE)

    d.text((pad, h - 30 * aa), "Day 43 of 112 · Fall 2025", font=font(REG, 11 * aa), fill=META)
    finish(img, name, aa)


# ── Semester · Month ────────────────────────────────────────────────────────
def semester_month(name):
    img, d, aa = canvas("large")
    pad = 24 * aa
    header(d, pad, pad - 4 * aa, "JANUARY 2026", aa)

    w, h = img.size
    top = pad + 26 * aa
    cell_w = (w - 2 * pad) / 7
    weekdays = ["M", "T", "W", "T", "F", "S", "S"]
    for i, wd in enumerate(weekdays):
        cx = pad + cell_w * i + cell_w / 2
        d.text((cx - 5 * aa, top), wd, font=font(REG, 10 * aa), fill=SUB)

    # Jan 2026: 1st is Thursday → Monday-first column index 3
    first_col = 3
    days = 31
    grid_top = top + 22 * aa
    rows = 5
    cell_h = (h - grid_top - 30 * aa) / rows
    exam_days = {12, 14, 16, 19, 21}
    today = 15

    for day in range(1, days + 1):
        idx = first_col + day - 1
        col = idx % 7
        row = idx // 7
        cx = pad + cell_w * col + cell_w / 2
        cy = grid_top + cell_h * row + cell_h / 2
        if day == today:
            r = min(cell_w, cell_h) * 0.34
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BRAND)
            num_font = font(BOLD, 10 * aa)
            d.text((cx - (5.5 if day > 9 else 3.2) * aa, cy - 7.5 * aa), str(day), font=num_font, fill=WHITE)
        else:
            d.text((cx - (5.5 if day > 9 else 3.2) * aa, cy - 7.5 * aa), str(day),
                   font=font(REG, 10 * aa), fill=META)
        if day in exam_days:
            dr = 4.5 * aa
            d.ellipse([cx - dr, cy + cell_h * 0.22, cx + dr, cy + cell_h * 0.22 + 2 * dr], fill=AMBER)

    d.text((pad, h - 28 * aa), "● exam day   ◉ today", font=font(REG, 10 * aa), fill=SUB)
    finish(img, name, aa)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    exam_countdown("compact", "widget_preview_exam_countdown_compact")
    exam_countdown("standard", "widget_preview_exam_countdown_standard")
    exam_next("standard", "widget_preview_exam_next_standard")
    exam_next("wide", "widget_preview_exam_next_wide")
    exam_list("wide", "widget_preview_exam_list_wide")
    exam_list("large", "widget_preview_exam_list_large")
    semester_countdown("compact", "widget_preview_semester_countdown_compact")
    semester_countdown("standard", "widget_preview_semester_countdown_standard")
    semester_timeline("wide", "widget_preview_semester_timeline_wide")
    semester_timeline("large", "widget_preview_semester_timeline_large")
    semester_month("widget_preview_semester_month_large")
    print("done")
