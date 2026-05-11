import { Button, React, Toasts, Tooltip, UserStore } from "@webpack/common";
import { loadConfig, saveConfig, emit as emitStorage } from "./storage";
import { getPrefs, updatePrefs, subscribePrefs } from "./pluginState";
import { encode } from "./encoding";
import { ensureFontLoaded } from "./fonts";
import type { AnimationType, ColorStop, GlowAnimationType, GradientConfig, SlideDirection } from "./types";

const DEFAULT_STOPS: ColorStop[] = [{ color: "#ff5f6d" }, { color: "#ffc371" }];

const ANIMS: { value: AnimationType; label: string }[] = [
    { value: "none", label: "None" },
    { value: "slide", label: "Slide" },
    { value: "pulse", label: "Pulse" },
];

const FONTS: { value: string; label: string; group: "system" | "google" | "discord" }[] = [
    { value: "", label: "Default (Discord)", group: "system" },
    // Discord-native fonts (always available — no fetch).
    { value: "var(--font-primary)", label: "Discord — gg sans", group: "discord" },
    { value: "var(--font-display)", label: "Discord — Display", group: "discord" },
    { value: "var(--font-headline)", label: "Discord — Headline", group: "discord" },
    { value: "var(--font-code)", label: "Discord — Mono", group: "discord" },
    // Google Fonts (lazy-loaded on demand; may fail if Discord CSP blocks the fetch)
    { value: "Inter", label: "Inter", group: "google" },
    { value: "Roboto", label: "Roboto", group: "google" },
    { value: "Roboto Mono", label: "Roboto Mono", group: "google" },
    { value: "JetBrains Mono", label: "JetBrains Mono", group: "google" },
    { value: "Source Code Pro", label: "Source Code Pro", group: "google" },
    { value: "Slabo 27px", label: "Slabo 27px", group: "google" },
    { value: "Open Sans", label: "Open Sans", group: "google" },
    { value: "Lato", label: "Lato", group: "google" },
    { value: "Montserrat", label: "Montserrat", group: "google" },
    { value: "Poppins", label: "Poppins", group: "google" },
    { value: "Raleway", label: "Raleway", group: "google" },
    { value: "Oswald", label: "Oswald", group: "google" },
    { value: "Merriweather", label: "Merriweather", group: "google" },
    { value: "Playfair Display", label: "Playfair Display", group: "google" },
    { value: "Bebas Neue", label: "Bebas Neue", group: "google" },
    // System fonts (always available)
    { value: "Comic Sans MS", label: "Comic Sans MS", group: "system" },
    { value: "Courier New", label: "Courier New", group: "system" },
    { value: "Times New Roman", label: "Times New Roman", group: "system" },
    { value: "Arial", label: "Arial", group: "system" },
    { value: "Georgia", label: "Georgia", group: "system" },
    { value: "Impact", label: "Impact", group: "system" },
    { value: "Trebuchet MS", label: "Trebuchet MS", group: "system" },
    { value: "Verdana", label: "Verdana", group: "system" },
    { value: "Lucida Console", label: "Lucida Console", group: "system" },
];

function clampSpeed(s: number): number {
    return Math.max(1, Math.min(10, Math.round(s)));
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
    const n = parseInt(hex.replace(/^#/, ""), 16);
    const r = ((n >> 16) & 0xff) / 255;
    const g = ((n >> 8) & 0xff) / 255;
    const b = (n & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
    }
    h = (h * 60 + 360) % 360;
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
}

function rotateHue(hex: string, deg: number): string {
    const { h, s, v } = hexToHsv(hex);
    return hsvToHex(((h + deg) % 360 + 360) % 360, s, v);
}

function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; b = 0; }
    else if (hp < 2) { r = x; g = c; b = 0; }
    else if (hp < 3) { r = 0; g = c; b = x; }
    else if (hp < 4) { r = 0; g = x; b = c; }
    else if (hp < 5) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const m = v - c;
    const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
}

function makeGradientStyle(stops: string[], anim: AnimationType, speed: number): React.CSSProperties {
    const list = stops.length === 1 ? [stops[0], stops[0]] : stops;
    const needsScroll = anim === "slide" || anim === "wave";
    const css: React.CSSProperties = {
        background: `linear-gradient(90deg, ${list.join(", ")})`,
        backgroundSize: needsScroll ? "200% 100%" : undefined,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
        fontWeight: 700,
    };
    switch (anim) {
        case "slide": css.animation = `gradname-slide ${speed}s ease-in-out infinite`; break;
        case "hue": css.animation = `gradname-hue ${speed}s linear infinite`; break;
        case "pulse": css.animation = `gradname-pulse ${Math.max(1, speed / 3)}s ease-in-out infinite`; break;
        case "wave": css.animation = `gradname-wave ${speed}s linear infinite`; break;
    }
    return css;
}

