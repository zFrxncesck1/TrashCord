import { DataStore }            from "@api/index";
import { UserAreaButton }       from "@api/UserArea";
import { definePluginSettings } from "@api/Settings";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, RestAPI, Toasts } from "@webpack/common";

const SK        = "AvatarRotator_v6";
const DEFAULT_S = 300;
const WARN_S    = 60;
const CIRC_R    = 115;
const CIRC_D    = CIRC_R * 2;
const CONT_H    = 300;
const EXP_S     = 512;
const ACCEPT    = ".jpg,.jpeg,.jfif,.png,.gif,.webp,.avif";
const ALL_EXTS  = ["png", "jpg", "jpeg", "jfif", "gif", "webp", "avif"] as const;
type Ext = typeof ALL_EXTS[number];

const C = {
    bg1:    "var(--background-tertiary)",
    bg2:    "rgba(156,103,255,.09)",
    line:   "rgba(255,255,255,.07)",
    accent: "#9c67ff",
    aD:     "rgba(156,103,255,.18)",
    green:  "#3ba55c",
    red:    "#ed4245",
    text:   "#e0d8ff",
    sub:    "var(--text-muted)",
    warn:   "#faa61a",
};
const extColors: Record<string, string> = {
    png: "#5865f2", jpg: "#43b581", jpeg: "#43b581", jfif: "#4a9e70",
    gif: "#faa61a", webp: "#9c67ff", avif: "#00b0f4",
};

interface AvatarEntry { id: string; label: string; data: string; }
interface StoreData   { avatars: AvatarEntry[]; seqIndex: number; shuffleQueue: number[]; }

let avatars:      AvatarEntry[] = [];
let seqIndex      = 0;
let shuffleQueue: number[]      = [];
let rotatorTimer: ReturnType<typeof setTimeout> | null = null;
let pluginActive  = false;

const settings = definePluginSettings({
    enabled:            { type: OptionType.BOOLEAN, description: "Enable automatic avatar rotation",                                                                  default: false,    onChange: (v: boolean) => v ? startRotator(false) : stopRotator() },
    intervalSeconds:    { type: OptionType.NUMBER,  description: "Change interval in seconds (recommended min 60 - Discord rate-limits ~2 per 10 min)",              default: DEFAULT_S },
    random:             { type: OptionType.BOOLEAN, description: "Random order - no repeats until every avatar is shown once",                                        default: true },
    showToast:          { type: OptionType.BOOLEAN, description: "Show toast notifications (errors included)",                                                        default: false },
    showButton:         { type: OptionType.BOOLEAN, description: "Show AvatarRotator button in the user area (bottom-left)",                                         default: true },
    excludedExtensions: { type: OptionType.STRING,  description: "Comma-separated extensions to skip during rotation (e.g. gif,avif)",                               default: "" },
});

const saveData = (): Promise<void> => DataStore.set(SK, { avatars, seqIndex, shuffleQueue } as StoreData);

function getExcluded(): string[] {
    return settings.store.excludedExtensions.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
function setExcluded(arr: string[]) { settings.store.excludedExtensions = arr.join(","); }

function sfShuffle(len: number): number[] {
    const a = Array.from({ length: len }, (_, i) => i);
    for (let i = len - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

function toast(msg: string, type: Toasts.Type = Toasts.Type.SUCCESS) {
    if (!settings.store.showToast) return;
    Toasts.show({ message: msg, type, id: Toasts.genId() });
}

function getExt(data: string): string {
    const m = data.match(/^data:image\/([a-z0-9]+);/i);
    if (!m) return "?";
    return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
}

function isGif(data: string) { return /^data:image\/gif;/i.test(data); }

function freshGif(data: string): string {
    try {
        const b64 = data.split(",")[1];
        if (!b64) return data;
        const bin = atob(b64);
        const src = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) src[i] = bin.charCodeAt(i);
        const tag = new TextEncoder().encode("ar-" + Date.now().toString(36));
        const block = new Uint8Array(tag.length + 4);
        block[0] = 0x21; block[1] = 0xFE; block[2] = tag.length;
        block.set(tag, 3); block[tag.length + 3] = 0x00;
        const merged = new Uint8Array(src.length + block.length - 1);
        merged.set(src.subarray(0, src.length - 1));
        merged.set(block, src.length - 1);
        merged[merged.length - 1] = 0x3B;
        let out = "";
        merged.forEach(b => out += String.fromCharCode(b));
        return "data:image/gif;base64," + btoa(out);
    } catch { return data; }
}

function fmtSec(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), r = s % 60;
    if (s < 3600) return r === 0 ? `${m}m` : `${m}m ${r}s`;
    const h = Math.floor(s / 3600), mr = Math.floor((s % 3600) / 60);
    return mr === 0 ? `${h}h` : `${h}h ${mr}m`;
}

function fmtPreset(s: number) {
    if (s % 3600 === 0) return `${s / 3600}h`;
    if (s % 60 === 0) return `${s / 60}m`;
    return `${s}s`;
}

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function reorderArr<T>(arr: T[], from: number, to: number): T[] { const r = [...arr]; const [x] = r.splice(from, 1); r.splice(to, 0, x); return r; }

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
}

async function fileToBase64(f: File): Promise<string> { return blobToDataUrl(f); }

async function prepareForDiscord(data: string): Promise<string> {
    const ext    = getExt(data);
    const okExts = ["png", "jpg", "jpeg", "gif", "webp"];
    const bytes  = (data.split(",")[1]?.length ?? 0) * 0.75;
    if (okExts.includes(ext) && bytes < 8_000_000) return data;
    return new Promise<string>((res, rej) => {
        const img = new Image();
        img.onload = () => {
            let w = img.naturalWidth, h = img.naturalHeight;
            const MAX = 1024;
            if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
            const c = document.createElement("canvas"); c.width = w; c.height = h;
            c.getContext("2d")!.drawImage(img, 0, 0, w, h);
            res(c.toDataURL("image/png"));
        };
        img.onerror = rej; img.src = data;
    });
}

