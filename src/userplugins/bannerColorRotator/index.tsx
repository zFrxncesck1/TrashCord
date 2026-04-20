import { DataStore }            from "@api/index";
import { UserAreaButton }       from "@api/UserArea";
import { definePluginSettings } from "@api/Settings";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, RestAPI, Toasts } from "@webpack/common";

const SK        = "BannerColorRotator_v3";
const DEFAULT_S = 300;

type CycleMode =
    | "full_random"       | "avatar_hue"        | "mono_cycle"
    | "warm"              | "cool"               | "pastel"
    | "dark"              | "vivid"              | "gradient_walk"
    | "chromatic"         | "rgb_loop"           | "complementary"
    | "triadic"           | "analogous"          | "earth"
    | "neon"              | "sunset"             | "ocean"
    | "shade_light_dark"  | "shade_dark_light"   | "shade_oscillate"
    | "favs_sequential"   | "favorites_only"     | "favorites_mix"
    | "favorites_hue"     | "favs_shade";

interface StoreData {
    favorites: string[];
    usedFavs: string[];
    wasRunning: boolean;
    currentColor: string | null;
}

const C = {
    line:   "rgba(255,255,255,.07)",
    accent: "#c084fc",
    aD:     "rgba(192,132,252,.18)",
    green:  "#3ba55c",
    red:    "#ed4245",
    text:   "#f0e6ff",
    sub:    "var(--text-muted)",
    warn:   "#faa61a",
};

let favorites:     string[]                             = [];
let usedFavs:      string[]                             = [];
let randomBatch:   string[]                             = [];
let seqBatch:      string[]                             = [];
let rotatorTimer:  ReturnType<typeof setTimeout> | null = null;
let pluginActive   = false;
let cachedHue:     number | null                        = null;
let gradientState: [number, number, number] | null      = null;
let monoBaseHue:   number | null                        = null;
let seqBaseHue     = 0;
let shadeStep      = 0;
let shadeDir       = 1;
let currentColor:  string | null                        = null;
let onColorApplied: ((hex: string) => void) | null      = null;

const settings = definePluginSettings({
    intervalSeconds:  { type: OptionType.NUMBER,  description: "Change interval in seconds",                                              default: DEFAULT_S },
    mode:             { type: OptionType.SELECT,  description: "Color cycle mode", options: [
        { label: "Full Random",        value: "full_random",      default: true },
        { label: "Avatar Hue",         value: "avatar_hue"       },
        { label: "Mono Cycle",         value: "mono_cycle"       },
        { label: "Warm",               value: "warm"             },
        { label: "Cool",               value: "cool"             },
        { label: "Pastel",             value: "pastel"           },
        { label: "Dark",               value: "dark"             },
        { label: "Vivid",              value: "vivid"            },
        { label: "Gradient Walk",      value: "gradient_walk"    },
        { label: "Chromatic",          value: "chromatic"        },
        { label: "RGB Loop",           value: "rgb_loop"         },
        { label: "Complementary",      value: "complementary"    },
        { label: "Triadic",            value: "triadic"          },
        { label: "Analogous",          value: "analogous"        },
        { label: "Earth Tones",        value: "earth"            },
        { label: "Neon",               value: "neon"             },
        { label: "Sunset",             value: "sunset"           },
        { label: "Ocean",              value: "ocean"            },
        { label: "Shade L→D",          value: "shade_light_dark" },
        { label: "Shade D→L",          value: "shade_dark_light" },
        { label: "Shade Oscillate",    value: "shade_oscillate"  },
        { label: "Favs Sequential",    value: "favs_sequential"  },
        { label: "Favs Only",          value: "favorites_only"   },
        { label: "Favs + Random",      value: "favorites_mix"    },
        { label: "Favs + Avatar Hue",  value: "favorites_hue"    },
        { label: "Favs Shade",         value: "favs_shade"       },
    ]},
    hueRadius:        { type: OptionType.NUMBER,  description: "Hue spread in degrees (1–180) for Avatar Hue / Favs+Hue / Analogous modes. Lower = colors stay close to the base hue. Higher = wider variety.", default: 35 },
    customBaseColor:  { type: OptionType.STRING,  description: "Base color used by Shade modes and Mono Cycle. Pick it in the Color tab.",  default: "#c084fc" },
    showToast:        { type: OptionType.BOOLEAN, description: "Show toast notifications on every color change",                           default: false },
    showButton:       { type: OptionType.BOOLEAN, description: "Show Banner Color Rotator button in user area (bottom-left)",              default: true },
    showCurrentColor: { type: OptionType.BOOLEAN, description: "Show current active banner color swatch in the user area button tooltip and modal header (disabled by default)", default: false },
});

const saveData = (): Promise<void> => DataStore.set(SK, { favorites, usedFavs, wasRunning: rotatorTimer !== null, currentColor } as StoreData);

function toast(msg: string, type: Toasts.Type = Toasts.Type.SUCCESS) {
    if (!settings.store.showToast) return;
    Toasts.show({ message: msg, type, id: Toasts.genId() });
}

function fmtSec(s: number): string {
    if (s < 60)   return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    if (s < 3600) return r === 0 ? `${m}m` : `${m}m ${r}s`;
    const h = Math.floor(s / 3600), mr = Math.floor((s % 3600) / 60);
    return mr === 0 ? `${h}h` : `${h}h ${mr}m`;
}

function isValidHex(v: string): boolean { return /^#[0-9a-fA-F]{6}$/.test(v); }

function hsvToHex(h: number, s: number, v: number): string {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    v = Math.max(0, Math.min(1, v));
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if      (h < 60)  { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    const toB = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
    return "#" + toB(r) + toB(g) + toB(b);
}

function hexToHsv(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            case b: h = ((r - g) / d + 4) * 60; break;
        }
    }
    return [h, max === 0 ? 0 : d / max, max];
}

function hslToHex(h: number, s: number, l: number): string {
    s /= 100; l /= 100;
    const v = l + s * Math.min(l, 1 - l);
    return hsvToHex(h, v === 0 ? 0 : 2 * (1 - l / v), v);
}

function randomHex(): string {
    return "#" + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, "0");
}

function sfShuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function buildBatch(size: number, gen: () => string): string[] {
    const set = new Set<string>();
    let tries = 0;
    while (set.size < size && tries++ < size * 8) set.add(gen());
    return [...set];
}

function pickFromFavs(): string {
    if (!favorites.length) return randomHex();
    const available = favorites.filter(c => !usedFavs.includes(c));
    if (!available.length) { usedFavs = []; return pickFromFavs(); }
    const color = available[Math.floor(Math.random() * available.length)];
    usedFavs = [...usedFavs, color];
    return color;
}