const styles = {
    backdrop: {
        position: "relative" as const,
        margin: "32px 0 16px",
        padding: 4,
        borderRadius: 16,
        background: "linear-gradient(135deg, rgba(255,95,109,0.18), rgba(255,195,113,0.10), rgba(120,115,245,0.18))",
        boxShadow: "0 12px 32px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2)",
    },
    card: {
        background: "var(--background-secondary, #2b2d31)",
        borderRadius: 13,
        padding: 24,
        position: "relative" as const,
        overflow: "hidden" as const,
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 4,
    },
    title: {
        color: "var(--header-primary, #f2f3f5)",
        margin: 0,
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: -0.2,
    },
    badge: {
        background: "var(--brand-experiment, #5865f2)",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase" as const,
        padding: "2px 8px",
        borderRadius: 10,
        letterSpacing: 0.5,
    },
    description: {
        color: "var(--text-muted, #80848e)",
        fontSize: 13,
        marginBottom: 20,
        lineHeight: 1.4,
    },
    previewWrap: {
        padding: "24px 16px 18px",
        background: "var(--background-tertiary, #1e1f22)",
        borderRadius: 8,
        textAlign: "center" as const,
        marginBottom: 24,
        border: "1px solid var(--background-modifier-accent, #3f4147)",
    },
    previewName: {
        fontSize: 26,
        lineHeight: 1.2,
        display: "inline-block",
    },
    previewBar: (stops: ColorStop[]) => {
        const colors = stops.map(s => s.color);
        const list = colors.length === 1 ? [colors[0], colors[0]] : colors;
        return {
            marginTop: 14,
            height: 4,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${list.join(", ")})`,
            width: "100%",
            opacity: 0.85,
        } as React.CSSProperties;
    },
    sectionLabel: {
        color: "var(--header-secondary, #b5bac1)",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
        marginBottom: 10,
        marginTop: 4,
    },
    stopsList: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
    },
    stopRow: () => ({
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 10,
        borderRadius: 8,
        background: "var(--background-tertiary, #1e1f22)",
        border: "1px solid var(--background-modifier-accent, #3f4147)",
        cursor: "grab" as const,
    }),
    ghostRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 10,
        borderRadius: 8,
        background: "var(--background-tertiary, #1e1f22)",
        border: "2px dashed var(--brand-experiment, #5865f2)",
        opacity: 0.55,
        pointerEvents: "none" as const,
    } as React.CSSProperties,
    dragHandle: {
        color: "var(--text-muted, #80848e)",
        userSelect: "none" as const,
        fontSize: 16,
        cursor: "grab" as const,
        padding: "0 4px",
    },
    hexInput: {
        flex: 1,
        background: "var(--input-background, #1e1f22)",
        color: "var(--text-normal, #dbdee1)",
        border: "1px solid var(--background-modifier-accent, #3f4147)",
        borderRadius: 6,
        padding: "8px 12px",
        fontFamily: "var(--font-code, ui-monospace, monospace)",
        fontSize: 14,
        outline: "none",
    },
    removeBtn: (canRemove: boolean) => ({
        background: "transparent",
        border: "none",
        color: canRemove ? "var(--text-danger, #f23f43)" : "var(--text-muted, #80848e)",
        cursor: canRemove ? "pointer" as const : "not-allowed" as const,
        fontSize: 22,
        width: 32,
        height: 32,
        borderRadius: 6,
        transition: "background 0.1s",
    }),
    addBtn: {
        marginTop: 8,
        width: "100%",
        padding: 12,
        background: "transparent",
        color: "var(--text-muted, #80848e)",
        border: "1.5px dashed var(--background-modifier-accent, #3f4147)",
        borderRadius: 8,
        cursor: "pointer" as const,
        fontWeight: 600,
        fontSize: 13,
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
    },
    animGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
    },
    animBtn: (active: boolean) => ({
        padding: "10px 8px",
        background: active
            ? "var(--brand-experiment, #5865f2)"
            : "var(--background-tertiary, #1e1f22)",
        color: active ? "#fff" : "var(--text-normal, #dbdee1)",
        border: `1px solid ${active ? "var(--brand-experiment, #5865f2)" : "var(--background-modifier-accent, #3f4147)"}`,
        borderRadius: 8,
        cursor: "pointer" as const,
        fontWeight: 600,
        fontSize: 12,
        transition: "all 0.12s",
    }),
    speedHeader: {
        color: "var(--header-secondary, #b5bac1)",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
        marginBottom: 10,
        marginTop: 24,
        display: "flex",
        justifyContent: "space-between" as const,
    },
    speedValue: { color: "var(--text-normal, #dbdee1)", fontVariantNumeric: "tabular-nums" as const },
    slider: {
        width: "100%",
        accentColor: "var(--brand-experiment, #5865f2)",
        cursor: "pointer" as const,
    },
    section: { marginTop: 24 },
    fontSelect: {
        width: "100%",
        padding: "10px 12px",
        background: "var(--background-tertiary, #1e1f22)",
        color: "var(--text-normal, #dbdee1)",
        border: "1px solid var(--background-modifier-accent, #3f4147)",
        borderRadius: 8,
        fontSize: 14,
        cursor: "pointer" as const,
        outline: "none",
    },
};

interface ColorSwatchProps {
    color: string;
    onChange: (c: string) => void;
}

function ColorSwatch({ color, onChange }: ColorSwatchProps) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);

    return (
        <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: "2px solid var(--background-modifier-accent, #3f4147)",
                    background: color,
                    cursor: "pointer",
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)",
                    padding: 0,
                }}
                title="Pick color"
            />
            {open && (
                <div style={{
                    position: "absolute",
                    top: 48,
                    left: 0,
                    background: "var(--background-floating, #111214)",
                    border: "1px solid var(--background-modifier-accent, #3f4147)",
                    borderRadius: 10,
                    padding: 12,
                    boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
                    zIndex: 100,
                    minWidth: 220,
                }}>
                    <PickerBody color={color} onChange={onChange} />
                </div>
            )}
        </div>
    );
}

function PickerBody({ color, onChange }: { color: string; onChange: (c: string) => void }) {
    const initial = React.useMemo(() => hexToHsv(color), []);
    const [h, setH] = React.useState(initial.h);
    const [s, setS] = React.useState(initial.s);
    const [v, setV] = React.useState(initial.v);
    const [hex, setHex] = React.useState(color);
    const [r, setR] = React.useState(parseInt(color.slice(1, 3), 16));
    const [g, setG] = React.useState(parseInt(color.slice(3, 5), 16));
    const [b, setB] = React.useState(parseInt(color.slice(5, 7), 16));

    React.useEffect(() => {
        if (hsvToHex(h, s, v).toLowerCase() !== color.toLowerCase()) {
            const c = hexToHsv(color);
            setH(c.h); setS(c.s); setV(c.v); setHex(color);
            setR(parseInt(color.slice(1, 3), 16));
            setG(parseInt(color.slice(3, 5), 16));
            setB(parseInt(color.slice(5, 7), 16));
        }
    }, [color]);

    const commit = (nh: number, ns: number, nv: number) => {
        const next = hsvToHex(nh, ns, nv);
        setHex(next);
        setR(parseInt(next.slice(1, 3), 16));
        setG(parseInt(next.slice(3, 5), 16));
        setB(parseInt(next.slice(5, 7), 16));
        onChange(next);
    };

    const commitRgb = (nr: number, ng: number, nb: number) => {
        const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
        nr = clamp(nr); ng = clamp(ng); nb = clamp(nb);
        const next = "#" + nr.toString(16).padStart(2, "0") + ng.toString(16).padStart(2, "0") + nb.toString(16).padStart(2, "0");
        setR(nr); setG(ng); setB(nb); setHex(next);
        const cfg = hexToHsv(next);
        setH(cfg.h); setS(cfg.s); setV(cfg.v);
        onChange(next);
    };

    const svRef = React.useRef<HTMLDivElement>(null);
    const onSvDown = (e: React.MouseEvent | React.TouchEvent) => {
        const handle = (clientX: number, clientY: number) => {
            const r = svRef.current!.getBoundingClientRect();
            const ns = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
            const nv = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
            setS(ns); setV(nv); commit(h, ns, nv);
        };
        const evt = "touches" in e ? e.touches[0] : e;
        handle(evt.clientX, evt.clientY);
        const move = (ev: MouseEvent) => handle(ev.clientX, ev.clientY);
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    const hueRef = React.useRef<HTMLDivElement>(null);
    const onHueDown = (e: React.MouseEvent) => {
        const handle = (clientX: number) => {
            const r = hueRef.current!.getBoundingClientRect();
            const nh = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 360;
            setH(nh); commit(nh, s, v);
        };
        handle(e.clientX);
        const move = (ev: MouseEvent) => handle(ev.clientX);
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    const pureHue = hsvToHex(h, 1, 1);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: 200 }}>
            <div
                ref={svRef}
                onMouseDown={onSvDown}
                style={{
                    position: "relative",
                    width: "100%",
                    height: 140,
                    borderRadius: 6,
                    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})`,
                    cursor: "crosshair",
                    overflow: "hidden",
                }}
            >
                <div style={{
                    position: "absolute",
                    left: `calc(${s * 100}% - 6px)`,
                    top: `calc(${(1 - v) * 100}% - 6px)`,
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    border: "2px solid #fff",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                    pointerEvents: "none",
                }} />
            </div>
            <div
                ref={hueRef}
                onMouseDown={onHueDown}
                style={{
                    position: "relative",
                    width: "100%",
                    height: 14,
                    borderRadius: 7,
                    background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                    cursor: "ew-resize",
                }}
            >
                <div style={{
                    position: "absolute",
                    left: `calc(${(h / 360) * 100}% - 7px)`,
                    top: -2,
                    width: 14,
                    height: 18,
                    borderRadius: 4,
                    background: "#fff",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                    pointerEvents: "none",
                }} />
            </div>
            <input
                type="text"
                value={hex}
                onChange={e => setHex(e.target.value)}
                onBlur={() => {
                    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                        const cfg = hexToHsv(hex);
                        setH(cfg.h); setS(cfg.s); setV(cfg.v);
                        setR(parseInt(hex.slice(1, 3), 16));
                        setG(parseInt(hex.slice(3, 5), 16));
                        setB(parseInt(hex.slice(5, 7), 16));
                        onChange(hex.toLowerCase());
                    } else setHex(color);
                }}
                style={{
                    background: "var(--input-background, #1e1f22)",
                    color: "var(--text-normal, #dbdee1)",
                    border: "1px solid var(--background-modifier-accent, #3f4147)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontFamily: "var(--font-code, ui-monospace, monospace)",
                    fontSize: 13,
                    outline: "none",
                }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {(["R", "G", "B"] as const).map(c => {
                    const value = c === "R" ? r : c === "G" ? g : b;
                    const setter = (n: number) => {
                        if (c === "R") commitRgb(n, g, b);
                        else if (c === "G") commitRgb(r, n, b);
                        else commitRgb(r, g, n);
                    };
                    return (
                        <div key={c} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <input
                                type="number"
                                min={0}
                                max={255}
                                value={value}
                                onChange={e => setter(Number(e.target.value))}
                                style={{
                                    width: "100%",
                                    background: "var(--input-background, #1e1f22)",
                                    color: "var(--text-normal, #dbdee1)",
                                    border: "1px solid var(--background-modifier-accent, #3f4147)",
                                    borderRadius: 6,
                                    padding: "4px 6px",
                                    fontSize: 12,
                                    textAlign: "center",
                                    outline: "none",
                                    fontVariantNumeric: "tabular-nums",
                                }}
                            />
                            <span style={{ color: "var(--text-muted, #80848e)", fontSize: 10, fontWeight: 600 }}>{c}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

interface SvgGradientTextProps {
    text: string;
    stops: ColorStop[];
    font: string;
    anim: AnimationType;
    speed: number;
    slideDir: SlideDirection;
    waveDir: "out" | "in";
    glow?: boolean;
    glowStops?: ColorStop[];
    glowIntensity?: number;
    glowAnim?: GlowAnimationType;
}

function buildHueValues(baseHex: string, steps = 12): string {
    const { s, v } = hexToHsv(baseHex);
    const arr: string[] = [];
    for (let i = 0; i <= steps; i++) {
        arr.push(hsvToHex((i * 360) / steps, s, v));
    }
    return arr.join(";");
}

function SvgGradientText({ text, stops, font, anim, speed, slideDir, waveDir, glow, glowStops, glowIntensity, glowAnim }: SvgGradientTextProps) {
    const list = stops.length === 1 ? [stops[0], stops[0]] : stops;
    const colors = list.map(s => s.color);
    const linId = React.useMemo(() => `gn-lin-${Math.random().toString(36).slice(2, 8)}`, []);
    const durSec = 11 - speed;
    const dur = `${durSec}s`;
    const fontFamily = font
        ? (font.startsWith("var(")
            ? `${font}, var(--font-primary), sans-serif`
            : `"${font}", var(--font-primary), sans-serif`)
        : "inherit";
    const textRef = React.useRef<SVGTextElement>(null);
    const [fontTick, setFontTick] = React.useState(0);
    React.useEffect(() => {
        if (textRef.current) {
            textRef.current.style.setProperty("font-family", fontFamily, "important");
            textRef.current.setAttribute("font-family", fontFamily);
        }
        if (font) {
            ensureFontLoaded(font);
            if ((document as any).fonts?.load) {
                (document as any).fonts.load(`800 32px "${font}"`).then(() => {
                    if (textRef.current) {
                        textRef.current.style.setProperty("font-family", fontFamily, "important");
                        textRef.current.setAttribute("font-family", fontFamily);
                    }
                    setFontTick(t => t + 1);
                }).catch(() => {});
            }
        }
    }, [fontFamily, font]);

    const wrapStyle: React.CSSProperties = {};
    if (anim === "hue") wrapStyle.animation = `gradname-hue ${durSec}s linear infinite`;
    if (anim === "pulse") wrapStyle.animation = `gradname-pulse ${Math.max(0.5, durSec / 3)}s ease-in-out infinite`;
    if (glow) {
        const gList = (glowStops && glowStops.length > 0 ? glowStops : list).map(s => s.color);
        const intensity = Math.max(1, Math.min(10, glowIntensity ?? 6));
        const filters: string[] = [];
        for (let i = 0; i < gList.length; i++) {
            const c = gList[i];
            const r1 = (0.5 + intensity * 0.2).toFixed(1);
            const r2 = (1 + intensity * 0.4 + i * 0.2).toFixed(1);
            filters.push(
                `drop-shadow(var(--gn-glow-x, 0px) var(--gn-glow-y, 0px) calc(${r1}px * var(--gn-glow-strength, 1)) ${c})`,
                `drop-shadow(var(--gn-glow-x, 0px) var(--gn-glow-y, 0px) calc(${r2}px * var(--gn-glow-strength, 1)) ${c})`,
            );
        }
        wrapStyle.filter = filters.join(" ");
        const ga = (glowAnim ?? "orbit");
        if (ga !== "none") {
            const fast = ga === "spin-fast";
            const dur = fast ? Math.max(0.6, durSec / 3) : Math.max(2, durSec);
            const easing = (ga === "pulse" || ga === "bounce") ? "ease-in-out" : "linear";
            const a = `gn-glow-${ga} ${dur}s ${easing} infinite`;
            const existing = wrapStyle.animation as string | undefined;
            wrapStyle.animation = existing ? `${existing}, ${a}` : a;
        }
    }

    // Seamless slide: append first stop at end so tile wraps without seam
    const slideStops = anim === "slide" ? [...list, list[0]] : list;
    const hueDur = `${11 - speed}s`;
    const fillId = linId;

    const slideVertical = anim === "slide" && (slideDir === "up" || slideDir === "down");
    const lgX1 = slideVertical ? "0.5" : "0";
    const lgY1 = slideVertical ? "0" : "0.5";
    const lgX2 = slideVertical ? "0.5" : "1";
    const lgY2 = slideVertical ? "1" : "0.5";
    const slideTo = slideDir === "right" ? "1 0"
        : slideDir === "up" ? "0 -1"
        : slideDir === "down" ? "0 1"
        : "-1 0";

    const animKey = `${anim}-${speed}-${slideDir}-${waveDir}-${list.length}-${font}`;
    return (
        <div style={wrapStyle}>
            <svg key={animKey} width="100%" height="64" viewBox="0 0 800 64" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient
                        id={linId}
                        x1={lgX1}
                        y1={lgY1}
                        x2={lgX2}
                        y2={lgY2}
                        spreadMethod={anim === "slide" ? "repeat" : "pad"}
                    >
                        {anim === "wave" ? (
                            (() => {
                                const mirrored = list.length === 1
                                    ? [list[0], list[0]]
                                    : [...list, ...list.slice().reverse()];
                                const total = Math.max(1, mirrored.length - 1);
                                return mirrored.map((stp, i) => {
                                    const target = i / total;
                                    const isPrimary = i === 0 || i === mirrored.length - 1;
                                    return (
                                        <stop
                                            key={i}
                                            offset={isPrimary ? `${target}` : "0.5"}
                                            stopColor={stp.color}
                                        >
                                            {!isPrimary && (
                                                <animate
                                                    attributeName="offset"
                                                    values={waveDir === "in" ? `${target};0.5` : `0.5;${target}`}
                                                    dur={dur}
                                                    repeatCount="indefinite"
                                                />
                                            )}
                                            {stp.hueAnim && (
                                                <animate
                                                    attributeName="stop-color"
                                                    values={buildHueValues(stp.color)}
                                                    dur={hueDur}
                                                    repeatCount="indefinite"
                                                />
                                            )}
                                        </stop>
                                    );
                                });
                            })()
                        ) : (
                            slideStops.map((stp, i) => (
                                <stop
                                    key={i}
                                    offset={`${(i / Math.max(1, slideStops.length - 1)) * 100}%`}
                                    stopColor={stp.color}
                                >
                                    {stp.hueAnim && (
                                        <animate
                                            attributeName="stop-color"
                                            values={buildHueValues(stp.color)}
                                            dur={hueDur}
                                            repeatCount="indefinite"
                                        />
                                    )}
                                </stop>
                            ))
                        )}
                        {anim === "slide" && (
                            <animateTransform
                                attributeName="gradientTransform"
                                type="translate"
                                from="0 0"
                                to={slideTo}
                                dur={dur}
                                repeatCount="indefinite"
                            />
                        )}
                    </linearGradient>
                </defs>
                <text
                    ref={textRef}
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="32"
                    fontWeight="800"
                    fontFamily={fontFamily}
                    fill={`url(#${fillId})`}
                    data-font-tick={fontTick}
                >{text}</text>
            </svg>
        </div>
    );
}

interface StopRowProps {
    stop: ColorStop;
    onColorChange: (c: string) => void;
    onToggleHueAnim: () => void;
    onRemove: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnter: () => void;
    onDragLeave: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: () => void;
    onDragEnd: () => void;
    canRemove: boolean;
    speedSec: number;
    isDraggingSource: boolean;
}

function StopRow(props: StopRowProps) {
    const { stop, onColorChange, onToggleHueAnim, onRemove, canRemove, speedSec, isDraggingSource } = props;
    const { color, hueAnim } = stop;
    const [hex, setHex] = React.useState(color);

    React.useEffect(() => setHex(color), [color]);

    const animatedSwatchStyle: React.CSSProperties = hueAnim
        ? {
            background: color,
            animation: `gn-swatch-hue ${speedSec}s linear infinite`,
        }
        : { background: color };

    return (
        <div
            data-stop-row
            onDragEnter={props.onDragEnter}
            onDragLeave={props.onDragLeave}
            onDragOver={props.onDragOver}
            onDrop={props.onDrop}
            style={{
                ...styles.stopRow(),
                padding: 10,
                opacity: isDraggingSource ? 0.4 : 1,
                borderStyle: isDraggingSource ? "dashed" as const : "solid" as const,
            }}
        >
            <span
                draggable
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
                style={{ ...styles.dragHandle, cursor: "grab" }}
                title="Drag to reorder"
            >⋮⋮</span>
            {hueAnim ? (
                <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: "2px solid var(--background-modifier-accent, #3f4147)",
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)",
                    flexShrink: 0,
                    ...animatedSwatchStyle,
                }} title="Hue animation active — color cycles" />
            ) : (
                <ColorSwatch color={color} onChange={onColorChange} />
            )}
            <input
                type="text"
                value={hueAnim ? "rainbow" : hex}
                disabled={hueAnim}
                onChange={e => setHex(e.target.value)}
                onBlur={() => {
                    if (hueAnim) return;
                    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onColorChange(hex.toLowerCase());
                    else setHex(color);
                }}
                style={{
                    ...styles.hexInput,
                    opacity: hueAnim ? 0.5 : 1,
                    cursor: hueAnim ? "not-allowed" : "text",
                }}
            />
            <button
                onClick={onToggleHueAnim}
                title="Toggle hue cycle animation on this stop"
                style={{
                    background: hueAnim ? "var(--brand-experiment, #5865f2)" : "var(--background-tertiary, #1e1f22)",
                    color: hueAnim ? "#fff" : "var(--text-normal, #dbdee1)",
                    border: `1px solid ${hueAnim ? "var(--brand-experiment, #5865f2)" : "var(--background-modifier-accent, #3f4147)"}`,
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                }}
            >Hue</button>
            <button onClick={onRemove} disabled={!canRemove} title="Remove stop" style={styles.removeBtn(canRemove)}>×</button>
        </div>
    );
}

export function GradientNicknamePanel() {
    const [stops, setStops] = React.useState<ColorStop[]>(DEFAULT_STOPS);
    const [anim, setAnim] = React.useState<AnimationType>("none");
    const [speed, setSpeed] = React.useState<number>(6);
    const [font, setFont] = React.useState<string>("");
    const [slideDir, setSlideDir] = React.useState<SlideDirection>("left");
    const [waveDir, setWaveDir] = React.useState<"out" | "in">("out");
    const [glow, setGlow] = React.useState<boolean>(false);
    const [glowStops, setGlowStops] = React.useState<ColorStop[]>([{ color: "#ffffff" }]);
    const [glowIntensity, setGlowIntensity] = React.useState<number>(6);
    const [glowAnim, setGlowAnim] = React.useState<GlowAnimationType>("orbit");
    const [loaded, setLoaded] = React.useState(false);
    const [draggingIdx, setDraggingIdx] = React.useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);

    React.useEffect(() => {
        loadConfig().then(cfg => {
            if (cfg) {
                setStops(cfg.stops.length > 0 ? cfg.stops : DEFAULT_STOPS);
                setAnim(cfg.anim);
                if ((cfg as any).speed) setSpeed(clampSpeed((cfg as any).speed));
                if (cfg.font) setFont(cfg.font);
                if (cfg.slideDir) setSlideDir(cfg.slideDir);
                if (cfg.waveDir) setWaveDir(cfg.waveDir);
                if (cfg.glow) setGlow(true);
                if (cfg.glowStops && cfg.glowStops.length > 0) setGlowStops(cfg.glowStops);
                if (typeof cfg.glowIntensity === "number") setGlowIntensity(clampSpeed(cfg.glowIntensity));
                if (cfg.glowAnim) setGlowAnim(cfg.glowAnim);
            }
            setLoaded(true);
        });
    }, []);

    React.useEffect(() => {
        if (!loaded) return;
        const cfg: GradientConfig = { stops, anim };
        if (font) cfg.font = font;
        if (slideDir !== "left") cfg.slideDir = slideDir;
        if (waveDir !== "out") cfg.waveDir = waveDir;
        if (glow) {
            cfg.glow = true;
            cfg.glowStops = glowStops;
            cfg.glowIntensity = glowIntensity;
            cfg.glowAnim = glowAnim;
        }
        const currentMutedGuilds = getPrefs().mutedGuilds.slice(0, 5);
        if (currentMutedGuilds.length > 0) cfg.mutedGuilds = currentMutedGuilds;
        (cfg as any).speed = speed;
        // Live render of self's gradient is driven solely by what's in the bio,
        // not the panel's local edit state. User must paste the encoded tag for
        // changes to take effect on their actual rendered name. This mirrors how
        // other users' gradients work (decoded from their bio).
        saveConfig(cfg).then(() => emitStorage(cfg));
    }, [stops, anim, speed, font, slideDir, waveDir, glow, glowStops, glowIntensity, glowAnim, loaded]);

    const updateStop = (i: number, color: string) =>
        setStops(prev => prev.map((s, idx) => (idx === i ? { ...s, color } : s)));
    const toggleHueAnim = (i: number) =>
        setStops(prev => prev.map((s, idx) => (idx === i ? { ...s, hueAnim: !s.hueAnim } : s)));
    const removeStop = (i: number) => {
        if (stops.length <= 1) return;
        setStops(prev => prev.filter((_, idx) => idx !== i));
    };
    const addStop = () => setStops(prev => [...prev, { color: "#ffffff" }]);

    const onDragStart = (i: number) => (e: React.DragEvent) => {
        // Reset any stale drag state from a previous interrupted drag (some
        // Chromium edge cases skip dragend, leaving state stuck so subsequent
        // drags get short-circuited by the early-return in onDrop).
        setDragOverIdx(null);
        setDraggingIdx(i);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
    };
    const onDragEnter = (i: number) => () => setDragOverIdx(i);
    const onDragLeave = () => setDragOverIdx(null);
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };
    const onDrop = (target: number) => () => {
        const src = draggingIdx;
        setDraggingIdx(null);
        setDragOverIdx(null);
        if (src === null || src === target) return;
        setStops(prev => {
            const next = [...prev];
            const [moved] = next.splice(src, 1);
            next.splice(target, 0, moved);
            return next;
        });
    };
    const onDragEnd = () => {
        setDraggingIdx(null);
        setDragOverIdx(null);
    };

    const previewName = UserStore?.getCurrentUser?.()?.globalName
        ?? UserStore?.getCurrentUser?.()?.username
        ?? "Your Name";

    const [prefs, setPrefs] = React.useState(getPrefs());
    React.useEffect(() => {
        const unsub = subscribePrefs(() => setPrefs({ ...getPrefs() }));
        return () => { unsub(); };
    }, []);
    const enabled = prefs.enabled;

    return (
        <div style={styles.backdrop}>
            <div style={styles.card}>
                <div style={styles.headerRow}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h3 style={styles.title}>Gradient Nickname</h3>
                        <span style={styles.badge}>Plugin</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <CopyBioTagButton cfg={{
                            stops, anim, slideDir, waveDir,
                            font: font || undefined,
                            glow: glow || undefined,
                            glowStops: glow ? glowStops : undefined,
                            glowIntensity: glow ? glowIntensity : undefined,
                            glowAnim: glow ? glowAnim : undefined,
                            speed,
                        }} />
                        <ToggleSwitch on={enabled} onChange={v => updatePrefs({ enabled: v })} />
                    </div>
                </div>
                <div style={styles.description}>
                    Configure your nickname gradient. Other plugin users see it within ~60s.
                </div>

                <div style={{
                    maxHeight: enabled ? 4000 : 0,
                    overflow: "hidden",
                    opacity: enabled ? 1 : 0,
                    transition: "max-height 350ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms ease",
                    pointerEvents: enabled ? "auto" : "none",
                }} aria-hidden={!enabled}>

                <div style={styles.previewWrap}>
                    <SvgGradientText
                        text={previewName}
                        stops={stops}
                        font={font}
                        anim={anim}
                        speed={speed}
                        slideDir={slideDir}
                        waveDir={waveDir}
                        glow={glow}
                        glowStops={glowStops}
                        glowIntensity={glowIntensity}
                        glowAnim={glowAnim}
                    />
                </div>

                <div style={styles.sectionLabel}>Color Stops</div>
                <div style={styles.stopsList}>
                    {stops.map((s, i) => {
                        return (
                            <React.Fragment key={i}>
                                <StopRow
                                    stop={s}
                                    isDraggingSource={draggingIdx === i}
                                    onColorChange={col => updateStop(i, col)}
                                    onToggleHueAnim={() => toggleHueAnim(i)}
                                    onRemove={() => removeStop(i)}
                                    onDragStart={onDragStart(i)}
                                    onDragEnter={onDragEnter(i)}
                                    onDragLeave={onDragLeave}
                                    onDragOver={onDragOver}
                                    onDrop={onDrop(i)}
                                    onDragEnd={onDragEnd}
                                    canRemove={stops.length > 1}
                                    speedSec={11 - speed}
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
                <button onClick={addStop} style={styles.addBtn}>+ Add color stop</button>

                <div style={styles.section}>
                    <div style={styles.sectionLabel}>Animation</div>
                    <div style={styles.animGrid}>
                        {ANIMS.map(a => (
                            <button
                                key={a.value}
                                onClick={() => setAnim(a.value)}
                                style={styles.animBtn(anim === a.value)}
                            >{a.label}</button>
                        ))}
                    </div>
                </div>

                {anim === "slide" && (
                    <div style={styles.section}>
                        <div style={styles.sectionLabel}>Slide Direction</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                            <button onClick={() => setSlideDir("left")} style={styles.animBtn(slideDir === "left")}>← Left</button>
                            <button onClick={() => setSlideDir("right")} style={styles.animBtn(slideDir === "right")}>Right →</button>
                            <button onClick={() => setSlideDir("up")} style={styles.animBtn(slideDir === "up")}>↑ Up</button>
                            <button onClick={() => setSlideDir("down")} style={styles.animBtn(slideDir === "down")}>↓ Down</button>
                        </div>
                    </div>
                )}


                {anim !== "none" && (
                    <div>
                        <div style={styles.speedHeader}>
                            <span>Speed</span>
                            <span style={styles.speedValue}>{speed}/10</span>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={10}
                            step={1}
                            value={speed}
                            onChange={e => setSpeed(clampSpeed(Number(e.target.value)))}
                            style={styles.slider}
                        />
                    </div>
                )}

                <div style={styles.section}>
                    <div style={styles.sectionLabel}>Font</div>
                    <select
                        value={font}
                        onChange={e => setFont(e.target.value)}
                        style={styles.fontSelect}
                    >
                        {FONTS.map(f => (
                            <option key={f.value} value={f.value} style={{ fontFamily: f.value || "inherit" }}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div style={{ ...styles.section, opacity: 0.4, pointerEvents: "none" as const }} aria-disabled="true">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ ...styles.sectionLabel, marginBottom: 0, marginTop: 0 }}>Glow</div>
                            <span style={{
                                background: "var(--background-modifier-accent, #3f4147)",
                                color: "var(--text-muted, #80848e)",
                                fontSize: 9,
                                fontWeight: 700,
                                textTransform: "uppercase" as const,
                                padding: "2px 6px",
                                borderRadius: 8,
                                letterSpacing: 0.5,
                            }}>Coming soon</span>
                        </div>
                        <ToggleSwitch on={false} onChange={() => {}} />
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        Glow effect is in development. Enable will arrive in a future update.
                    </div>
                </div>

                </div>
            </div>
        </div>
    );
}

const BIO_LIMIT = 190;

function CopyBioTagButton({ cfg }: { cfg: any }) {
    const [copied, setCopied] = React.useState(false);
    const tag = React.useMemo(() => encode(cfg), [JSON.stringify(cfg)]);
    const overLimit = tag.length > BIO_LIMIT;
    const remaining = BIO_LIMIT - tag.length;

    const onCopy = async () => {
        try {
            await navigator.clipboard.writeText(tag);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            if (overLimit && Toasts) {
                Toasts.show({
                    message: `Tag is ${tag.length} chars but Discord's bio limit is ${BIO_LIMIT}. It won't fit — remove some stops or disable glow.`,
                    type: Toasts.Type?.FAILURE ?? 2,
                    id: Toasts.genId?.() ?? String(Date.now()),
                    options: { duration: 5000, position: Toasts.Position?.BOTTOM ?? 1 },
                });
            }
        } catch (e) {
            console.error("[GradientNickname] clipboard write failed", e);
        }
    };

    const tooltipText = "Paste this invisible tag into User Settings → Profiles → About Me. Other plugin users will see your gradient. Doing it manually avoids automation rules.";

    const renderButton = (extraProps: Record<string, any> = {}) => Button ? (
        <Button
            {...extraProps}
            onClick={onCopy}
            color={copied ? Button.Colors.GREEN : Button.Colors.BRAND}
            size={Button.Sizes.SMALL}
            look={Button.Looks.FILLED}
        >
            {copied ? "Copied ✓" : "Copy bio tag"}
        </Button>
    ) : (
        <button
            {...extraProps}
            onClick={onCopy}
            title={tooltipText}
            style={{
                background: copied ? "var(--status-positive)" : "var(--brand-experiment)",
                color: "#fff",
                border: "none",
                borderRadius: 3,
                padding: "2px 16px",
                minHeight: 32,
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
            }}
        >{copied ? "Copied ✓" : "Copy bio tag"}</button>
    );

    const buttonNode = Tooltip
        ? <Tooltip text={tooltipText}>{(tooltipProps: any) => renderButton(tooltipProps)}</Tooltip>
        : renderButton({ title: tooltipText });

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            {buttonNode}
            <span style={{
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
                color: overLimit ? "var(--text-danger, #f23f43)" : "var(--text-muted, #80848e)",
                fontWeight: overLimit ? 700 : 400,
            }}>
                {tag.length}/{BIO_LIMIT} ({remaining >= 0 ? `${remaining} left` : `${-remaining} over`})
            </span>
        </div>
    );
}


const GLOW_ANIMS: { value: GlowAnimationType; label: string }[] = [
    { value: "none", label: "None" },
    { value: "orbit", label: "Orbit 360°" },
    { value: "spin-fast", label: "Fast Spin" },
    { value: "pulse", label: "Pulse" },
    { value: "wave", label: "Wave ↔" },
    { value: "bounce", label: "Bounce ↑↓" },
    { value: "flicker", label: "Flicker" },
];

function GlowEditor({
    stops, setStops, intensity, setIntensity, glowAnim, setGlowAnim,
}: {
    stops: ColorStop[];
    setStops: (s: ColorStop[]) => void;
    intensity: number;
    setIntensity: (n: number) => void;
    glowAnim: GlowAnimationType;
    setGlowAnim: (a: GlowAnimationType) => void;
}) {
    const updateStop = (i: number, color: string) =>
        setStops(stops.map((s, idx) => (idx === i ? { ...s, color } : s)));
    const removeStop = (i: number) => {
        if (stops.length <= 1) return;
        setStops(stops.filter((_, idx) => idx !== i));
    };
    const addStop = () => setStops([...stops, { color: "#ffffff" }]);

    return (
        <div>
            <div style={{ ...styles.stopsList, marginTop: 4 }}>
                {stops.map((s, i) => (
                    <GlowStopRow
                        key={i}
                        stop={s}
                        onColorChange={c => updateStop(i, c)}
                        onRemove={() => removeStop(i)}
                        canRemove={stops.length > 1}
                    />
                ))}
            </div>
            <button onClick={addStop} style={{ ...styles.addBtn, marginTop: 8 }}>+ Add glow color</button>

            <div style={{ ...styles.sectionLabel, marginTop: 18 }}>Animation</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {GLOW_ANIMS.map(a => (
                    <button
                        key={a.value}
                        onClick={() => setGlowAnim(a.value)}
                        style={styles.animBtn(glowAnim === a.value)}
                    >{a.label}</button>
                ))}
            </div>

            <div style={styles.speedHeader}>
                <span>Intensity</span>
                <span style={styles.speedValue}>{intensity}/10</span>
            </div>
            <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={intensity}
                onChange={e => setIntensity(Math.max(1, Math.min(10, Math.round(Number(e.target.value)))))}
                style={styles.slider}
            />
        </div>
    );
}

function GlowStopRow({ stop, onColorChange, onRemove, canRemove }: {
    stop: ColorStop;
    onColorChange: (c: string) => void;
    onRemove: () => void;
    canRemove: boolean;
}) {
    const [hex, setHex] = React.useState(stop.color);
    React.useEffect(() => setHex(stop.color), [stop.color]);
    return (
        <div style={{ ...styles.stopRow(), padding: 10 }}>
            <ColorSwatch color={stop.color} onChange={onColorChange} />
            <input
                type="text"
                value={hex}
                onChange={e => setHex(e.target.value)}
                onBlur={() => {
                    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onColorChange(hex.toLowerCase());
                    else setHex(stop.color);
                }}
                style={styles.hexInput}
            />
            <button onClick={onRemove} disabled={!canRemove} title="Remove" style={styles.removeBtn(canRemove)}>×</button>
        </div>
    );
}

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => onChange(!on)}
            title={on ? "Disable plugin" : "Enable plugin"}
            style={{
                width: 46,
                height: 26,
                borderRadius: 13,
                background: on ? "var(--brand-experiment, #5865f2)" : "var(--background-tertiary, #1e1f22)",
                border: `1px solid ${on ? "var(--brand-experiment, #5865f2)" : "var(--background-modifier-accent, #3f4147)"}`,
                position: "relative",
                cursor: "pointer",
                transition: "background 200ms ease, border-color 200ms ease",
                padding: 0,
                flexShrink: 0,
            }}
        >
            <span style={{
                position: "absolute",
                top: 2,
                left: on ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                transition: "left 220ms cubic-bezier(0.4, 0, 0.2, 1)",
            }} />
        </button>
    );
}