async function applyAvatar(entry: AvatarEntry): Promise<void> {
    try {
        let data = await prepareForDiscord(entry.data);
        if (isGif(data)) data = freshGif(data);
        if (!data.split(",")[1] || data.split(",")[1].length < 10) throw new Error("Image data is invalid or too small");
        await RestAPI.patch({ url: "/users/@me", body: { avatar: data } });
        toast(`Avatar - ${entry.label}`);
    } catch (e: any) {
        const msg = e?.body?.errors?.avatar?._errors?.[0]?.message ?? e?.body?.message ?? e?.message ?? "Unknown";
        toast(`Failed: ${msg}`, Toasts.Type.FAILURE);
    }
}

function getActive(): AvatarEntry[] {
    const excl = getExcluded();
    return excl.length ? avatars.filter(a => !excl.includes(getExt(a.data))) : [...avatars];
}

async function rotateNext(): Promise<void> {
    if (!pluginActive) return;
    const active = getActive();
    if (!active.length) { schedule(); return; }
    let idx: number;
    if (settings.store.random) { if (!shuffleQueue.length) shuffleQueue = sfShuffle(active.length); idx = shuffleQueue.shift()!; }
    else { idx = seqIndex % active.length; seqIndex = (seqIndex + 1) % active.length; }
    if (idx >= active.length) idx = 0;
    await applyAvatar(active[idx]);
    await saveData();
    schedule();
}

function schedule() {
    if (rotatorTimer) clearTimeout(rotatorTimer);
    if (!settings.store.enabled || !pluginActive || !getActive().length) return;
    rotatorTimer = setTimeout(rotateNext, Math.max(1, settings.store.intervalSeconds || DEFAULT_S) * 1000);
}

function startRotator(immediate = false) {
    if (!pluginActive) return;
    if (rotatorTimer) clearTimeout(rotatorTimer);
    const active = getActive();
    if (settings.store.random) shuffleQueue = sfShuffle(active.length);
    if (immediate && active.length) rotateNext(); else schedule();
    toast("Avatar Rotator started");
}

function stopRotator() {
    if (rotatorTimer) { clearTimeout(rotatorTimer); rotatorTimer = null; }
    toast("Avatar Rotator stopped", Toasts.Type.MESSAGE);
}

function exportJSON() {
    const a = Object.assign(document.createElement("a"), {
        href: "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ version: 6, avatars: avatars.map(({ label, data }) => ({ label, data })) }, null, 2)),
        download: "avatar-rotator.json",
    });
    a.click(); toast("Exported");
}

async function importJSON(file: File): Promise<AvatarEntry[]> {
    const obj = JSON.parse(await file.text());
    const raw = Array.isArray(obj) ? obj : (obj.avatars ?? []);
    return raw.filter((x: any) => typeof x.data === "string" && typeof x.label === "string").map((x: any) => ({ id: uid(), label: x.label, data: x.data }));
}

const iStyle: React.CSSProperties = {
    flex: 1, background: "rgba(0,0,0,.38)", border: "1px solid rgba(255,255,255,.08)",
    borderRadius: 6, color: C.text, fontSize: 13, padding: "6px 10px", outline: "none", minWidth: 0,
};

function Hr() { return <div style={{ height: 1, background: C.line, margin: "12px 0" }} />; }

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
    return (
        <div onClick={onChange} style={{ width: 34, height: 18, borderRadius: 9, flexShrink: 0, cursor: "pointer", background: value ? C.accent : "rgba(255,255,255,.13)", position: "relative", userSelect: "none" }}>
            <div style={{ position: "absolute", top: 2, left: value ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff" }} />
        </div>
    );
}

function SecLabel({ children }: { children: React.ReactNode }) {
    return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: C.sub, textTransform: "uppercase", marginBottom: 6 }}>{children}</div>;
}

function ExtBadge({ ext, excluded }: { ext: string; excluded?: boolean }) {
    const color = excluded ? "#6b7280" : (extColors[ext] ?? "#6b7280");
    return (
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 4, background: color + "28", color, border: `1px solid ${color}55`, textTransform: "uppercase", flexShrink: 0, textDecoration: excluded ? "line-through" : "none" }}>
            {ext}
        </span>
    );
}

