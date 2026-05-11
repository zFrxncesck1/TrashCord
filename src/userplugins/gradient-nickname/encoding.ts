import type { ColorStop, GradientConfig } from "./types";

// ============================================================================
// Font index — DO NOT REORDER. Decoder maps numeric idx → font name; existing
// bios encode the index, so reordering would corrupt other users' configs.
// Append new fonts at the end only.
// ============================================================================
const FONT_INDEX: string[] = [
    "",                          // 0 = no override
    "var(--font-primary)",       // 1
    "var(--font-display)",       // 2
    "var(--font-headline)",      // 3
    "var(--font-code)",          // 4
    "Inter",                     // 5
    "Roboto",                    // 6
    "Roboto Mono",               // 7
    "JetBrains Mono",            // 8
    "Source Code Pro",           // 9
    "Slabo 27px",                // 10
    "Open Sans",                 // 11
    "Lato",                      // 12
    "Montserrat",                // 13
    "Poppins",                   // 14
    "Raleway",                   // 15
    "Oswald",                    // 16
    "Merriweather",              // 17
    "Playfair Display",          // 18
    "Bebas Neue",                // 19
    "Comic Sans MS",             // 20
    "Courier New",               // 21
    "Times New Roman",           // 22
    "Arial",                     // 23
    "Georgia",                   // 24
    "Impact",                    // 25
    "Trebuchet MS",              // 26
    "Verdana",                   // 27
    "Lucida Console",            // 28
];
const FONT_INDEX_BY_NAME: Record<string, number> = {};
FONT_INDEX.forEach((name, i) => { if (name) FONT_INDEX_BY_NAME[name] = i; });

const ANIM_BY_NAME: Record<string, number> = {
    none: 0, slide: 1, pulse: 2, hue: 3, wave: 4,
};
const ANIM_BY_IDX = ["none", "slide", "pulse", "hue", "wave"] as const;

const DIR_BY_NAME: Record<string, number> = {
    left: 0, right: 1, up: 2, down: 3,
};
const DIR_BY_IDX = ["left", "right", "up", "down"] as const;

// ============================================================================
// Zero-width Unicode encoding — 16 invisible chars = 4 bits each, 2 chars/byte.
// Wrapped between U+2063 sentinels so decoder can locate the blob in bio text.
// 50% smaller than the prior 4-char palette.
// ============================================================================
const ZW = [
    "​", "‌", "‍", "⁠",
    "⁡", "⁢", "⁤", "͏",
    "᠎", "ᅟ", "ᅠ", "឴",
    "឵", "ㅤ", "ﾠ", "‎",
];
const ZW_TO_IDX: Record<string, number> = {};
ZW.forEach((c, i) => { ZW_TO_IDX[c] = i; });
const SENTINEL = "⁣";
const ZW_PATTERN = `[${ZW.join("")}]+`;

function bytesToZW(bytes: Uint8Array): string {
    let out = "";
    for (const b of bytes) {
        out += ZW[(b >> 4) & 0xF] + ZW[b & 0xF];
    }
    return out;
}

function zwToBytes(s: string): Uint8Array | null {
    const chars: number[] = [];
    for (const c of s) {
        if (c in ZW_TO_IDX) chars.push(ZW_TO_IDX[c]);
    }
    if (chars.length === 0 || chars.length % 2 !== 0) return null;
    const out = new Uint8Array(chars.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = (chars[i * 2] << 4) | chars[i * 2 + 1];
    }
    return out;
}

// ============================================================================
// Binary serialization (v1) — packed for size to fit Discord's 190-char bio
// limit after ZW expansion (4 chars per byte).
// ============================================================================
const BINARY_VERSION = 2;

function clampSpeedByte(n: number): number {
    return Math.max(1, Math.min(15, Math.round(n)));
}

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace(/^#/, "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map(n => n.toString(16).padStart(2, "0")).join("");
}