function getBaseHsv(): [number, number, number] {
    const base = settings.store.customBaseColor ?? "#c084fc";
    return isValidHex(base) ? hexToHsv(base) : [270, 0.48, 0.79];
}

async function getAvatarHue(): Promise<number> {
    if (cachedHue !== null) return cachedHue;
    try {
        const me = await RestAPI.get({ url: "/users/@me" });
        const { avatar, id } = me?.body ?? {};
        if (!avatar || !id) return Math.random() * 360;
        return await new Promise<number>(res => {
            const img = new Image(); img.crossOrigin = "anonymous";
            img.onload = () => {
                const cv = document.createElement("canvas"); cv.width = 8; cv.height = 8;
                const ctx = cv.getContext("2d")!;
                ctx.drawImage(img, 0, 0, 8, 8);
                const d = ctx.getImageData(0, 0, 8, 8).data;
                let rS = 0, gS = 0, bS = 0, n = 0;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] > 128) { rS += d[i]; gS += d[i + 1]; bS += d[i + 2]; n++; }
                }
                if (!n) { res(Math.random() * 360); return; }
                const hex = "#" + [rS, gS, bS].map(x => Math.round(x / n).toString(16).padStart(2, "0")).join("");
                cachedHue = hexToHsv(hex)[0];
                res(cachedHue!);
            };
            img.onerror = () => res(Math.random() * 360);
            img.src = `https://cdn.discordapp.com/avatars/${id}/${avatar}.webp?size=32`;
        });
    } catch { return Math.random() * 360; }
}

function buildShadeSequence(lightFirst: boolean): string[] {
    const [h, s] = getBaseHsv();
    const steps = 20;
    const seq: string[] = [];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const l = lightFirst ? 88 - t * 83 : 5 + t * 83;
        seq.push(hslToHex(h * 360, s * 100, l));
    }
    return seq;
}

async function pickNextColor(): Promise<string> {
    const mode = (settings.store.mode ?? "full_random") as CycleMode;
    const R    = Math.max(1, Math.min(180, settings.store.hueRadius ?? 35));

    if (mode === "full_random") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, randomHex));
        return randomBatch.shift()!;
    }

    if (mode === "avatar_hue") {
        if (!randomBatch.length) {
            const hue = await getAvatarHue();
            randomBatch = sfShuffle(buildBatch(32, () => hslToHex(hue + (Math.random() * 2 - 1) * R, 40 + Math.random() * 55, 20 + Math.random() * 50)));
        }
        return randomBatch.shift()!;
    }

    if (mode === "mono_cycle") {
        if (monoBaseHue === null || !randomBatch.length) {
            const [h] = getBaseHsv();
            monoBaseHue = h * 360;
            randomBatch = sfShuffle(buildBatch(32, () => hslToHex(monoBaseHue!, 25 + Math.random() * 70, 10 + Math.random() * 75)));
        }
        return randomBatch.shift()!;
    }

    if (mode === "warm") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => hslToHex(Math.random() * 60, 55 + Math.random() * 45, 20 + Math.random() * 50)));
        return randomBatch.shift()!;
    }

    if (mode === "cool") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => hslToHex(180 + Math.random() * 120, 50 + Math.random() * 50, 20 + Math.random() * 45)));
        return randomBatch.shift()!;
    }

    if (mode === "pastel") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => hslToHex(Math.random() * 360, 25 + Math.random() * 35, 70 + Math.random() * 18)));
        return randomBatch.shift()!;
    }

    if (mode === "dark") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => hslToHex(Math.random() * 360, 40 + Math.random() * 55, 4 + Math.random() * 16)));
        return randomBatch.shift()!;
    }

    if (mode === "vivid") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => hslToHex(Math.random() * 360, 88 + Math.random() * 12, 38 + Math.random() * 22)));
        return randomBatch.shift()!;
    }

    if (mode === "gradient_walk") {
        if (!gradientState) gradientState = [Math.random() * 360, 50 + Math.random() * 40, 25 + Math.random() * 40];
        gradientState = [
            (gradientState[0] + 12 + Math.random() * 28) % 360,
            Math.max(30, Math.min(95, gradientState[1] + (Math.random() - 0.5) * 20)),
            Math.max(14, Math.min(76, gradientState[2] + (Math.random() - 0.5) * 14)),
        ];
        return hslToHex(...gradientState);
    }

    if (mode === "chromatic") {
        if (!seqBatch.length) {
            const STEPS = 24;
            seqBatch = Array.from({ length: STEPS }, (_, i) => hslToHex((seqBaseHue + (360 / STEPS) * i) % 360, 75, 42));
            seqBaseHue = (seqBaseHue + 15) % 360;
        }
        return seqBatch.shift()!;
    }

    if (mode === "rgb_loop") {
        if (!seqBatch.length) {
            const r: string[] = Array.from({ length: 8 }, (_, i) => hslToHex(0,   55 + i * 5, 20 + i * 7));
            const g: string[] = Array.from({ length: 8 }, (_, i) => hslToHex(120, 55 + i * 5, 20 + i * 7));
            const b: string[] = Array.from({ length: 8 }, (_, i) => hslToHex(240, 55 + i * 5, 20 + i * 7));
            seqBatch = [...r, ...g, ...b];
        }
        return seqBatch.shift()!;
    }

    if (mode === "complementary") {
        if (!seqBatch.length) {
            const h0 = Math.random() * 360;
            seqBatch = sfShuffle([
                ...Array.from({ length: 8 }, () => hslToHex(h0         + (Math.random() - 0.5) * 10, 50 + Math.random() * 40, 25 + Math.random() * 40)),
                ...Array.from({ length: 8 }, () => hslToHex((h0 + 180) % 360 + (Math.random() - 0.5) * 10, 50 + Math.random() * 40, 25 + Math.random() * 40)),
            ]);
        }
        return seqBatch.shift()!;
    }

    if (mode === "triadic") {
        if (!seqBatch.length) {
            const h0 = Math.random() * 360;
            seqBatch = sfShuffle([
                ...Array.from({ length: 6 }, () => hslToHex(h0               + (Math.random() - 0.5) * 8, 55 + Math.random() * 35, 28 + Math.random() * 35)),
                ...Array.from({ length: 6 }, () => hslToHex((h0 + 120) % 360 + (Math.random() - 0.5) * 8, 55 + Math.random() * 35, 28 + Math.random() * 35)),
                ...Array.from({ length: 6 }, () => hslToHex((h0 + 240) % 360 + (Math.random() - 0.5) * 8, 55 + Math.random() * 35, 28 + Math.random() * 35)),
            ]);
        }
        return seqBatch.shift()!;
    }

    if (mode === "analogous") {
        if (!randomBatch.length) {
            const hue = await getAvatarHue();
            randomBatch = sfShuffle(buildBatch(24, () => hslToHex(hue + (Math.random() * 2 - 1) * Math.min(R, 60), 45 + Math.random() * 50, 22 + Math.random() * 48)));
        }
        return randomBatch.shift()!;
    }

    if (mode === "earth") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => {
            const h = [25, 32, 40, 50, 20, 15][Math.floor(Math.random() * 6)];
            return hslToHex(h + (Math.random() - 0.5) * 14, 30 + Math.random() * 40, 18 + Math.random() * 40);
        }));
        return randomBatch.shift()!;
    }

    if (mode === "neon") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => hslToHex(Math.random() * 360, 100, 50 + Math.random() * 12)));
        return randomBatch.shift()!;
    }

    if (mode === "sunset") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => {
            const h = 0 + Math.random() * 55;
            return hslToHex(h, 70 + Math.random() * 30, 28 + Math.random() * 38);
        }));
        return randomBatch.shift()!;
    }

    if (mode === "ocean") {
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, () => hslToHex(175 + Math.random() * 50, 50 + Math.random() * 45, 18 + Math.random() * 42)));
        return randomBatch.shift()!;
    }

    if (mode === "shade_light_dark") {
        if (!seqBatch.length) { seqBatch = buildShadeSequence(true); shadeStep = 0; }
        const out = seqBatch[shadeStep % seqBatch.length];
        shadeStep++;
        if (shadeStep >= seqBatch.length) { seqBatch = []; }
        return out;
    }

    if (mode === "shade_dark_light") {
        if (!seqBatch.length) { seqBatch = buildShadeSequence(false); shadeStep = 0; }
        const out = seqBatch[shadeStep % seqBatch.length];
        shadeStep++;
        if (shadeStep >= seqBatch.length) { seqBatch = []; }
        return out;
    }

    if (mode === "shade_oscillate") {
        if (!seqBatch.length) { seqBatch = buildShadeSequence(true); shadeStep = 0; shadeDir = 1; }
        const out = seqBatch[Math.max(0, Math.min(seqBatch.length - 1, shadeStep))];
        shadeStep += shadeDir;
        if (shadeStep >= seqBatch.length - 1) shadeDir = -1;
        if (shadeStep <= 0)                   shadeDir =  1;
        return out;
    }

    if (mode === "favs_sequential") {
        if (!favorites.length) return randomHex();
        if (!seqBatch.length) seqBatch = [...favorites];
        return seqBatch.shift()!;
    }

    if (mode === "favorites_only") return pickFromFavs();

    if (mode === "favorites_mix") {
        if (favorites.length && Math.random() < 0.5) return pickFromFavs();
        if (!randomBatch.length) randomBatch = sfShuffle(buildBatch(32, randomHex));
        return randomBatch.shift()!;
    }

    if (mode === "favorites_hue") {
        if (favorites.length && Math.random() < 0.5) return pickFromFavs();
        if (!randomBatch.length) {
            const hue = await getAvatarHue();
            randomBatch = sfShuffle(buildBatch(32, () => hslToHex(hue + (Math.random() * 2 - 1) * R, 40 + Math.random() * 55, 20 + Math.random() * 50)));
        }
        return randomBatch.shift()!;
    }

    if (mode === "favs_shade") {
        const base = favorites.length ? pickFromFavs() : randomHex();
        const [h, , v] = hexToHsv(base);
        const l = v * 100;
        return hslToHex(h * (180 / Math.PI) || h, 60 + Math.random() * 35, Math.max(8, Math.min(88, l + (Math.random() * 2 - 1) * 40)));
    }

    return randomHex();
}