function Btn({ onClick, color, bg, border, children, disabled, style }: {
    onClick: () => void; color: string; bg: string; border: string; children: React.ReactNode;
    disabled?: boolean; style?: React.CSSProperties;
}) {
    return (
        <button onClick={disabled ? undefined : onClick}
            style={{ padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", outline: "none", border, background: bg, color, opacity: disabled ? 0.45 : 1, userSelect: "none", ...style }}>
            {children}
        </button>
    );
}

function ExtFilterChips({ excluded, onChange }: { excluded: string[]; onChange: (e: string[]) => void }) {
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {ALL_EXTS.map(ext => {
                const isEx = excluded.includes(ext);
                const color = isEx ? "#6b7280" : (extColors[ext] ?? "#6b7280");
                return (
                    <button key={ext} onClick={() => onChange(isEx ? excluded.filter(e => e !== ext) : [...excluded, ext])}
                        style={{ padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", outline: "none", border: `1px solid ${color}55`, background: color + "22", color, textDecoration: isEx ? "line-through" : "none", userSelect: "none" }}>
                        {ext.toUpperCase()}{isEx ? " ✕" : ""}
                    </button>
                );
            })}
        </div>
    );
}

function ExtFilterSection({ excluded, onChange }: { excluded: string[]; onChange: (e: string[]) => void }) {
    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div>
                    <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>Skip Extensions During Rotation</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>Tagged avatars stay in list but are skipped when cycling</div>
                </div>
                {excluded.length > 0 && (
                    <button onClick={() => onChange([])} style={{ fontSize: 11, color: C.red, background: "none", border: "none", cursor: "pointer", outline: "none" }}>Clear all</button>
                )}
            </div>
            <ExtFilterChips excluded={excluded} onChange={onChange} />
        </div>
    );
}

function CropModal({ src, onApply, onSkip, modalProps }: { src: string; onApply: (d: string) => void; onSkip: () => void; modalProps: any; }) {
    const [loaded,   setLoaded]   = React.useState(false);
    const [imgNat,   setImgNat]   = React.useState({ w: 1, h: 1 });
    const [minZoom,  setMinZoom]  = React.useState(1);
    const [zoom,     setZoomS]    = React.useState(1);
    const [rotation, setRotS]     = React.useState(0);
    const [flipH,    setFlipH]    = React.useState(false);
    const [flipV,    setFlipV]    = React.useState(false);
    const [offset,   setOffS]     = React.useState({ x: 0, y: 0 });

    const zoomR  = React.useRef(1);
    const rotR   = React.useRef(0);
    const offR   = React.useRef({ x: 0, y: 0 });
    const natR   = React.useRef({ w: 1, h: 1 });
    const minZR  = React.useRef(1);
    const drag   = React.useRef(false);
    const lastP  = React.useRef({ x: 0, y: 0 });
    const maskId = React.useRef("cm-" + uid());
    const gif    = isGif(src);

    const sync = (o: { x: number; y: number }, z: number, r: number) => {
        const rad = r * Math.PI / 180;
        const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
        const { w, h } = natR.current;
        const bbW = (w * cos + h * sin) * z;
        const bbH = (w * sin + h * cos) * z;
        const mx = Math.max(0, bbW / 2 - CIRC_R);
        const my = Math.max(0, bbH / 2 - CIRC_R);
        const cx = Math.max(-mx, Math.min(mx, o.x));
        const cy = Math.max(-my, Math.min(my, o.y));
        return { x: cx, y: cy };
    };

    const setAll = (o: { x: number; y: number }, z: number, r: number, fH = flipH, fV = flipV) => {
        const clamped = sync(o, z, r);
        zoomR.current = z; rotR.current = r; offR.current = clamped;
        setZoomS(z); setRotS(r); setOffS(clamped); setFlipH(fH); setFlipV(fV);
    };

    React.useEffect(() => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth, h = img.naturalHeight;
            const mz = Math.max(CIRC_D / w, CIRC_D / h);
            natR.current = { w, h }; minZR.current = mz;
            setImgNat({ w, h }); setMinZoom(mz);
            setAll({ x: 0, y: 0 }, mz, 0, false, false);
            setLoaded(true);
        };
        img.src = src;
    }, []);

    const doApply = async () => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>(r => { img.onload = () => r(); img.src = src; });
        const canvas = document.createElement("canvas");
        canvas.width = EXP_S; canvas.height = EXP_S;
        const ctx = canvas.getContext("2d")!;
        const ratio = EXP_S / CIRC_D;
        ctx.save();
        ctx.translate(EXP_S / 2 + offR.current.x * ratio, EXP_S / 2 + offR.current.y * ratio);
        ctx.rotate(rotR.current * Math.PI / 180);
        ctx.scale((flipH ? -1 : 1) * zoomR.current * ratio, (flipV ? -1 : 1) * zoomR.current * ratio);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        ctx.restore();
        onApply(canvas.toDataURL("image/png"));
        modalProps.onClose();
    };

    return (
        <ModalRoot {...modalProps} size="medium">
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: C.aD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="9" stroke={C.accent} strokeWidth="2"/>
                            <circle cx="12" cy="12" r="4" fill={C.accent}/>
                            <line x1="12" y1="1" x2="12" y2="4"   stroke={C.accent} strokeWidth="2" strokeLinecap="round"/>
                            <line x1="12" y1="20" x2="12" y2="23" stroke={C.accent} strokeWidth="2" strokeLinecap="round"/>
                            <line x1="1" y1="12" x2="4" y2="12"   stroke={C.accent} strokeWidth="2" strokeLinecap="round"/>
                            <line x1="20" y1="12" x2="23" y2="12" stroke={C.accent} strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                    </div>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Edit Avatar</div>
                        <div style={{ fontSize: 11, color: C.sub }}>Drag to move - Zoom - Rotate - Flip{gif ? " - GIF animates here" : ""}</div>
                    </div>
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: 0, overflow: "hidden" }}>
                <div
                    style={{ width: "100%", height: CONT_H, background: "#0b0b0e", position: "relative", cursor: loaded ? "grab" : "default", userSelect: "none", overflow: "hidden" }}
                    onPointerDown={e => {
                        if (!loaded) return;
                        drag.current = true;
                        lastP.current = { x: e.clientX, y: e.clientY };
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        e.preventDefault();
                    }}
                    onPointerMove={e => {
                        if (!drag.current) return;
                        const dx = e.clientX - lastP.current.x;
                        const dy = e.clientY - lastP.current.y;
                        lastP.current = { x: e.clientX, y: e.clientY };
                        const newOff = sync({ x: offR.current.x + dx, y: offR.current.y + dy }, zoomR.current, rotR.current);
                        offR.current = newOff;
                        setOffS({ ...newOff });
                    }}
                    onPointerUp={() => { drag.current = false; }}
                    onPointerCancel={() => { drag.current = false; }}
                >
                    {loaded && (
                        <div style={{
                            position:    "absolute",
                            left:        "50%",
                            top:         "50%",
                            width:       0,
                            height:      0,
                            transform:   `translate(${offset.x}px, ${offset.y}px)`,
                        }}>
                            <img
                                src={src}
                                draggable={false}
                                style={{
                                    position:       "absolute",
                                    left:           0,
                                    top:            0,
                                    width:          imgNat.w,
                                    height:         imgNat.h,
                                    maxWidth:       "none",
                                    transform:      `translate(-50%, -50%) rotate(${rotation}deg) scale(${flipH ? -zoom : zoom}, ${flipV ? -zoom : zoom})`,
                                    transformOrigin:"center center",
                                    pointerEvents:  "none",
                                    userSelect:     "none",
                                    imageRendering: "auto",
                                }}
                            />
                        </div>
                    )}

                    {!loaded && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 13 }}>
                            Loading…
                        </div>
                    )}

                    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                        <defs>
                            <mask id={maskId.current}>
                                <rect width="100%" height="100%" fill="white"/>
                                <circle cx="50%" cy="50%" r={CIRC_R} fill="black"/>
                            </mask>
                        </defs>
                        <rect width="100%" height="100%" fill="rgba(0,0,0,.72)" mask={`url(#${maskId.current})`}/>
                        <circle cx="50%" cy="50%" r={CIRC_R} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="2.5"/>
                    </svg>
                </div>

                <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill={C.sub}>
                            <path fillRule="evenodd" clipRule="evenodd" d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm13.35 8.13 3.5 4.67c.37.5.02 1.2-.6 1.2H5.81a.75.75 0 0 1-.59-1.22l1.86-2.32a1.5 1.5 0 0 1 2.34 0l.5.64 2.23-2.97a2 2 0 0 1 3.2 0Z"/>
                        </svg>
                        <input
                            type="range" min={minZoom} max={minZoom * 4} step={0.0005} value={zoom} disabled={!loaded}
                            onChange={e => {
                                const z = Math.max(minZR.current, parseFloat(e.target.value));
                                const c = sync(offR.current, z, rotR.current);
                                zoomR.current = z; offR.current = c;
                                setZoomS(z); setOffS({ ...c });
                            }}
                            style={{ flex: 1, accentColor: C.accent, cursor: loaded ? "pointer" : "default" } as React.CSSProperties}
                        />
                        <svg width="19" height="19" viewBox="0 0 24 24" fill={C.sub}>
                            <path fillRule="evenodd" clipRule="evenodd" d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm13.35 8.13 3.5 4.67c.37.5.02 1.2-.6 1.2H5.81a.75.75 0 0 1-.59-1.22l1.86-2.32a1.5 1.5 0 0 1 2.34 0l.5.64 2.23-2.97a2 2 0 0 1 3.2 0Z"/>
                        </svg>
                    </div>

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Btn disabled={!loaded} color={C.accent} bg={C.aD} border={`1px solid ${C.accent}44`}
                            onClick={() => {
                                const nr = (rotR.current + 90) % 360;
                                rotR.current = nr;
                                const c = sync(offR.current, zoomR.current, nr);
                                offR.current = c;
                                setRotS(nr); setOffS({ ...c });
                            }}>
                            ↻ 90°
                        </Btn>
                        <Btn disabled={!loaded} color={flipH ? C.accent : C.sub} bg={flipH ? C.aD : "transparent"} border={`1px solid ${flipH ? C.accent : C.sub}44`}
                            onClick={() => setFlipH(f => !f)}>
                            ↔ Flip H
                        </Btn>
                        <Btn disabled={!loaded} color={flipV ? C.accent : C.sub} bg={flipV ? C.aD : "transparent"} border={`1px solid ${flipV ? C.accent : C.sub}44`}
                            onClick={() => setFlipV(f => !f)}>
                            ↕ Flip V
                        </Btn>
                    </div>

                    {gif && (
                        <div style={{ padding: "8px 11px", borderRadius: 7, background: `${C.warn}12`, border: `1px solid ${C.warn}33`, fontSize: 11, color: C.warn, lineHeight: 1.5 }}>
                            🎞 <b>GIF animates above.</b> <b>Apply</b> exports the current frame as static PNG. <b>Skip</b> keeps the original GIF - Nitro users see it animated; without Nitro Discord shows it static.
                        </div>
                    )}
                </div>
            </ModalContent>

            <ModalFooter separator={false}>
                <div style={{ display: "flex", width: "100%", alignItems: "center" }}>
                    <button disabled={!loaded} onClick={() => setAll({ x: 0, y: 0 }, minZR.current, 0, false, false)}
                        style={{ background: "none", border: "none", color: loaded ? C.text : C.sub, cursor: loaded ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 500, padding: "0 4px", outline: "none" }}>
                        Reset
                    </button>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <Btn onClick={() => { onSkip(); modalProps.onClose(); }} color={C.sub} bg="transparent" border={`1px solid ${C.line}`}>
                            Skip
                        </Btn>
                        <Btn disabled={!loaded} onClick={doApply} color="#fff" bg={loaded ? C.accent : "rgba(156,103,255,.3)"} border="none">
                            Apply
                        </Btn>
                    </div>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function openCropFor(data: string, onDone: (d: string) => void) {
    openModal(p => <CropModal src={data} onApply={onDone} onSkip={() => onDone(data)} modalProps={p} />);
}