function serializeBin(cfg: GradientConfig): Uint8Array {
    const numStops = Math.min(8, cfg.stops.length);
    const animBits = ANIM_BY_NAME[cfg.anim] ?? 0;
    const dirBits = cfg.slideDir ? (DIR_BY_NAME[cfg.slideDir] ?? 0) : 0;
    const wdirBit = cfg.waveDir === "in" ? 1 : 0;
    const glowBit = cfg.glow ? 1 : 0;
    const rawSpeed = (cfg as any).speed;
    const speed = (typeof rawSpeed === "number" && rawSpeed > 0) ? clampSpeedByte(rawSpeed) : 0;
    const glowIntensity = cfg.glowIntensity != null ? clampSpeedByte(cfg.glowIntensity) : 0;
    const fontIdx = (cfg.font && FONT_INDEX_BY_NAME[cfg.font]) || 0;
    const numGlowStops = glowBit && cfg.glowStops ? Math.min(8, cfg.glowStops.length) : 0;
    const glowAnimBits = cfg.glowAnim ? Math.min(7, ["none", "orbit", "pulse", "wave", "flicker", "bounce", "spin-fast"].indexOf(cfg.glowAnim)) : 0;

    // hueAnim bitmask: low byte = main stops (up to 8), high byte = glow stops (up to 8)
    let hueMask = 0;
    for (let i = 0; i < numStops; i++) {
        if (cfg.stops[i].hueAnim) hueMask |= 1 << i;
    }
    if (numGlowStops > 0) {
        for (let i = 0; i < numGlowStops; i++) {
            if (cfg.glowStops![i].hueAnim) hueMask |= 1 << (8 + i);
        }
    }

    const totalLen = 7 + numStops * 3 + numGlowStops * 3;
    const buf = new Uint8Array(totalLen);
    buf[0] = (BINARY_VERSION << 4) | numStops;
    buf[1] = (animBits << 5) | (dirBits << 3) | (wdirBit << 2) | (glowBit << 1);
    buf[2] = (speed << 4) | (glowIntensity & 0xF);
    buf[3] = fontIdx;
    buf[4] = (numGlowStops << 4) | (glowAnimBits & 0x7);
    buf[5] = hueMask & 0xFF;        // main stops hueAnim flags
    buf[6] = (hueMask >> 8) & 0xFF; // glow stops hueAnim flags

    let off = 7;
    for (let i = 0; i < numStops; i++) {
        const [r, g, b] = hexToRgb(cfg.stops[i].color);
        buf[off++] = r;
        buf[off++] = g;
        buf[off++] = b;
    }
    for (let i = 0; i < numGlowStops; i++) {
        const [r, g, b] = hexToRgb(cfg.glowStops![i].color);
        buf[off++] = r;
        buf[off++] = g;
        buf[off++] = b;
    }
    return buf;
}

function deserializeBin(buf: Uint8Array): GradientConfig | null {
    if (buf.length < 7) return null;
    const version = (buf[0] >> 4) & 0xF;
    if (version !== BINARY_VERSION) return null;
    const numStops = buf[0] & 0xF;
    const animBits = (buf[1] >> 5) & 0x7;
    const dirBits = (buf[1] >> 3) & 0x3;
    const wdirBit = (buf[1] >> 2) & 0x1;
    const glowBit = (buf[1] >> 1) & 0x1;
    const speed = (buf[2] >> 4) & 0xF;
    const glowIntensity = buf[2] & 0xF;
    const fontIdx = buf[3];
    const numGlowStops = (buf[4] >> 4) & 0xF;
    const glowAnimBits = buf[4] & 0x7;
    const hueMaskLo = buf[5];
    const hueMaskHi = buf[6];

    const need = 7 + numStops * 3 + numGlowStops * 3;
    if (buf.length < need) return null;

    let off = 7;
    const stops: ColorStop[] = [];
    for (let i = 0; i < numStops; i++) {
        const r = buf[off++], g = buf[off++], b = buf[off++];
        const stop: ColorStop = { color: rgbToHex(r, g, b) };
        if (i < 8 && (hueMaskLo & (1 << i))) stop.hueAnim = true;
        stops.push(stop);
    }
    if (stops.length === 0) return null;

    const glowStops: ColorStop[] = [];
    for (let i = 0; i < numGlowStops; i++) {
        const r = buf[off++], g = buf[off++], b = buf[off++];
        const stop: ColorStop = { color: rgbToHex(r, g, b) };
        if (i < 8 && (hueMaskHi & (1 << i))) stop.hueAnim = true;
        glowStops.push(stop);
    }

    const anim = ANIM_BY_IDX[animBits] ?? "none";
    const cfg: GradientConfig = { stops, anim };
    if (anim === "slide") cfg.slideDir = DIR_BY_IDX[dirBits];
    if (anim === "wave" && wdirBit) cfg.waveDir = "in";
    if (fontIdx > 0 && fontIdx < FONT_INDEX.length) cfg.font = FONT_INDEX[fontIdx];
    if (speed > 0) (cfg as any).speed = speed; // 0 means not encoded
    if (glowBit) {
        cfg.glow = true;
        if (glowStops.length > 0) cfg.glowStops = glowStops;
        if (glowIntensity > 0) cfg.glowIntensity = glowIntensity;
        const glowAnimNames: GradientConfig["glowAnim"][] = ["none", "orbit", "pulse", "wave", "flicker", "bounce", "spin-fast"];
        if (glowAnimBits > 0 && glowAnimBits < glowAnimNames.length) cfg.glowAnim = glowAnimNames[glowAnimBits];
    }
    return cfg;
}