async function applyColor(hex: string): Promise<void> {
    try {
        await RestAPI.patch({ url: "/users/@me", body: { banner_color: hex } });
        currentColor = hex;
        onColorApplied?.(hex);
        toast(`Banner → ${hex}`);
        await saveData();
    } catch (e: any) {
        toast(`Failed: ${e?.body?.message ?? e?.message ?? "Unknown"}`, Toasts.Type.FAILURE);
    }
}

async function rotateNext(): Promise<void> {
    if (!pluginActive) return;
    await applyColor(await pickNextColor());
    schedule();
}

function schedule() {
    if (rotatorTimer) clearTimeout(rotatorTimer);
    if (!pluginActive || rotatorTimer === null && !pluginActive) return;
    rotatorTimer = setTimeout(rotateNext, Math.max(1, settings.store.intervalSeconds ?? DEFAULT_S) * 1000);
}

function startRotator(immediate = false) {
    if (!pluginActive) return;
    if (rotatorTimer) clearTimeout(rotatorTimer);
    randomBatch = []; seqBatch = []; usedFavs = []; gradientState = null; monoBaseHue = null; seqBaseHue = 0; shadeStep = 0; shadeDir = 1;
    rotatorTimer = setTimeout(() => {}, 0);
    if (immediate) void rotateNext(); else { rotatorTimer = setTimeout(rotateNext, Math.max(1, settings.store.intervalSeconds ?? DEFAULT_S) * 1000); }
    toast("Banner Color Rotator started");
}

function stopRotator() {
    if (rotatorTimer) { clearTimeout(rotatorTimer); rotatorTimer = null; }
    toast("Banner Color Rotator stopped", Toasts.Type.MESSAGE);
    void saveData();
}

function exportAllSettings() {
    const payload = {
        version:         3,
        favorites,
        mode:            settings.store.mode            ?? "full_random",
        intervalSeconds: settings.store.intervalSeconds  ?? DEFAULT_S,
        hueRadius:       settings.store.hueRadius        ?? 35,
        customBaseColor: settings.store.customBaseColor  ?? "#c084fc",
        showToast:       settings.store.showToast        ?? false,
        showButton:      settings.store.showButton       ?? true,
        showCurrentColor:settings.store.showCurrentColor ?? false,
    };
    const a    = document.createElement("a");
    a.href     = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    a.download = "banner-rotator-settings.json";
    a.click();
    toast("Settings exported");
}

function importAllSettings(file: File): Promise<Partial<typeof settings.store> & { favorites?: string[] }> {
    return file.text().then(txt => {
        const obj = JSON.parse(txt);
        return {
            favorites:        Array.isArray(obj.favorites) ? (obj.favorites as any[]).filter(x => typeof x === "string" && isValidHex(x)) : undefined,
            mode:             obj.mode             ?? undefined,
            intervalSeconds:  obj.intervalSeconds  ?? undefined,
            hueRadius:        obj.hueRadius        ?? undefined,
            customBaseColor:  obj.customBaseColor  ?? undefined,
            showToast:        obj.showToast        ?? undefined,
            showButton:       obj.showButton       ?? undefined,
            showCurrentColor: obj.showCurrentColor ?? undefined,
        };
    });
}