function AvatarCard({
    entry, isDragged, isDragOver, isExcluded,
    onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
    onRemove, onApplyNow, onCrop, onRename,
}: {
    entry: AvatarEntry; isDragged: boolean; isDragOver: boolean; isExcluded: boolean;
    onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void; onDrop: (e: React.DragEvent) => void; onDragEnd: () => void;
    onRemove: () => void; onApplyNow: () => void; onCrop: () => void;
    onRename: (l: string) => void;
}) {
    const [editing,  setEditing]  = React.useState(false);
    const [editText, setEditText] = React.useState(entry.label);
    const ext = getExt(entry.data);

    React.useEffect(() => { setEditText(entry.label); }, [entry.label]);

    const commit = () => {
        const t = editText.trim();
        if (t && t !== entry.label) onRename(t); else setEditText(entry.label);
        setEditing(false);
    };

    return (
        <div
            draggable={!editing}
            onDragStart={editing ? undefined : onDragStart}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onDragEnd={onDragEnd}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, marginBottom: 4, background: isDragOver ? C.bg2 : C.bg1, border: `1px solid ${isDragOver ? C.accent : C.line}`, opacity: isDragged ? 0.3 : isExcluded ? 0.5 : 1, cursor: editing ? "default" : "grab", userSelect: "none" }}
        >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="var(--text-muted)" style={{ flexShrink: 0 }}>
                <rect y="1" width="12" height="1.8" rx="0.9"/>
                <rect y="5" width="12" height="1.8" rx="0.9"/>
                <rect y="9" width="12" height="1.8" rx="0.9"/>
            </svg>
            <div style={{ position: "relative", flexShrink: 0 }}>
                <img src={entry.data} alt="" draggable={false} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", border: `2px solid ${isExcluded ? "#6b7280" : ext === "gif" ? C.warn : C.accent}`, display: "block" }} />
                {isExcluded && <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 14 }}>⛔</span></div>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                {editing
                    ? <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                        onBlur={commit}
                        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditText(entry.label); setEditing(false); } e.stopPropagation(); }}
                        onClick={e => e.stopPropagation()}
                        style={{ ...iStyle, fontSize: 12, padding: "2px 6px", width: "100%" }} />
                    : (
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span title="Double-click to rename" onDoubleClick={e => { e.stopPropagation(); setEditing(true); setEditText(entry.label); }}
                                style={{ fontSize: 13, color: isExcluded ? C.sub : C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}>
                                {entry.label}
                            </span>
                            <ExtBadge ext={ext} excluded={isExcluded} />
                            {ext === "gif" && !isExcluded && <span style={{ fontSize: 10, color: C.warn, flexShrink: 0 }}>⚠ Nitro</span>}
                            {isExcluded && <span style={{ fontSize: 10, color: C.sub, flexShrink: 0 }}>skipped</span>}
                        </div>
                    )
                }
            </div>
            <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                {[
                    { color: C.accent, title: "Use now",   onClick: onApplyNow, icon: <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/> },
                    { color: "#00b0f4", title: "Edit/Crop", onClick: onCrop,    icon: <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/> },
                    { color: C.red,    title: "Remove",    onClick: onRemove,   icon: <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/> },
                ].map(({ color, title, onClick, icon }) => (
                    <button key={title} onClick={e => { e.stopPropagation(); onClick(); }} title={title}
                        style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, border: `1px solid ${color}33`, background: `${color}18`, color, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", outline: "none", padding: 0 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">{icon}</svg>
                    </button>
                ))}
            </div>
        </div>
    );
}

