"""Frame renderer: timeline -> raw RGB frames -> ffmpeg (H.264 + AAC).

Layout (1920x1080): header with the pipeline stepper and clock, a terminal window driven by a
small VT emulator (SGR colours, \\r, \\n, CSI J/H/K, wrapping, scrolling), and a caption strip
synced to each voiceover sentence. Unchanged frames are re-sent from cache, so cost scales with
screen changes rather than duration.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

from scenes import PHASES

W, H, FPS = 1920, 1080, 25
FONTS = Path("C:/Windows/Fonts")
MONO, MONO_B, SYMBOL = FONTS / "consola.ttf", FONTS / "consolab.ttf", FONTS / "seguisym.ttf"
UI, UI_B, UI_SB = FONTS / "segoeui.ttf", FONTS / "segoeuib.ttf", FONTS / "seguisb.ttf"

BG_TOP, BG_BOT = (9, 13, 28), (17, 24, 48)
TERM_BG, TITLE_BG = (13, 17, 23), (22, 27, 34)
FG = (212, 216, 224)
ACCENT = (108, 140, 255)     # blueberry
SNOW = (41, 181, 232)        # snowflake blue
GREEN, YELLOW, RED = (74, 222, 128), (250, 204, 21), (255, 107, 107)
ANSI = {30: (40, 44, 52), 31: (224, 108, 117), 32: (152, 195, 121), 33: (229, 192, 123), 34: (97, 175, 239),
        35: (198, 120, 221), 36: (86, 182, 194), 37: (220, 223, 228), 90: (110, 118, 129), 91: RED, 92: GREEN,
        93: YELLOW, 94: (96, 165, 250), 95: (192, 132, 252), 96: (34, 211, 238), 97: (248, 250, 252)}

FONT_SIZE = 24
f_mono = ImageFont.truetype(str(MONO), FONT_SIZE)
f_mono_b = ImageFont.truetype(str(MONO_B), FONT_SIZE)
f_sym = ImageFont.truetype(str(SYMBOL), FONT_SIZE - 3)
_cmap = set(TTFont(str(MONO))["cmap"].getBestCmap())
ASC, DESC = f_mono.getmetrics()
CW, LH = f_mono.getlength("M"), ASC + DESC

WIN_X, WIN_Y, WIN_W, WIN_H = 120, 104, 1680, 830
TITLE_H, PAD = 38, 18
TX, TY = WIN_X + PAD, WIN_Y + TITLE_H + 12
COLS = int((WIN_W - 2 * PAD) // CW)
ROWS = int((WIN_H - TITLE_H - 24) // LH)


def ui(size, weight="r"):
    return ImageFont.truetype(str({"r": UI, "b": UI_B, "sb": UI_SB}[weight]), size)


# ---------------------------------------------------------------- terminal emulator
class Term:
    CSI = re.compile(r"\x1b\[([0-9;]*)([A-Za-z])")

    def __init__(self):
        self.blank = (" ", (None, False, False))
        self.grid = [[self.blank] * COLS for _ in range(ROWS)]
        self.r = self.c = 0
        self.wrap = False
        self.style = (None, False, False)  # fg, bold, dim
        self.pending = ""

    def _newline(self):
        self.r += 1
        self.c = 0
        self.wrap = False
        if self.r >= ROWS:
            self.grid.pop(0)
            self.grid.append([self.blank] * COLS)
            self.r = ROWS - 1

    def _sgr(self, params):
        fg, bold, dim = self.style
        for p in [int(x) if x else 0 for x in (params.split(";") if params else ["0"])]:
            if p == 0:
                fg, bold, dim = None, False, False
            elif p == 1:
                bold = True
            elif p == 2:
                dim = True
            elif p == 22:
                bold = dim = False
            elif p == 39:
                fg = None
            elif p in ANSI:
                fg = p
        self.style = (fg, bold, dim)

    def feed(self, text: str):
        text = self.pending + text
        self.pending = ""
        esc = text.rfind("\x1b")
        if esc != -1 and not self.CSI.match(text, esc):
            text, self.pending = text[:esc], text[esc:]
        pos = 0
        for m in self.CSI.finditer(text):
            self._chars(text[pos:m.start()])
            params, cmd = m.groups()
            if cmd == "m":
                self._sgr(params)
            elif cmd == "J":
                self.grid = [[self.blank] * COLS for _ in range(ROWS)]
            elif cmd == "H":
                self.r = self.c = 0
                self.wrap = False
            elif cmd == "K":
                row = self.grid[self.r]
                self.grid[self.r] = row[:self.c] + [self.blank] * (COLS - self.c)
            pos = m.end()
        self._chars(text[pos:])

    def _chars(self, s: str):
        for ch in s:
            if ch == "\n":
                self._newline()
            elif ch == "\r":
                self.c = 0
                self.wrap = False
            elif ch >= " ":
                if self.wrap:
                    self._newline()
                row = self.grid[self.r]
                row[self.c] = (ch, self.style)
                if self.c == COLS - 1:
                    self.wrap = True
                else:
                    self.c += 1


def _color(style):
    fg, bold, dim = style
    col = ANSI.get(fg, FG)
    if dim:
        col = tuple(int(a * 0.5 + b * 0.5) for a, b in zip(col, TERM_BG))
    return col


def draw_term(d: ImageDraw.ImageDraw, term: Term, cursor: bool):
    for ri, row in enumerate(term.grid):
        y = TY + ri * LH
        ci = 0
        while ci < COLS:
            ch, st = row[ci]
            if ch == " ":
                ci += 1
                continue
            sym = ord(ch) not in _cmap
            cj = ci + 1
            while cj < COLS and row[cj][1] == st and (ord(row[cj][0]) not in _cmap) == sym and row[cj][0] != " " * sym:
                cj += 1
            text = "".join(c for c, _ in row[ci:cj])
            x = TX + round(ci * CW)
            if sym:
                for k, c in enumerate(text):
                    d.text((TX + round((ci + k) * CW), y + 2), c, font=f_sym, fill=_color(st))
            else:
                d.text((x, y), text, font=f_mono_b if st[1] else f_mono, fill=_color(st))
            ci = cj
    if cursor:
        x, y = TX + round(term.c * CW), TY + term.r * LH
        d.rectangle([x, y + 2, x + round(CW) - 1, y + LH - 2], fill=(200, 205, 215))


# ---------------------------------------------------------------- static layers
def _gradient():
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        k = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * k) for a, b in zip(BG_TOP, BG_BOT)))
    return img


def base_terminal(title: str) -> Image.Image:
    img = _gradient()
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([WIN_X + 6, WIN_Y + 10, WIN_X + WIN_W + 6, WIN_Y + WIN_H + 10], 14, fill=(4, 6, 14))
    d.rounded_rectangle([WIN_X, WIN_Y, WIN_X + WIN_W, WIN_Y + WIN_H], 14, fill=TERM_BG, outline=(48, 54, 66))
    d.rounded_rectangle([WIN_X, WIN_Y, WIN_X + WIN_W, WIN_Y + TITLE_H], 14, fill=TITLE_BG)
    d.rectangle([WIN_X, WIN_Y + TITLE_H - 14, WIN_X + WIN_W, WIN_Y + TITLE_H], fill=TITLE_BG)
    for i, col in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx = WIN_X + 24 + i * 24
        d.ellipse([cx - 7, WIN_Y + 12, cx + 7, WIN_Y + 26], fill=col)
    f = ui(18, "sb")
    tw = d.textlength(title, font=f)
    d.text((WIN_X + (WIN_W - tw) / 2, WIN_Y + 8), title, font=f, fill=(170, 177, 190))
    return img


def draw_header(d: ImageDraw.ImageDraw, phase: int, t: float):
    d.text((WIN_X, 26), "BlueberryChain", font=ui(34, "b"), fill=(240, 244, 255))
    d.text((WIN_X + 262, 40), "Cortex Code  ·  Snowflake", font=ui(19, "sb"), fill=SNOW)
    x = 760
    f = ui(17, "sb")
    for i, name in enumerate(PHASES):
        state = "done" if i < phase else "run" if i == phase else "todo"
        label = ("✓ " if state == "done" else "") + name
        tw = d.textlength(label, font=f) + 28
        fill = {"done": (22, 60, 40), "run": (60, 50, 10), "todo": (24, 30, 48)}[state]
        edge = {"done": GREEN, "run": YELLOW, "todo": (60, 70, 96)}[state]
        txt = {"done": GREEN, "run": YELLOW, "todo": (120, 130, 155)}[state]
        d.rounded_rectangle([x, 30, x + tw, 66], 18, fill=fill, outline=edge, width=2)
        if state == "done":
            _sym_text(d, x + 14, 37, label, f, txt)
        else:
            d.text((x + 14, 37), label, font=f, fill=txt)
        x += tw + 10
    clock = f"{int(t // 60):02d}:{int(t % 60):02d}"
    d.text((W - 120 + 10, 1048), clock, font=ui(16, "sb"), fill=(90, 100, 125))


def _sym_text(d, x, y, label, f, fill):
    d.text((x, y - 1), label[0], font=ImageFont.truetype(str(SYMBOL), 17), fill=fill)
    d.text((x + 16, y), label[2:], font=f, fill=fill)


# ---------------------------------------------------------------- captions
_cap_cache: dict[str, Image.Image] = {}


def caption_img(text: str) -> Image.Image:
    if text in _cap_cache:
        return _cap_cache[text]
    f = ui(29, "sb")
    tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if tmp.textlength(trial, font=f) > 1560 and cur:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    lines.append(cur)
    lh = 40
    bw = int(max(tmp.textlength(l, font=f) for l in lines)) + 56
    bh = lh * len(lines) + 22
    img = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], 14, fill=(5, 8, 18, 215))
    for i, l in enumerate(lines):
        lw = d.textlength(l, font=f)
        d.text(((bw - lw) / 2, 9 + i * lh), l, font=f, fill=(245, 247, 252, 255))
    _cap_cache[text] = img
    return img


def paste_caption(img: Image.Image, text: str):
    cap = caption_img(text)
    img.paste(cap, ((W - cap.width) // 2, H - cap.height - 18), cap)


# ---------------------------------------------------------------- cards
def draw_card(img: Image.Image, scene: dict, t_in: float, stats: dict):
    d = ImageDraw.Draw(img)
    if scene["id"] == "intro":
        d.text((160, 150), "BlueberryChain", font=ui(96, "b"), fill=(240, 244, 255))
        d.text((166, 270), "Tamper-evident cold-chain telemetry  ·  3 Cortex Code skills  ·  Snowflake",
               font=ui(32, "sb"), fill=SNOW)
        y = 370
        for i, b in enumerate(scene["bullets"]):
            if t_in >= scene["_bullet_at"][i]:
                d.ellipse([170, y + 16, 186, y + 32], fill=ACCENT if i < 3 else GREEN)
                d.text((210, y), b, font=ui(36, "sb" if i == 3 else "r"), fill=(225, 230, 242))
                y += 70
        _flow(d, 790)
    else:
        d.text((160, 130), "Raw telemetry in.  Tamper-evident evidence out.", font=ui(60, "b"), fill=(240, 244, 255))
        d.text((166, 220), f"run {stats['run_id']}  ·  BLUEBERRY_CHAIN.LEDGER  ·  account pndvhar-pt70809",
               font=ui(26, "sb"), fill=SNOW)
        tiles = [(f"{stats['records_in']:,}", "readings ingested", FG), (f"{stats['verified']:,}", "verified + chained", GREEN),
                 (f"{stats['quarantined']}", "quarantined", RED), (f"{stats['anomalies']}", "cold-chain anomalies", YELLOW),
                 (f"{stats['hold_kg']:,} kg", "on HOLD", RED), ("✓", "Merkle root matched in Snowflake", GREEN)]
        for i, (big, small, col) in enumerate(tiles):
            x, y = 160 + (i % 3) * 540, 320 + (i // 3) * 220
            d.rounded_rectangle([x, y, x + 500, y + 180], 18, fill=(18, 26, 50), outline=(52, 64, 100), width=2)
            font = ImageFont.truetype(str(SYMBOL), 76) if big == "✓" else ui(76, "b")
            d.text((x + 30, y + 14), big, font=font, fill=col)
            d.text((x + 32, y + 122), small, font=ui(28, "sb"), fill=(170, 180, 205))
        d.text((160, 790), f"merkle root  {stats['merkle_root']}", font=f_mono, fill=(120, 132, 160))
        d.text((160, 830), f"attestation  @LEDGER.ATTESTATION_STAGE/{stats['run_id']}/", font=f_mono, fill=(120, 132, 160))


def _flow(d, y):
    steps = [("INPUT", "IoT gateway ingest", FG), ("SKILL 1", "ledger-integrity-validator", ACCENT),
             ("SKILL 2", "coldchain-anomaly-detector", ACCENT), ("SKILL 3", "snowflake-audit-sync", ACCENT),
             ("SNOWFLAKE", "LEDGER + attestation", SNOW)]
    x = 160
    for i, (a, b, col) in enumerate(steps):
        d.rounded_rectangle([x, y, x + 288, y + 96], 14, fill=(18, 26, 50), outline=col, width=2)
        d.text((x + 18, y + 12), a, font=ui(24, "b"), fill=col)
        d.text((x + 18, y + 52), b, font=ui(19, "r"), fill=(185, 192, 210))
        if i < len(steps) - 1:
            d.text((x + 298, y + 26), "→", font=ui(36, "b"), fill=(110, 120, 150))
        x += 324


# ---------------------------------------------------------------- main loop
def render(timeline: dict, out_mp4: Path, wav: Path, ffmpeg: str, title: str, stats: dict) -> None:
    total = timeline["duration"]
    n_frames = int(round(total * FPS))
    base_t = base_terminal(title)
    base_c = _gradient()
    proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                             "-r", str(FPS), "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "faster", "-crf", "18",
                             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-t", f"{total:.3f}",
                             "-movflags", "+faststart", str(out_mp4)], stdin=subprocess.PIPE)
    scenes = timeline["scenes"]
    si, term, wi, last_key, last_bytes = -1, None, 0, None, None
    for f in range(n_frames):
        t = f / FPS
        while si + 1 < len(scenes) and t >= scenes[si + 1]["start"]:
            si += 1
            term, wi = (Term() if scenes[si]["kind"] == "term" else None), 0
        sc = scenes[si]
        t_in = t - sc["start"]
        dirty = False
        if term is not None:
            writes = sc["writes"]
            while wi < len(writes) and writes[wi][0] <= t_in:
                term.feed(writes[wi][1])
                wi += 1
                dirty = True
        cap = next((c["text"] for c in timeline["captions"] if c["start"] <= t < c["end"]), None)
        typing = term is not None and sc["type_start"] <= t_in <= sc["type_end"]
        blink = typing or (term is not None and int(t_in * 2) % 2 == 0 and wi >= len(sc["writes"]))
        fade_in = min(1.0, t_in / 0.35)
        fade_out = min(1.0, (total - t) / 1.2)
        fade = min(fade_in, fade_out)
        bullets = sum(t_in >= b for b in sc.get("_bullet_at", []))
        key = (si, wi, cap, blink, int(t), round(fade, 2), bullets)
        if key != last_key or dirty:
            img = (base_t if term is not None else base_c).copy()
            d = ImageDraw.Draw(img)
            if term is not None:
                draw_term(d, term, blink)
            else:
                draw_card(img, sc, t_in, stats)
            draw_header(d, sc["phase"], t)
            if cap:
                paste_caption(img, cap)
            if fade < 1.0:
                img = Image.blend(Image.new("RGB", (W, H)), img, max(0.0, fade))
            last_bytes, last_key = img.tobytes(), key
        proc.stdin.write(last_bytes)
        if f % (FPS * 15) == 0:
            print(f"  [render] {t:6.1f}s / {total:.1f}s", flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed")