const MODES: { id: CycleMode; emoji: string; label: string; desc: string; needsBase?: boolean; needsHueR?: boolean }[] = [
    { id: "full_random",      emoji: "🎲", label: "Full Random",      desc: "Any hex, 32-batch no repeats"                 },
    { id: "avatar_hue",       emoji: "🖼", label: "Avatar Hue",       desc: "Near your avatar color (Hue Radius applies)", needsHueR: true },
    { id: "mono_cycle",       emoji: "🔵", label: "Mono Cycle",       desc: "All shades of Base Color",                    needsBase: true },
    { id: "warm",             emoji: "🔥", label: "Warm",             desc: "Reds, oranges, yellows"                       },
    { id: "cool",             emoji: "❄️", label: "Cool",             desc: "Blues, purples, teals"                        },
    { id: "pastel",           emoji: "🌸", label: "Pastel",           desc: "Soft, high-lightness tones"                   },
    { id: "dark",             emoji: "🌑", label: "Dark",             desc: "Very dark shades, any hue"                    },
    { id: "vivid",            emoji: "⚡", label: "Vivid",            desc: "High saturation, punchy colors"               },
    { id: "gradient_walk",    emoji: "🌈", label: "Gradient Walk",    desc: "Smooth hue+sat+light drift each step"         },
    { id: "chromatic",        emoji: "🎡", label: "Chromatic",        desc: "Sequential sweep of the full hue wheel"       },
    { id: "rgb_loop",         emoji: "🔴", label: "RGB Loop",         desc: "Red shades → Green shades → Blue shades"      },
    { id: "complementary",    emoji: "🔄", label: "Complementary",    desc: "Opposite hues 180° apart, random mix"         },
    { id: "triadic",          emoji: "△",  label: "Triadic",          desc: "Three hues 120° apart, random mix"            },
    { id: "analogous",        emoji: "〰", label: "Analogous",         desc: "Colors near avatar hue (Hue Radius applies)", needsHueR: true },
    { id: "earth",            emoji: "🌍", label: "Earth Tones",      desc: "Browns, ochres, terracottas"                  },
    { id: "neon",             emoji: "💡", label: "Neon",             desc: "100% saturation fluorescent tones"            },
    { id: "sunset",           emoji: "🌅", label: "Sunset",           desc: "Warm reds, oranges, golds"                   },
    { id: "ocean",            emoji: "🌊", label: "Ocean",            desc: "Deep teals and ocean blues"                   },
    { id: "shade_light_dark", emoji: "⬛", label: "Shade L→D",        desc: "Base Color from light to dark sequentially", needsBase: true },
    { id: "shade_dark_light", emoji: "⬜", label: "Shade D→L",        desc: "Base Color from dark to light sequentially", needsBase: true },
    { id: "shade_oscillate",  emoji: "↕️", label: "Shade Oscillate",  desc: "Base Color bouncing light ↔ dark",           needsBase: true },
    { id: "favs_sequential",  emoji: "📋", label: "Favs Sequential",  desc: "Favorites in exact saved order, no shuffle"  },
    { id: "favorites_only",   emoji: "⭐", label: "Favs Only",        desc: "Favorites shuffled, no repeats per cycle"     },
    { id: "favorites_mix",    emoji: "🎨", label: "Favs + Random",    desc: "50/50 favorites & full random"               },
    { id: "favorites_hue",    emoji: "🎯", label: "Favs + Hue",       desc: "Favorites or near-avatar hue random",        needsHueR: true },
    { id: "favs_shade",       emoji: "🎭", label: "Favs Shade",       desc: "Each fav color with random shade variation"  },
];

function Hr() { return <div style={{ height: 1, background: C.line, margin: "7px 0" }} />; }

function Swatch({ color, size = 22, active, onClick, title }: { color: string; size?: number; active?: boolean; onClick?: () => void; title?: string }) {
    return (
        <div title={title ?? color} onClick={onClick}
            style={{ width: size, height: size, borderRadius: 5, background: isValidHex(color) ? color : "#333", flexShrink: 0, cursor: onClick ? "pointer" : "default", border: active ? `2px solid ${C.accent}` : "1.5px solid rgba(255,255,255,.18)", boxSizing: "border-box" }} />
    );
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
    return (
        <div onClick={onChange} style={{ width: 34, height: 18, borderRadius: 9, flexShrink: 0, cursor: "pointer", background: value ? C.accent : "rgba(255,255,255,.13)", position: "relative", userSelect: "none" }}>
            <div style={{ position: "absolute", top: 2, left: value ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
        </div>
    );
}

function TabBar({ tab, setTab }: { tab: string; setTab: (t: any) => void }) {
    const TABS = [["color", "🎨 Color"], ["cycle", "⚙ Cycle"], ["favs", "⭐ Favs"], ["io", "💾 I/O"]] as const;
    return (
        <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, padding: "0 14px" }}>
            {TABS.map(([id, label]) => (
                <div key={id} onClick={() => setTab(id)}
                    style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: 700, padding: "5px 0", cursor: "pointer", userSelect: "none", color: tab === id ? C.accent : C.sub, borderBottom: `2px solid ${tab === id ? C.accent : "transparent"}` }}>
                    {label}
                </div>
            ))}
        </div>
    );
}

function HsvPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
    const W = 216, H = 116;
    const cvRef   = React.useRef<HTMLCanvasElement>(null);
    const hsvR    = React.useRef<[number, number, number]>(isValidHex(value) ? hexToHsv(value) : [270, 0.48, 0.79]);
    const dragCv  = React.useRef(false);
    const dragHue = React.useRef(false);
    const [hsv,  setHsv]  = React.useState<[number, number, number]>(hsvR.current);
    const [hex,  setHex]  = React.useState(isValidHex(value) ? value : "#c084fc");

    const draw = (hue: number) => {
        const cv = cvRef.current; if (!cv) return;
        const ctx = cv.getContext("2d")!;
        const gH = ctx.createLinearGradient(0, 0, W, 0);
        gH.addColorStop(0, "#fff"); gH.addColorStop(1, hsvToHex(hue, 1, 1));
        ctx.fillStyle = gH; ctx.fillRect(0, 0, W, H);
        const gV = ctx.createLinearGradient(0, 0, 0, H);
        gV.addColorStop(0, "rgba(0,0,0,0)"); gV.addColorStop(1, "#000");
        ctx.fillStyle = gV; ctx.fillRect(0, 0, W, H);
    };

    React.useEffect(() => { draw(hsvR.current[0]); }, []);

    React.useEffect(() => {
        if (!isValidHex(value)) return;
        const vl = value.toLowerCase();
        if (vl !== hsvToHex(...hsvR.current)) {
            const h = hexToHsv(vl); hsvR.current = h; setHsv([...h]); setHex(vl); draw(h[0]);
        }
    }, [value]);

    const emit = (h: number, s: number, v: number) => {
        hsvR.current = [h, s, v]; setHsv([h, s, v]);
        const out = hsvToHex(h, s, v); setHex(out); onChange(out);
    };

    const onSvPtr = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = cvRef.current!.getBoundingClientRect();
        emit(hsvR.current[0], Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)));
    };

    const onHuePtr = (e: React.PointerEvent<HTMLDivElement>) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const t    = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const h    = t * 360;
        draw(h); emit(h, hsvR.current[1], hsvR.current[2]);
    };

    const HUE_GRAD = "linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ position: "relative", borderRadius: 6, overflow: "hidden", cursor: "crosshair", userSelect: "none" }}>
                <canvas ref={cvRef} width={W} height={H} style={{ display: "block", width: "100%", height: H }}
                    onPointerDown={e => { dragCv.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onSvPtr(e); }}
                    onPointerMove={e => { if (dragCv.current) onSvPtr(e); }}
                    onPointerUp={() => { dragCv.current = false; }}
                    onPointerCancel={() => { dragCv.current = false; }}
                />
                <div style={{ position: "absolute", left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, width: 10, height: 10, borderRadius: "50%", border: "2px solid #fff", boxShadow: "0 0 3px rgba(0,0,0,.9)", transform: "translate(-50%,-50%)", pointerEvents: "none", background: hsvToHex(hsv[0], hsv[1], hsv[2]) }} />
            </div>

            <div style={{ position: "relative", height: 14, borderRadius: 7, background: HUE_GRAD, cursor: "ew-resize", userSelect: "none" }}
                onPointerDown={e => { dragHue.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onHuePtr(e); }}
                onPointerMove={e => { if (dragHue.current) onHuePtr(e); }}
                onPointerUp={() => { dragHue.current = false; }}
                onPointerCancel={() => { dragHue.current = false; }}
            >
                <div style={{ position: "absolute", top: "50%", left: `${(hsv[0] / 360) * 100}%`, width: 14, height: 14, borderRadius: "50%", border: "2.5px solid #fff", background: hsvToHex(hsv[0], 1, 1), boxShadow: "0 0 3px rgba(0,0,0,.8)", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ width: 26, height: 26, borderRadius: 5, background: hex, border: "1.5px solid rgba(255,255,255,.2)", flexShrink: 0 }} />
                <input value={hex} maxLength={7}
                    onChange={e => {
                        const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
                        setHex(v);
                        if (isValidHex(v)) { const h = hexToHsv(v); hsvR.current = h; setHsv([...h]); draw(h[0]); onChange(v); }
                    }}
                    style={{ flex: 1, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 5, color: C.text, fontSize: 12, padding: "4px 8px", outline: "none", fontFamily: "monospace" }} />
            </div>
        </div>
    );
}

function HueRadiusSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const dragRef = React.useRef(false);

    const onPtr = (e: React.PointerEvent<HTMLDivElement>) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const t    = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onChange(Math.round(5 + t * 175));
    };

    const pct = ((value - 5) / 175) * 100;

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: C.sub, flexShrink: 0, width: 90 }}>Hue radius: <b style={{ color: C.text }}>{value}°</b></span>
            <div style={{ flex: 1, position: "relative", height: 14, cursor: "ew-resize", userSelect: "none" }}
                onPointerDown={e => { dragRef.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onPtr(e); }}
                onPointerMove={e => { if (dragRef.current) onPtr(e); }}
                onPointerUp={() => { dragRef.current = false; }}
                onPointerCancel={() => { dragRef.current = false; }}
            >
                <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 4, borderRadius: 2, background: "rgba(255,255,255,.12)", transform: "translateY(-50%)" }} />
                <div style={{ position: "absolute", top: "50%", left: 0, width: `${pct}%`, height: 4, borderRadius: 2, background: C.accent, transform: "translateY(-50%)" }} />
                <div style={{ position: "absolute", top: "50%", left: `${pct}%`, width: 14, height: 14, borderRadius: "50%", background: C.accent, border: "2px solid #fff", transform: "translate(-50%,-50%)", boxShadow: "0 0 4px rgba(0,0,0,.5)" }} />
            </div>
        </div>
    );
}