function AvatarRotatorModal({ modalProps, onToggle }: { modalProps: any; onToggle: () => void }) {
    const [list,       setList]        = React.useState<AvatarEntry[]>([...avatars]);
    const [urlInput,   setUrlInput]    = React.useState("");
    const [labelInput, setLabelInput]  = React.useState("");
    const [loading,    setLoading]     = React.useState(false);
    const [running,    setRunning]     = React.useState(() => rotatorTimer !== null);
    const [lSecStr,    setLSecStr]     = React.useState(() => String(settings.store.intervalSeconds ?? DEFAULT_S));
    const [lRandom,    setLRandom]     = React.useState(() => settings.store.random ?? true);
    const [lToast,     setLToast]      = React.useState(() => settings.store.showToast ?? true);
    const [excluded,   setExcludedS]   = React.useState(() => getExcluded());
    const [draggedIdx, setDraggedIdx]  = React.useState<number | null>(null);
    const [dragOverIdx,setDragOverIdx] = React.useState<number | null>(null);

    const sec        = parseInt(lSecStr) || DEFAULT_S;
    const activeCount = list.filter(a => !excluded.includes(getExt(a.data))).length;
    const warnSec    = sec > 0 && sec < WARN_S;
    const hasGifs    = list.some(e => isGif(e.data) && !excluded.includes("gif"));

    const commit = (next: AvatarEntry[]) => { avatars = next; setList([...next]); void saveData(); };

    const setExcl = (arr: string[]) => {
        setExcludedS(arr); setExcluded(arr);
        if (rotatorTimer) { clearTimeout(rotatorTimer); rotatorTimer = null; schedule(); }
    };

    const applyInterval = (s: number) => {
        settings.store.intervalSeconds = s;
        if (rotatorTimer) { clearTimeout(rotatorTimer); rotatorTimer = null; schedule(); }
    };

    const validateApply = () => {
        const s = Math.max(1, parseInt(lSecStr) || DEFAULT_S);
        setLSecStr(String(s)); applyInterval(s);
    };

    const setPreset = (s: number) => { setLSecStr(String(s)); applyInterval(s); };

    const toggleEnabled = () => {
        const next = !running;
        settings.store.enabled = next;
        if (next && activeCount > 0) { startRotator(false); setRunning(true); }
        else { stopRotator(); setRunning(false); }
        onToggle();
    };

    const toggleRandom = () => {
        const n = !lRandom; setLRandom(n); settings.store.random = n;
        if (n) shuffleQueue = sfShuffle(activeCount);
    };

    const toggleToast = () => {
        const n = !lToast; setLToast(n); settings.store.showToast = n;
    };

    const handleAddUrl = async () => {
        const url = urlInput.trim();
        if (!url) { toast("Please enter a URL", Toasts.Type.FAILURE); return; }
        let parsed: URL;
        try { parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(); }
        catch { toast("Invalid URL - must start with http:// or https://", Toasts.Type.FAILURE); return; }
        const label = labelInput.trim() || parsed.pathname.split("/").pop()?.replace(/\.[^.]+$/, "") || "Avatar";
        setLoading(true);
        toast("Fetching image…", Toasts.Type.MESSAGE);
        try {
            const ctrl    = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 15000);
            const res     = await fetch(url, { signal: ctrl.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const ct = res.headers.get("content-type") ?? "";
            if (ct && !ct.startsWith("image/") && !ct.startsWith("application/octet")) throw new Error(`Not an image (${ct})`);
            const blob = await res.blob();
            if (!blob.size) throw new Error("Empty response");
            if (blob.size > 50_000_000) throw new Error("Image too large (>50 MB)");
            const data = await blobToDataUrl(blob);
            if (!data.startsWith("data:image/")) throw new Error("Could not read image data");
            toast("Image loaded", Toasts.Type.SUCCESS);
            setLoading(false);
            openCropFor(data, cropped => { commit([...avatars, { id: uid(), label, data: cropped }]); setUrlInput(""); setLabelInput(""); toast(`Added "${label}"`); });
        } catch (e: any) {
            toast(e?.name === "AbortError" ? "Request timed out (15s)" : `Failed: ${e.message ?? "Unknown"}`, Toasts.Type.FAILURE);
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        setLoading(true);
        if (files.length === 1) {
            try {
                const data = await fileToBase64(files[0]);
                setLoading(false);
                openCropFor(data, cropped => { commit([...avatars, { id: uid(), label: files[0].name.replace(/\.[^.]+$/, ""), data: cropped }]); toast("Added"); });
            } catch { toast("Failed to read file", Toasts.Type.FAILURE); setLoading(false); }
        } else {
            const entries: AvatarEntry[] = [];
            for (const f of files) { try { entries.push({ id: uid(), label: f.name.replace(/\.[^.]+$/, ""), data: await fileToBase64(f) }); } catch {} }
            if (entries.length) { commit([...avatars, ...entries]); toast(`Added ${entries.length} avatar(s)`); }
            setLoading(false);
        }
        e.target.value = "";
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]; if (!f) return;
        setLoading(true);
        try { const imp = await importJSON(f); if (!imp.length) toast("No valid avatars in file", Toasts.Type.MESSAGE); else { commit([...avatars, ...imp]); toast(`Imported ${imp.length}`); } }
        catch { toast("Import failed - invalid JSON", Toasts.Type.FAILURE); }
        setLoading(false); e.target.value = "";
    };

    const removeEntry = (id: string) => {
        const next = avatars.filter(a => a.id !== id);
        shuffleQueue = next.length ? sfShuffle(next.filter(a => !excluded.includes(getExt(a.data))).length) : [];
        commit(next);
        if (!next.filter(a => !excluded.includes(getExt(a.data))).length && running) { stopRotator(); setRunning(false); onToggle(); }
    };

    const moveEntry = (from: number, to: number) => {
        if (to < 0 || to >= avatars.length) return;
        commit(reorderArr(avatars, from, to));
    };

    const onDS = (e: React.DragEvent, i: number) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); setDraggedIdx(i); };
    const onDO = (e: React.DragEvent, i: number) => { e.preventDefault(); e.stopPropagation(); if (draggedIdx !== null && draggedIdx !== i) setDragOverIdx(i); };
    const onDL = () => setDragOverIdx(null);
    const onDP = (e: React.DragEvent, to: number) => { e.preventDefault(); e.stopPropagation(); if (draggedIdx !== null && draggedIdx !== to) moveEntry(draggedIdx, to); setDraggedIdx(null); setDragOverIdx(null); };
    const onDE = () => { setDraggedIdx(null); setDragOverIdx(null); };

    return (
        <ModalRoot {...modalProps} size="medium">
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "4px 0" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: C.aD, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill={C.accent}>
                            <circle cx="9" cy="7" r="3.5"/>
                            <path d="M2 20c0-4 3.1-7 7-7s7 3 7 7"/>
                            <path d="M18 8v8M18 8l-2.5 3M18 8l2.5 3" stroke={C.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                        </svg>
                    </div>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>Avatar Rotator</div>
                        <div style={{ fontSize: 11, color: C.sub }}>{list.length} total - {activeCount} active - by zFrxncesck1</div>
                    </div>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: running ? `${C.green}22` : "rgba(255,255,255,.08)", color: running ? C.green : C.sub, border: `1px solid ${running ? C.green + "44" : "rgba(255,255,255,.12)"}` }}>
                        {running ? "● RUNNING" : "○ STOPPED"}
                    </span>
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "0 16px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, marginBottom: 14, background: running ? `${C.green}0f` : C.bg1, border: `1px solid ${running ? C.green + "2e" : C.line}` }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: running ? C.green : C.text, marginBottom: 2 }}>{running ? "Rotation active" : "Rotation stopped"}</div>
                        <div style={{ fontSize: 12, color: C.sub }}>
                            {running ? `Cycling every ${fmtSec(sec)} - ${lRandom ? "Random" : "Sequential"} - ${activeCount} active` : activeCount === 0 ? "Add avatars or unexclude extensions to start" : "Press Start to begin cycling"}
                        </div>
                    </div>
                    <button onClick={toggleEnabled} disabled={!running && !activeCount}
                        style={{ padding: "9px 22px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "none", outline: "none", background: running ? C.red : C.green, color: "#fff", cursor: (!running && !activeCount) ? "not-allowed" : "pointer", opacity: (!running && !activeCount) ? 0.4 : 1 }}>
                        {running ? "Stop" : "Start"}
                    </button>
                </div>

                <SecLabel>Settings</SecLabel>
                <div style={{ background: C.bg1, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", marginTop: 6, marginBottom: 14 }}>
                    <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ flexShrink: 0 }}>
                                <div style={{ fontSize: 13, color: C.text }}>Interval</div>
                                <div style={{ fontSize: 10, color: C.sub, opacity: 0.7 }}>recommended min: 60s</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                                <input type="number" min={1} value={lSecStr}
                                    onChange={e => setLSecStr(e.target.value)}
                                    onFocus={e => e.target.select()}
                                    onBlur={validateApply}
                                    onKeyDown={e => { if (e.key === "Enter") { validateApply(); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }}
                                    style={{ ...iStyle, flex: "none", width: 72, textAlign: "center", padding: "3px 6px" }} />
                                <span style={{ fontSize: 12, color: C.sub }}>sec</span>
                                <div style={{ display: "flex", gap: 3 }}>
                                    {[60, 120, 300, 600, 900].map(s => (
                                        <button key={s} onClick={() => setPreset(s)}
                                            style={{ padding: "3px 7px", borderRadius: 5, fontSize: 11, cursor: "pointer", outline: "none", border: `1px solid ${sec === s ? C.accent : C.line}`, background: sec === s ? C.aD : "transparent", color: sec === s ? C.accent : C.sub }}>
                                            {fmtPreset(s)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {warnSec && (
                            <div style={{ marginTop: 6, padding: "5px 9px", borderRadius: 6, background: `${C.warn}14`, border: `1px solid ${C.warn}33`, fontSize: 11, color: C.warn }}>
                                ⚠ Below 60s - Discord rate-limits changes (~2 per 10 min). Failures may occur.
                            </div>
                        )}
                    </div>
                    <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13, color: C.text }}>{lRandom ? "🔀 Random (no repeats)" : "🔁 Sequential"}</span>
                            <Toggle value={lRandom} onChange={toggleRandom} />
                        </div>
                    </div>
                    <div style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13, color: C.text }}>Toast notifications</span>
                            <Toggle value={lToast} onChange={toggleToast} />
                        </div>
                    </div>
                </div>

                <div style={{ background: C.bg1, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                    <ExtFilterSection excluded={excluded} onChange={setExcl} />
                </div>

                <Hr />

                <SecLabel>Add Avatar</SecLabel>
                <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 8, flexWrap: "wrap" }}>
                    <input placeholder="https://example.com/avatar.png" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddUrl(); }} style={{ ...iStyle, minWidth: 160 }} />
                    <input placeholder="Label (optional)" value={labelInput} onChange={e => setLabelInput(e.target.value)} style={{ ...iStyle, flex: "none", width: 130 }} />
                    <button onClick={handleAddUrl} disabled={loading || !urlInput.trim()}
                        style={{ padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 700, background: loading || !urlInput.trim() ? "rgba(156,103,255,.15)" : `linear-gradient(135deg, #7c3aed, ${C.accent})`, border: `1px solid ${C.accent}55`, color: loading || !urlInput.trim() ? C.sub : "#fff", cursor: (loading || !urlInput.trim()) ? "not-allowed" : "pointer", outline: "none", flexShrink: 0 }}>
                        {loading ? "…" : "Add URL"}
                    </button>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <label style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "12px 8px", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", userSelect: "none", background: "linear-gradient(135deg, rgba(88,101,242,.14), rgba(156,103,255,.14), rgba(0,176,244,.08))", border: `1.5px dashed ${C.accent}70` }}>
                        <input type="file" multiple accept={ACCEPT} style={{ display: "none" }} onChange={handleFileUpload} disabled={loading} />
                        <span style={{ fontSize: 22 }}>📁</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>{loading ? "Loading…" : "Upload Images"}</span>
                        <span style={{ fontSize: 9, color: C.sub, textAlign: "center", lineHeight: 1.4 }}>jpg - jpeg - jfif - png - gif - webp - avif</span>
                    </label>
                    <label style={{ width: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "12px 8px", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", userSelect: "none", background: "linear-gradient(135deg, rgba(59,165,92,.12), rgba(156,103,255,.10))", border: `1.5px dashed ${C.green}60` }}>
                        <input type="file" accept="application/json" style={{ display: "none" }} onChange={handleImport} disabled={loading} />
                        <span style={{ fontSize: 22 }}>📥</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>Import JSON</span>
                    </label>
                </div>

                {hasGifs && (
                    <div style={{ padding: "7px 11px", borderRadius: 8, marginBottom: 8, background: `${C.warn}12`, border: `1px solid ${C.warn}33`, fontSize: 12, color: C.warn }}>
                        ⚠ GIF avatars require <b>Nitro</b> to animate on Discord. Without Nitro they appear static.
                    </div>
                )}

                <div style={{ padding: "7px 11px", borderRadius: 8, marginBottom: 10, background: "rgba(88,101,242,.09)", border: "1px solid rgba(88,101,242,.22)", fontSize: 12, color: "#90caf9" }}>
                    ✏️ Double-click a name to rename - ✏ to edit/crop - Drag ⠿ to reorder
                </div>

                <Hr />

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: C.sub, textTransform: "uppercase" }}>Avatar List ({list.length})</span>
                    {list.length > 0 && (
                        <div style={{ display: "flex", gap: 5 }}>
                            <button onClick={exportJSON} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${C.accent}44`, background: C.aD, color: C.accent, outline: "none" }}>📤 Export</button>
                            <button onClick={() => { commit([]); seqIndex = 0; shuffleQueue = []; if (running) { stopRotator(); setRunning(false); onToggle(); } }} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${C.red}44`, background: `${C.red}18`, color: C.red, outline: "none" }}>Clear all</button>
                        </div>
                    )}
                </div>

                <div style={{ maxHeight: 230, overflowY: "auto", paddingRight: 2 }}>
                    {list.length === 0
                        ? <div style={{ textAlign: "center", padding: "24px 0", color: C.sub, fontSize: 13 }}><div style={{ fontSize: 26, marginBottom: 6 }}>🖼️</div>No avatars yet - add some above</div>
                        : list.map((entry, i) => (
                            <AvatarCard key={entry.id} entry={entry}
                                isDragged={draggedIdx === i} isDragOver={dragOverIdx === i}
                                isExcluded={excluded.includes(getExt(entry.data))}
                                onDragStart={e => onDS(e, i)} onDragOver={e => onDO(e, i)}
                                onDragLeave={onDL} onDrop={e => onDP(e, i)} onDragEnd={onDE}
                                onRemove={() => removeEntry(entry.id)}
                                onApplyNow={() => void applyAvatar(entry)}
                                onCrop={() => openModal(p => <CropModal src={entry.data}
                                    onApply={d => { commit(avatars.map(a => a.id === entry.id ? { ...a, data: d } : a)); toast("Updated"); }}
                                    onSkip={() => {}} modalProps={p} />)}
                                onRename={l => commit(avatars.map(a => a.id === entry.id ? { ...a, label: l } : a))}
                            />
                        ))
                    }
                </div>
            </ModalContent>

            <ModalFooter separator={false}>
                <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
                    <button onClick={() => void rotateNext()} disabled={!activeCount}
                        style={{ padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: activeCount ? C.aD : "rgba(156,103,255,.1)", border: `1px solid ${C.accent}44`, color: activeCount ? C.accent : C.sub, cursor: !activeCount ? "not-allowed" : "pointer", opacity: !activeCount ? 0.5 : 1, outline: "none" }}>
                        ⏭ Skip
                    </button>
                    <span style={{ fontSize: 11, color: C.sub }}>{running ? `● Cycling every ${fmtSec(sec)} - ${activeCount} active` : "○ Not running"}</span>
                    <button onClick={modalProps.onClose} style={{ marginLeft: "auto", padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 500, background: "transparent", border: `1px solid ${C.line}`, color: C.sub, cursor: "pointer", outline: "none" }}>
                        Close
                    </button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function ARUserAreaButton() {
    const [tick, setTick] = React.useState(0);
    React.useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1800); return () => clearInterval(id); }, []);
    const running = rotatorTimer !== null;
    if (!settings.store.showButton) return null;
    return (
        <UserAreaButton
            tooltipText={running ? `Avatar Rotator - cycling every ${fmtSec(settings.store.intervalSeconds ?? DEFAULT_S)}` : "Avatar Rotator - stopped"}
            icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="7" r="3.5"/>
                    <path d="M2 20c0-4 3.1-7 7-7s7 3 7 7"/>
                    <path d="M18 8v8M18 8l-2.5 3M18 8l2.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    {running && <circle cx="21.5" cy="3.5" r="2.8" fill={C.accent}/>}
                </svg>
            }
            onClick={() => openModal(p => <AvatarRotatorModal modalProps={p} onToggle={() => setTick(t => t + 1)} />)}
        />
    );
}