// ============================================================================
// Public encode / decode
// ============================================================================
export function encode(cfg: GradientConfig): string {
    const bytes = serializeBin(cfg);
    return SENTINEL + bytesToZW(bytes) + SENTINEL;
}

const ZW_BLOB_RE = new RegExp(`${SENTINEL}(${ZW_PATTERN})${SENTINEL}`);

export function decode(bio: string): GradientConfig | null {
    if (!bio) return null;

    const zwMatch = bio.match(ZW_BLOB_RE);
    if (zwMatch) {
        const bytes = zwToBytes(zwMatch[1]);
        if (bytes) {
            const cfg = deserializeBin(bytes);
            if (cfg) return cfg;
        }
    }

    return decodePlain(bio);
}

// Backward-compatibility: parse legacy `[grad:...]` plaintext tags so bios set
// before the ZW migration still resolve.
const PLAIN_TAG_RE = /\[grad:([#0-9a-fA-F,@h]+)(?:;anim=([a-z]+))?(?:;font=([a-zA-Z0-9_-]+))?(?:;dir=([lrud]))?(?:;wdir=([io]))?(?:;mg=([0-9,]+))?\]/;
const PLAIN_STOP_RE = /^(#[0-9a-fA-F]{6})(@h)?$/;
const VALID_ANIM = new Set(["none", "hue", "slide", "pulse", "wave"]);

function decodePlain(bio: string): GradientConfig | null {
    const m = bio.match(PLAIN_TAG_RE);
    if (!m) return null;

    const rawStops = m[1].split(",").map(s => s.trim().toLowerCase());
    const parsed: ColorStop[] = [];
    for (const raw of rawStops) {
        const sm = raw.match(PLAIN_STOP_RE);
        if (!sm) return null;
        const stop: ColorStop = { color: sm[1] };
        if (sm[2]) stop.hueAnim = true;
        parsed.push(stop);
    }
    if (parsed.length === 0) return null;

    const animRaw = m[2];
    const anim = (animRaw && VALID_ANIM.has(animRaw)) ? animRaw : "none";
    const font = m[3] ? m[3].replace(/_/g, " ") : undefined;
    const slideDir = m[4] === "r" ? "right" : m[4] === "u" ? "up" : m[4] === "d" ? "down" : undefined;
    const waveDir = m[5] === "i" ? "in" : undefined;

    const cfg: GradientConfig = { stops: parsed, anim: anim as GradientConfig["anim"] };
    if (font) cfg.font = font;
    if (slideDir) cfg.slideDir = slideDir;
    if (waveDir) cfg.waveDir = waveDir;
    return cfg;
}

// ============================================================================
// Bio strip pattern — used by bioWriter to remove old tag content before
// appending new one. Matches both ZW blob and legacy plain tag.
// ============================================================================
export const BIO_STRIP_RE = new RegExp(
    `${SENTINEL}(?:${ZW_PATTERN}|${SENTINEL})*${SENTINEL}|\\s*\\[grad:[^\\]]*\\]\\s*`,
    "g"
);