function FavsReorderList({ favs, commitFavs, setPreview, setTab }: {
    favs: string[];
    commitFavs: (nf: string[]) => Promise<void>;
    setPreview: (hex: string) => void;
    setTab: (t: string) => void;
}) {
    const dragRef  = React.useRef<number | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [overIdx, setOverIdx] = React.useState<number | null>(null);
    const [editIdx, setEditIdx] = React.useState<number | null>(null);
    const [editVal, setEditVal] = React.useState("");

    const startEdit = (i: number, hex: string) => {
        setEditIdx(i);
        setEditVal(hex);
        setTimeout(() => { inputRef.current?.select(); }, 0);
    };

    const commitEdit = () => {
        if (editIdx === null) return;
        const raw = editVal.trim();
        const v   = raw.startsWith("#") ? raw : "#" + raw;
        if (isValidHex(v)) {
            const next = [...favs];
            next[editIdx] = v.toLowerCase();
            void commitFavs(next);
        }
        setEditIdx(null);
    };

    const cancelEdit = () => setEditIdx(null);

    const onDS = (e: React.DragEvent, i: number) => {
        if (editIdx !== null) return;
        dragRef.current = i;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
    };
    const onDO = (e: React.DragEvent, i: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverIdx(prev => prev !== i ? i : prev);
    };
    const onDL = (i: number) => setOverIdx(prev => prev === i ? null : prev);
    const onDP = (e: React.DragEvent, to: number) => {
        e.preventDefault();
        const from = dragRef.current;
        if (from !== null && from !== to) {
            const next = [...favs];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            void commitFavs(next);
        }
        dragRef.current = null;
        setOverIdx(null);
    };
    const onDE = () => { dragRef.current = null; setOverIdx(null); };

    return (
        <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 2 }}>
            {favs.map((hex, i) => {
                const isDragged = dragRef.current === i;
                const isOver    = overIdx === i && dragRef.current !== i;
                const isEditing = editIdx === i;
                const previewHex = isEditing && isValidHex(editVal.startsWith("#") ? editVal : "#" + editVal)
                    ? (editVal.startsWith("#") ? editVal : "#" + editVal)
                    : hex;
                return (
                    <div key={`${hex}-${i}`} draggable={!isEditing}
                        onDragStart={e => onDS(e, i)} onDragOver={e => onDO(e, i)}
                        onDragLeave={() => onDL(i)} onDrop={e => onDP(e, i)} onDragEnd={onDE}
                        style={{
                            display: "flex", alignItems: "center", gap: 7,
                            padding: "5px 8px", borderRadius: 7, marginBottom: 3,
                            background: isOver ? "rgba(192,132,252,.09)" : "rgba(255,255,255,.03)",
                            border: `1px solid ${isEditing ? C.accent + "99" : isOver ? "rgba(192,132,252,.5)" : C.line}`,
                            opacity: isDragged ? 0.3 : 1,
                            cursor: isEditing ? "default" : "grab", userSelect: "none" as const,
                        }}>
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="rgba(255,255,255,.3)" style={{ flexShrink: 0 }}>
                            <rect y="1" width="12" height="1.8" rx="0.9"/>
                            <rect y="5" width="12" height="1.8" rx="0.9"/>
                            <rect y="9" width="12" height="1.8" rx="0.9"/>
                        </svg>
                        <div style={{ width: 18, height: 18, borderRadius: 4, background: isValidHex(previewHex) ? previewHex : "#333", border: "1.5px solid rgba(255,255,255,.18)", flexShrink: 0, cursor: isEditing ? "default" : "pointer" }}
                            onClick={() => { if (!isEditing) { setPreview(hex); setTab("color"); } }} title={isEditing ? undefined : "Edit in Color tab"} />
                        {isEditing ? (
                            <input ref={inputRef} value={editVal} maxLength={7} autoFocus
                                onChange={e => { const v = e.target.value; setEditVal(v.startsWith("#") ? v : v ? "#" + v.replace(/^#+/, "") : ""); }}
                                onBlur={commitEdit}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") cancelEdit(); }}
                                style={{ flex: 1, background: "rgba(0,0,0,.5)", border: `1px solid ${isValidHex(editVal.startsWith("#") ? editVal : "#" + editVal) ? C.accent : C.red}`, borderRadius: 5, color: C.text, fontSize: 11, padding: "2px 6px", outline: "none", fontFamily: "monospace", userSelect: "text" as const }} />
                        ) : (
                            <span
                                style={{ flex: 1, fontSize: 11, color: C.text, fontFamily: "monospace", userSelect: "all" as const, cursor: "text" }}
                                onDoubleClick={() => startEdit(i, hex)}
                                title="Double-click to edit">
                                {hex}
                            </span>
                        )}
                        {isEditing ? (
                            <>
                                <button onClick={e => { e.stopPropagation(); commitEdit(); }}
                                    title="Confirm"
                                    style={{ background: "none", border: "none", cursor: "pointer", color: C.green, fontSize: 14, padding: 0, outline: "none", lineHeight: 1, flexShrink: 0 }}>✓</button>
                                <button onClick={e => { e.stopPropagation(); cancelEdit(); }}
                                    title="Cancel"
                                    style={{ background: "none", border: "none", cursor: "pointer", color: C.sub, fontSize: 12, padding: 0, outline: "none", lineHeight: 1, flexShrink: 0 }}>✕</button>
                            </>
                        ) : (
                            <>
                                <button onClick={e => { e.stopPropagation(); startEdit(i, hex); }}
                                    title="Edit color"
                                    style={{ background: "none", border: "none", cursor: "pointer", color: C.sub, fontSize: 11, padding: 0, outline: "none", lineHeight: 1, flexShrink: 0, opacity: 0.7 }}>✏</button>
                                <button onClick={e => { e.stopPropagation(); void commitFavs(favs.filter((_, j) => j !== i)); }}
                                    title="Remove"
                                    style={{ background: "none", border: "none", cursor: "pointer", color: C.sub, fontSize: 12, padding: 0, outline: "none", lineHeight: 1, flexShrink: 0 }}>✕</button>
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function BannerColorRotatorModal({ modalProps, onToggle }: { modalProps: any; onToggle: () => void }) {
    const [running,  setRunning]  = React.useState(rotatorTimer !== null);
    const [mode,     setModeS]    = React.useState<CycleMode>((settings.store.mode as CycleMode) ?? "full_random");
    const [sec,      setSec]      = React.useState(settings.store.intervalSeconds ?? DEFAULT_S);
    const [secStr,   setSecStr]   = React.useState(String(settings.store.intervalSeconds ?? DEFAULT_S));
    const [hueR,     setHueR]     = React.useState(settings.store.hueRadius ?? 35);
    const [baseColor,setBase]     = React.useState(settings.store.customBaseColor ?? "#c084fc");
    const [favs,     setFavs]     = React.useState<string[]>([...favorites]);
    const [preview,  setPreview]  = React.useState(currentColor ?? "#111214");
    const [applying, setApplying] = React.useState(false);
    const [tab,      setTab]      = React.useState<"color" | "cycle" | "favs" | "io">("color");
    const [loading,  setLoading]  = React.useState(false);
    const [liveColor,setLive]     = React.useState<string | null>(currentColor);

    React.useEffect(() => {
        onColorApplied = (hex) => setLive(hex);
        return () => { onColorApplied = null; };
    }, []);

    const PRESET_HEX = ["#111214","#5865f2","#3ba55c","#ed4245","#faa61a","#c084fc","#00b0f4","#ff6b6b","#1e3a5f","#2d1b69","#701a75","#065f46"];
    const PRESET_S   = [30, 60, 120, 300, 600, 1800, 3600];

    const commitFavs = async (nf: string[]) => {
        favorites = nf; setFavs([...nf]);
        usedFavs  = usedFavs.filter(c => nf.includes(c));
        await saveData();
    };

    const handleModeChange = (m: CycleMode) => {
        setModeS(m); (settings.store as any).mode = m;
        randomBatch = []; seqBatch = []; usedFavs = []; gradientState = null; monoBaseHue = null; seqBaseHue = 0; shadeStep = 0; shadeDir = 1;
        if (running) { stopRotator(); rotatorTimer = setTimeout(rotateNext, Math.max(1, settings.store.intervalSeconds ?? DEFAULT_S) * 1000); setRunning(true); }
    };

    const handleSecBlur = (raw: string) => {
        const v = Math.max(5, parseInt(raw) || DEFAULT_S);
        setSec(v); setSecStr(String(v)); (settings.store as any).intervalSeconds = v;
        if (running) { if (rotatorTimer) clearTimeout(rotatorTimer); rotatorTimer = setTimeout(rotateNext, v * 1000); }
    };

    const handleHueRChange = (v: number) => {
        setHueR(v); (settings.store as any).hueRadius = v; randomBatch = [];
    };

    const handleBaseChange = (hex: string) => {
        setBase(hex); (settings.store as any).customBaseColor = hex;
        randomBatch = []; seqBatch = []; monoBaseHue = null; shadeStep = 0; shadeDir = 1;
    };

    const handleToggle = () => {
        if (running) { stopRotator(); setRunning(false); }
        else { startRotator(true); setRunning(true); }
        onToggle();
    };

    const applyNow = async () => {
        if (applying || !isValidHex(preview)) return;
        setApplying(true); await applyColor(preview); setApplying(false);
    };

    const skipNow = async () => {
        const color = await pickNextColor();
        setPreview(color); await applyColor(color);
        if (running) { if (rotatorTimer) clearTimeout(rotatorTimer); rotatorTimer = setTimeout(rotateNext, Math.max(1, sec) * 1000); }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]; if (!f) return;
        setLoading(true);
        try {
            const data = await importAllSettings(f);
            if (data.favorites) await commitFavs([...new Set([...favs, ...data.favorites])]);
            if (data.mode)             { (settings.store as any).mode             = data.mode;            setModeS(data.mode as CycleMode); }
            if (data.intervalSeconds)  { (settings.store as any).intervalSeconds  = data.intervalSeconds; setSec(data.intervalSeconds); setSecStr(String(data.intervalSeconds)); }
            if (data.hueRadius)        { (settings.store as any).hueRadius        = data.hueRadius;       setHueR(data.hueRadius); }
            if (data.customBaseColor)  { (settings.store as any).customBaseColor  = data.customBaseColor; setBase(data.customBaseColor); }
            if (data.showToast   !== undefined) (settings.store as any).showToast        = data.showToast;
            if (data.showButton  !== undefined) (settings.store as any).showButton       = data.showButton;
            if (data.showCurrentColor !== undefined) (settings.store as any).showCurrentColor = data.showCurrentColor;
            toast("Settings imported");
        } catch { toast("Import failed", Toasts.Type.FAILURE); }
        setLoading(false); e.target.value = "";
    };

    const prevLower  = preview.toLowerCase();
    const curMode    = MODES.find(m => m.id === mode);
    const needsBase  = curMode?.needsBase;
    const needsHueR  = curMode?.needsHueR;
    const showLive   = settings.store.showCurrentColor && isValidHex(liveColor ?? "");

    return (
        <ModalRoot {...modalProps} size="small">
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: C.aD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="9" stroke={C.accent} strokeWidth="2.5"/>
                            <circle cx="12" cy="12" r="4" fill={C.accent}/>
                        </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
                            Banner Color Rotator
                            {showLive && <Swatch color={liveColor!} size={14} title={`Current: ${liveColor}`} />}
                        </div>
                        <div style={{ fontSize: 10, color: C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {running ? `● ${fmtSec(sec)} - ${curMode?.emoji} ${curMode?.label}` : "○ Stopped"}
                        </div>
                    </div>
                    <Toggle value={running} onChange={handleToggle} />
                </div>
            </ModalHeader>

            <TabBar tab={tab} setTab={setTab} />

            <ModalContent style={{ padding: "10px 14px" }}>
                {tab === "color" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <HsvPicker value={preview} onChange={setPreview} />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                            {PRESET_HEX.map(p => <Swatch key={p} color={p} active={prevLower === p} onClick={() => setPreview(p)} />)}
                        </div>
                        <div style={{ display: "flex", gap: 5 }}>
                            <button onClick={applyNow} disabled={applying || !isValidHex(preview)}
                                style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: applying ? "wait" : "pointer", background: C.aD, border: `1px solid ${C.accent}44`, color: C.accent, outline: "none", opacity: !isValidHex(preview) ? 0.4 : 1 }}>
                                {applying ? "Applying…" : "Apply Now"}
                            </button>
                            <button onClick={() => { if (isValidHex(preview) && !favs.includes(prevLower)) void commitFavs([...favs, prevLower]); }}
                                disabled={!isValidHex(preview) || favs.includes(prevLower)}
                                style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", background: "rgba(59,165,92,.13)", border: "1px solid rgba(59,165,92,.38)", color: C.green, outline: "none", opacity: (!isValidHex(preview) || favs.includes(prevLower)) ? 0.4 : 1 }}>
                                {favs.includes(prevLower) ? "✓ Saved" : "★ Save to Favs"}
                            </button>
                        </div>
                        {needsBase && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${C.line}` }}>
                                <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Base Color for cycle mode</div>
                                <HsvPicker value={baseColor} onChange={handleBaseChange} />
                            </div>
                        )}
                        <div style={{ padding: "5px 8px", borderRadius: 5, background: "rgba(250,166,26,.09)", border: "1px solid rgba(250,166,26,.22)", fontSize: 10, color: C.warn }}>
                            ⚠ Banner color is free - no Nitro required
                        </div>
                    </div>
                )}

                {tab === "cycle" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                            {MODES.map(m => {
                                const active = mode === m.id;
                                return (
                                    <div key={m.id} onClick={() => handleModeChange(m.id)}
                                        style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 7px", borderRadius: 6, cursor: "pointer", background: active ? C.aD : "rgba(255,255,255,.03)", border: `1px solid ${active ? C.accent + "55" : C.line}`, userSelect: "none" }}>
                                        <span style={{ fontSize: 11, flexShrink: 0 }}>{m.emoji}</span>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: active ? C.text : C.sub }}>{m.label}</div>
                                            <div style={{ fontSize: 9, color: C.sub, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.desc}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {needsHueR && (
                            <>
                                <Hr />
                                <div style={{ padding: "7px 10px", borderRadius: 6, background: "rgba(255,255,255,.03)", border: `1px solid ${C.line}` }}>
                                    <div style={{ fontSize: 9, color: C.sub, marginBottom: 6, lineHeight: 1.5 }}>
                                        <b style={{ color: C.text }}>Hue Radius</b> controls how far generated colors stray from the base hue.
                                        At <b>5°</b> all colors look almost identical. At <b>180°</b> any hue is allowed.
                                    </div>
                                    <HueRadiusSlider value={hueR} onChange={handleHueRChange} />
                                </div>
                            </>
                        )}

                        <Hr />
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: C.sub, textTransform: "uppercase" }}>Interval</div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {PRESET_S.map(p => {
                                const label  = p < 60 ? `${p}s` : p < 3600 ? `${p / 60}m` : `${p / 3600}h`;
                                const active = sec === p;
                                return (
                                    <button key={p} onClick={() => { setSec(p); setSecStr(String(p)); (settings.store as any).intervalSeconds = p; if (running) { if (rotatorTimer) clearTimeout(rotatorTimer); rotatorTimer = setTimeout(rotateNext, p * 1000); } }}
                                        style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", outline: "none", border: `1px solid ${active ? C.accent + "55" : C.line}`, background: active ? C.aD : "rgba(255,255,255,.03)", color: active ? C.accent : C.sub, userSelect: "none" }}>
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <input type="number" min={5} value={secStr}
                                onChange={e => setSecStr(e.target.value)}
                                onBlur={e  => handleSecBlur(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleSecBlur((e.target as HTMLInputElement).value)}
                                style={{ width: 62, background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 5, color: C.text, fontSize: 12, padding: "4px 7px", outline: "none" }} />
                            <span style={{ fontSize: 10, color: C.sub }}>sec = {fmtSec(sec)}</span>
                        </div>
                    </div>
                )}

                {tab === "favs" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {favs.length === 0
                            ? (
                                <div style={{ textAlign: "center", padding: "20px 0", color: C.sub, fontSize: 11 }}>
                                    <div style={{ fontSize: 20, marginBottom: 4 }}>🎨</div>
                                    No favorites yet - pick a color and save it
                                </div>
                            )
                            : (
                                <>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: 10, color: C.sub }}>Drag to reorder · double-click or ✏ to edit</span>
                                        <button onClick={() => void commitFavs([])}
                                            style={{ fontSize: 10, color: C.red, background: "none", border: "none", cursor: "pointer", outline: "none" }}>
                                            Clear all
                                        </button>
                                    </div>
                                    <FavsReorderList favs={favs} commitFavs={commitFavs} setPreview={setPreview} setTab={setTab} />
                                </>
                            )
                        }
                    </div>
                )}

                {tab === "io" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 10, color: C.sub, lineHeight: 1.6 }}>
                            Export/import <b style={{ color: C.text }}>all settings</b> including favorites, mode, interval, hue radius, base color, and preferences.
                        </div>
                        <Hr />
                        <div style={{ display: "flex", gap: 5 }}>
                            <label style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 0", borderRadius: 7, cursor: loading ? "not-allowed" : "pointer", background: "rgba(59,165,92,.11)", border: "1px dashed rgba(59,165,92,.5)", color: C.green, fontSize: 11, fontWeight: 700 }}>
                                <input type="file" accept="application/json" style={{ display: "none" }} onChange={handleImport} disabled={loading} />
                                📥 Import Settings
                            </label>
                            <button onClick={exportAllSettings}
                                style={{ flex: 1, padding: "9px 0", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", background: C.aD, border: `1px solid ${C.accent}44`, color: C.accent, outline: "none" }}>
                                📤 Export Settings
                            </button>
                        </div>
                        <Hr />
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: C.sub, textTransform: "uppercase" }}>Options</div>
                        {([
                            ["showToast",        "Toast notifications on each change"],
                            ["showCurrentColor", "Show current color swatch in header (free - disabled by default)"],
                            ["showButton",       "Show button in user area"],
                        ] as [keyof typeof settings.store, string][]).map(([key, label]) => (
                            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontSize: 11, color: C.text }}>{label}</span>
                                <Toggle value={!!(settings.store as any)[key]} onChange={() => { (settings.store as any)[key] = !(settings.store as any)[key]; void saveData(); }} />
                            </div>
                        ))}
                    </div>
                )}
            </ModalContent>

            <ModalFooter separator={false}>
                <div style={{ display: "flex", gap: 6, width: "100%", alignItems: "center" }}>
                    <button onClick={() => void skipNow()}
                        style={{ padding: "6px 13px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: C.aD, border: `1px solid ${C.accent}44`, color: C.accent, cursor: "pointer", outline: "none" }}>
                        ⏭ Skip
                    </button>
                    {showLive && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <Swatch color={liveColor!} size={16} />
                            <span style={{ fontSize: 10, color: C.sub, fontFamily: "monospace" }}>{liveColor}</span>
                        </div>
                    )}
                    <button onClick={modalProps.onClose}
                        style={{ marginLeft: "auto", padding: "6px 13px", borderRadius: 6, fontSize: 11, background: "transparent", border: `1px solid ${C.line}`, color: C.sub, cursor: "pointer", outline: "none" }}>
                        Close
                    </button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function BCRUserAreaButton({ refresh }: { refresh: number }) {
    const running = rotatorTimer !== null;
    if (!settings.store.showButton) return null;
    const cur     = settings.store.showCurrentColor && isValidHex(currentColor ?? "") ? currentColor! : null;
    const mode    = MODES.find(m => m.id === settings.store.mode);
    const tooltip = running
        ? `Banner Color Rotator - ${fmtSec(settings.store.intervalSeconds ?? DEFAULT_S)} - ${mode?.emoji} ${mode?.label}${cur ? ` - ${cur}` : ""}`
        : "Banner Color Rotator - stopped";
    return (
        <UserAreaButton tooltipText={tooltip}
            icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="2" y="4" width="20" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="2"/>
                    {cur ? <rect x="4" y="6" width="16" height="9" rx="1.5" fill={cur}/> : <circle cx="12" cy="10.5" r="3.5"/>}
                    {running && <circle cx="20.5" cy="4.5" r="2.8" fill={C.accent}/>}
                </svg>
            }
            onClick={() => openModal(p => <BannerColorRotatorModal modalProps={p} onToggle={() => {}} />)}
        />
    );
}

let uaRefresh = 0;
let setUaRefreshFn: ((v: number) => void) | null = null;

function BCRUserAreaWrapper() {
    const [r, setR] = React.useState(0);
    React.useEffect(() => { setUaRefreshFn = setR; return () => { setUaRefreshFn = null; }; }, []);
    React.useEffect(() => { const id = setInterval(() => setR(v => v + 1), 3000); return () => clearInterval(id); }, []);
    return <BCRUserAreaButton refresh={r} />;
}

export default definePlugin({
    name:        "BannerColorRotator",
    description: "Auto-cycles your Discord banner color. 26 modes. HSV picker, import/export all settings, optional current-color display. Free - no Nitro.",
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
    authors:     [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,
    dependencies: ["UserAreaAPI"],

    settingsAboutComponent: () => (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <Button color={Button.Colors.BRAND} onClick={() => openModal(p => <BannerColorRotatorModal modalProps={p} onToggle={() => {}} />)}>
                Open Banner Color Rotator
            </Button>
            <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(250,166,26,.09)", border: "1px solid rgba(250,166,26,.28)", fontSize: 11, color: C.warn }}>
                ⚠ Banner color is free - no Nitro. Toggle off/on or reload if stuck.
            </div>
        </div>
    ),

    async start() {
        pluginActive = true;
        const stored: StoreData = (await DataStore.get(SK)) ?? { favorites: [], usedFavs: [], wasRunning: false, currentColor: null };
        favorites    = stored.favorites    ?? [];
        usedFavs     = stored.usedFavs     ?? [];
        currentColor = stored.currentColor ?? null;
        Vencord.Api.UserArea.addUserAreaButton("banner-color-rotator", () => <BCRUserAreaWrapper />);
        if (stored.wasRunning) startRotator(false);
    },

    stop() {
        pluginActive = false;
        stopRotator();
        favorites = []; usedFavs = []; randomBatch = []; seqBatch = []; cachedHue = null; gradientState = null; monoBaseHue = null; currentColor = null; onColorApplied = null; setUaRefreshFn = null;
        Vencord.Api.UserArea.removeUserAreaButton("banner-color-rotator");
    },
});