export default definePlugin({
    name:         "AvatarRotator",
    description:  "Cycles your Discord avatar through a list at a set interval. Random or sequential. Supports jpg/jpeg/jfif/png/gif/webp/avif. Extension filter, crop editor, drag to reorder, rename, import/export. Auto-saved to DataStore.",
    authors:      [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,
    dependencies: ["UserAreaAPI"],

    settingsAboutComponent: () => {
        const [excl, setExclS] = React.useState(() => getExcluded());
        const set = (arr: string[]) => { setExclS(arr); setExcluded(arr); };
        return (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <Button color={Button.Colors.BRAND} onClick={() => openModal(p => <AvatarRotatorModal modalProps={p} onToggle={() => {}} />)}>
                    Open Avatar Rotator
                </Button>
                <div style={{ padding: "12px 14px", borderRadius: 8, background: C.bg1, border: `1px solid ${C.line}` }}>
                    <ExtFilterSection excluded={excl} onChange={set} />
                </div>
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(250,166,26,.1)", border: "1px solid rgba(250,166,26,.28)" }}>
                    <span style={{ fontSize: 12, color: "#faa61a", fontWeight: 700 }}>⚠ Note: </span>
                    <span style={{ fontSize: 12, color: "#9e9e9e" }}>The panel may show stale data if the plugin was just enabled. Reload Discord or toggle off/on if something looks wrong.</span>
                </div>
            </div>
        );
    },

    async start() {
        pluginActive = true;
        const stored: StoreData = (await DataStore.get(SK)) ?? { avatars: [], seqIndex: 0, shuffleQueue: [] };
        avatars      = stored.avatars      ?? [];
        seqIndex     = stored.seqIndex     ?? 0;
        shuffleQueue = stored.shuffleQueue ?? [];
        Vencord.Api.UserArea.addUserAreaButton("avatar-rotator", () => <ARUserAreaButton />);
        if (settings.store.enabled && getActive().length) startRotator(false);
    },

    stop() {
        pluginActive = false;
        stopRotator();
        avatars = []; seqIndex = 0; shuffleQueue = [];
        Vencord.Api.UserArea.removeUserAreaButton("avatar-rotator");
    },
});