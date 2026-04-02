/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { HeadingTertiary } from "@components/Heading";
import { getCurrentChannel, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import { useForceUpdater } from "@utils/react";
import definePlugin from "@utils/types";
import { find } from "@webpack";
import { FluxDispatcher, Menu, React } from "@webpack/common";

const logger = new Logger("GifSpammer");
const STORE_KEY = "GifSpammer_v2";

type Mode = "sequential" | "random";

interface GS {
    mode: Mode;
    delay: string;
    jitterEnabled: boolean;
    jitterMs: number;
    lockToChannel: boolean;
    keybind: string;
    randomDelayMin: number;
    randomDelayMax: number;
    shuffle: boolean;
    reverse: boolean;
    limit: number;
    repeat: number;
}

const DEFAULTS: GS = {
    mode: "sequential",
    delay: "2s",
    jitterEnabled: false,
    jitterMs: 200,
    lockToChannel: true,
    keybind: "",
    randomDelayMin: 1000,
    randomDelayMax: 4000,
    shuffle: false,
    reverse: false,
    limit: 0,
    repeat: 1,
};

let gs: GS = { ...DEFAULTS };
let isRunning = false;
let stopFlag = false;
let lockedChannelId: string | null = null;
let activeTimers: ReturnType<typeof setTimeout>[] = [];
let _openModal: (() => void) | null = null;

const saveSettings = () => DataStore.set(STORE_KEY, gs);

function getFavoriteGifUrls(): string[] {
    const store = find((m: any) => m?.ProtoClass?.typeName?.endsWith(".FrecencyUserSettings"));
    if (!store) throw new Error("FrecencyUserSettings not found");
    return Object.keys(store.getCurrentValue()?.favoriteGifs?.gifs ?? {});
}

function parseDelay(s: string): number {
    const m = s.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
    if (!m) return 2000;
    const v = parseFloat(m[1]);
    switch ((m[2] ?? "ms").toLowerCase()) {
        case "s":  return v * 1000;
        case "m":  return v * 60_000;
        case "h":  return v * 3_600_000;
        default:   return v;
    }
}

function applyJitter(base: number): number {
    if (!gs.jitterEnabled || gs.jitterMs <= 0) return base;
    return Math.max(300, base + Math.floor(Math.random() * (gs.jitterMs * 2 + 1)) - gs.jitterMs);
}

function getRandDelay(): number {
    const min = Math.max(300, gs.randomDelayMin);
    const max = Math.max(min + 100, gs.randomDelayMax);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getChannelId(): string | null {
    return lockedChannelId ?? getCurrentChannel()?.id ?? null;
}

function clearTimers() {
    activeTimers.forEach(clearTimeout);
    activeTimers = [];
}

function sched(fn: () => void, ms: number) {
    const id = setTimeout(() => { activeTimers = activeTimers.filter(t => t !== id); fn(); }, ms);
    activeTimers.push(id);
}

function stopSpamming(silent = false) {
    stopFlag = true;
    isRunning = false;
    clearTimers();
    lockedChannelId = null;
}

function runSequential(urls: string[], total: number) {
    let sent = 0;

    const loop = (idx: number, rep: number) => {
        if (stopFlag || !isRunning) {
            const chId = getChannelId();
            if (chId) sendBotMessage(chId, { content: stopFlag ? `🛑 Stopped! Sent **${sent}/${total}** GIFs.` : `✅ Done! Sent **${sent}/${total}** GIFs.` });
            stopSpamming();
            return;
        }

        const chId = getChannelId();
        if (!chId) { stopSpamming(); return; }

        try { sendMessage(chId, { content: urls[idx] }); sent++; } catch (e) { logger.error("Send failed", e); }

        const nextIdx = (idx + 1) % urls.length;
        const nextRep = nextIdx === 0 ? rep + 1 : rep;
        if (nextRep > Math.max(1, gs.repeat)) {
            const ch = getChannelId();
            if (ch) sendBotMessage(ch, { content: `✅ Done! Sent **${sent}/${total}** GIFs.` });
            stopSpamming();
            return;
        }

        sched(() => loop(nextIdx, nextRep), applyJitter(parseDelay(gs.delay)));
    };

    loop(0, 1);
}

function runRandom(urls: string[]) {
    let sent = 0;

    const loop = () => {
        if (stopFlag || !isRunning) {
            const chId = getChannelId();
            if (chId) sendBotMessage(chId, { content: `🛑 Random stopped! Sent **${sent}** GIFs.` });
            stopSpamming();
            return;
        }

        const chId = getChannelId();
        if (!chId) { stopSpamming(); return; }

        try { sendMessage(chId, { content: urls[Math.floor(Math.random() * urls.length)] }); sent++; } catch (e) { logger.error("Send failed", e); }

        sched(loop, applyJitter(getRandDelay()));
    };

    sched(loop, 0);
}

function startSpamming() {
    if (isRunning) return;

    let urls: string[];
    try { urls = getFavoriteGifUrls(); } catch (e) { logger.error("Failed to get GIFs", e); return; }
    if (!urls.length) return;

    if (gs.shuffle) shuffleArray(urls);
    if (gs.reverse) urls.reverse();
    if (gs.limit > 0) urls = urls.slice(0, gs.limit);

    const repeat = Math.max(1, gs.repeat);
    const total = urls.length * repeat;

    lockedChannelId = gs.lockToChannel ? (getCurrentChannel()?.id ?? null) : null;
    const chId = getChannelId();
    if (!chId) return;

    isRunning = true;
    stopFlag = false;
    activeTimers = [];

    if (gs.mode === "random") {
        sendBotMessage(chId, { content: `🚀 Random GIF mode | ⏱️ ${gs.randomDelayMin}–${gs.randomDelayMax}ms${gs.jitterEnabled ? ` ±${gs.jitterMs}ms jitter` : ""}${gs.lockToChannel ? " | 🔒 Locked" : ""}\nUse **/gifstop** or the chat bar button to stop.` });
        runRandom(urls);
    } else {
        const flags = [gs.shuffle && "🔀 shuffled", gs.reverse && "🔃 reversed", repeat > 1 && `🔁 ×${repeat}`].filter(Boolean).join(" | ");
        sendBotMessage(chId, { content: `🚀 Sending **${total}** GIF${total !== 1 ? "s" : ""} | ⏱️ ${gs.delay} delay${gs.jitterEnabled ? ` ±${gs.jitterMs}ms jitter` : ""}${flags ? " | " + flags : ""}${gs.lockToChannel ? " | 🔒 Locked" : ""}\nUse **/gifstop** or the chat bar button to stop.` });
        runSequential(urls, total);
    }
}

function toggleSpamming() { isRunning ? stopSpamming() : startSpamming(); }

function handleChannelSelect() { if (!gs.lockToChannel) stopSpamming(); }

function matchesKeybind(e: KeyboardEvent, combo: string): boolean {
    if (!combo) return false;
    const parts = combo.toLowerCase().split("+");
    return e.key.toLowerCase() === parts[parts.length - 1] &&
        e.ctrlKey  === parts.includes("ctrl") &&
        e.shiftKey === parts.includes("shift") &&
        e.altKey   === parts.includes("alt") &&
        e.metaKey  === parts.includes("meta");
}

function onKeyDown(e: KeyboardEvent) {
    if (gs.keybind && matchesKeybind(e, gs.keybind)) { e.preventDefault(); toggleSpamming(); }
}

const CSS = `
.gs-wrap input{background:#16171a!important;color:#fff!important;border:1.5px solid #505260!important;border-radius:4px!important}
.gs-wrap input:focus{border-color:var(--brand-experiment)!important;outline:none!important}
.gs-wrap input::placeholder{color:#5a5d6b!important}
.gs-sec{margin-bottom:9px;padding-bottom:9px;border-bottom:1px solid #27282d}
.gs-sec:last-child{border-bottom:none;padding-bottom:0;margin-bottom:0}
.gs-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9096a8;margin-bottom:5px;display:block}
.gs-hint{font-size:10px;color:#6b6f7e;margin-top:3px;line-height:1.35}
.gs-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.gs-pill{padding:4px 11px;border-radius:20px;cursor:pointer;font-size:11px;font-weight:700;border:2px solid;transition:background .12s,color .12s;user-select:none;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;line-height:1.4;box-sizing:border-box}
.gs-pill:hover{filter:brightness(1.18)}
.gs-nb{cursor:pointer;width:22px;height:22px;border-radius:4px;background:#2b2d31;border:1.5px solid #505260;color:#c0c4d0;font-size:14px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;user-select:none;line-height:1}
.gs-nb:hover{background:#3a3b40;color:#fff}
.gs-numinput{padding:3px 6px;border-radius:4px;font-size:11px;background:#16171a;border:1.5px solid #505260;color:#fff;outline:none;text-align:center}
.gs-numinput:focus{border-color:var(--brand-experiment)}
`;

function injectCSS() {
    if (document.getElementById("gs-css")) return;
    const el = document.createElement("style");
    el.id = "gs-css";
    el.textContent = CSS;
    document.head.appendChild(el);
}

function Pill({ active, color, onClick, children }: { active: boolean; color: string; onClick?: () => void; children: React.ReactNode; }) {
    const s = active
        ? { borderColor: color, background: color, color: "#fff" }
        : { borderColor: color, background: "transparent", color };
    return <span className="gs-pill" onClick={onClick} style={s}>{children}</span>;
}

function TogglePill({ active, color, onToggle, on, off }: { active: boolean; color: string; onToggle: () => void; on: string; off: string; }) {
    return (
        <span className="gs-pill" onClick={onToggle}
            style={active ? { borderColor: color, background: color, color: "#fff" } : { borderColor: color, background: "transparent", color }}>
            {active ? on : off}
        </span>
    );
}

function NumStepper({ value, min, max, step = 1, onChange }: { value: number; min: number; max?: number; step?: number; onChange: (v: number) => void; }) {
    const clamp = (v: number) => max !== undefined ? Math.min(max, Math.max(min, v)) : Math.max(min, v);
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span className="gs-nb" onClick={() => onChange(clamp(value - step))}>−</span>
            <input type="number" className="gs-numinput" style={{ width: 52 }} value={value}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v)); }} />
            <span className="gs-nb" onClick={() => onChange(clamp(value + step))}>+</span>
        </div>
    );
}

function KeybindRecorder({ update }: { update: () => void; }) {
    const [recording, setRecording] = React.useState(false);
    const [preview, setPreview] = React.useState("");
    const current = gs.keybind || "";

    React.useEffect(() => {
        if (!recording) { setPreview(""); return; }
        const MODS = ["Control", "Shift", "Alt", "Meta"];

        const down = (e: KeyboardEvent) => {
            e.preventDefault(); e.stopPropagation();
            if (e.key === "Escape") { setRecording(false); return; }
            const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            const parts: string[] = [];
            if (e.ctrlKey)  parts.push("Ctrl");
            if (e.shiftKey) parts.push("Shift");
            if (e.altKey)   parts.push("Alt");
            if (e.metaKey)  parts.push("Meta");
            if (MODS.includes(k)) { setPreview(parts.join("+") + "+…"); return; }
            parts.push(k);
            gs.keybind = parts.join("+");
            saveSettings();
            update();
            setRecording(false);
        };

        const up = (e: KeyboardEvent) => {
            if (!MODS.includes(e.key)) return;
            const parts: string[] = [];
            if (e.ctrlKey)  parts.push("Ctrl");
            if (e.shiftKey) parts.push("Shift");
            if (e.altKey)   parts.push("Alt");
            if (e.metaKey)  parts.push("Meta");
            setPreview(parts.length ? parts.join("+") + "+…" : "");
        };

        window.addEventListener("keydown", down, { capture: true });
        window.addEventListener("keyup",   up,   { capture: true });
        return () => {
            window.removeEventListener("keydown", down, { capture: true });
            window.removeEventListener("keyup",   up,   { capture: true });
        };
    }, [recording]);

    return (
        <div className="gs-row gs-wrap">
            <span style={{ fontSize: 12, fontWeight: 700, minWidth: 160, padding: "4px 9px", background: "#16171a", border: `1.5px solid ${recording ? "#ff9800" : "#3a3b40"}`, borderRadius: 4, color: recording ? "#ff9800" : "#e0e0e0", fontFamily: "monospace" }}>
                {recording ? (preview || "Hold modifiers, then press a key…") : (current || "Not set")}
            </span>
            <Pill active={recording} color="#ff9800" onClick={() => setRecording(r => !r)}>{recording ? "✕ Cancel" : "⌨ Record"}</Pill>
            {current && !recording && <Pill active={false} color="#f04747" onClick={() => { gs.keybind = ""; saveSettings(); update(); }}>Clear</Pill>}
            {!recording && <span style={{ fontSize: 10, color: "#6b6f7e" }}>e.g. Ctrl+Shift+G · Alt+G</span>}
        </div>
    );
}

function GifSpamModal(props: ModalProps) {
    const update = useForceUpdater();
    const [gifCount, setGifCount] = React.useState<number | null>(null);

    React.useEffect(() => {
        injectCSS();
        try { setGifCount(getFavoriteGifUrls().length); } catch { setGifCount(0); }
    }, []);

    const s = { fontSize: 10, color: "#9096a8" };

    return (
        <ModalRoot {...props}>
            <ModalHeader>
                <HeadingTertiary>GifSpammer</HeadingTertiary>
                <span style={{ marginLeft: "auto", fontSize: 11, color: isRunning ? "#43b581" : "#6b6f7e", fontWeight: 700 }}>
                    {isRunning ? "▶ Running" : "⏹ Stopped"}
                    {gifCount !== null && <span style={{ marginLeft: 8, color: "#8a8e9a", fontWeight: 400 }}>🎞️ {gifCount} saved GIFs</span>}
                </span>
            </ModalHeader>

            <ModalContent style={{ padding: "12px 16px" }}>

                <div className="gs-sec">
                    <span className="gs-lbl">Mode</span>
                    <div className="gs-row">
                        <Pill active={gs.mode === "sequential"} color="#43b581" onClick={() => { gs.mode = "sequential"; saveSettings(); update(); }}>📋 Sequential</Pill>
                        <Pill active={gs.mode === "random"}     color="#9b59b6" onClick={() => { gs.mode = "random";     saveSettings(); update(); }}>🎲 Random</Pill>
                    </div>
                    <div className="gs-hint">
                        {gs.mode === "sequential" ? "Sends GIFs in order (with optional shuffle/reverse/repeat). Stops when done." : "Picks a random GIF every tick. Runs indefinitely until stopped."}
                    </div>
                </div>

                {gs.mode === "sequential" && (<>
                    <div className="gs-sec">
                        <span className="gs-lbl">Delay between GIFs</span>
                        <div className="gs-row gs-wrap">
                            <input type="text" value={gs.delay} placeholder="2s"
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { gs.delay = e.target.value; saveSettings(); update(); }}
                                style={{ width: 80, padding: "4px 8px", borderRadius: 4, fontSize: 12 }} />
                            <span style={s}>ms · s · m · h — e.g. 500ms · 2s · 1.5m</span>
                        </div>
                        <div className="gs-hint">Parsed delay: <b style={{ color: "#c0c4d0" }}>{parseDelay(gs.delay).toLocaleString()} ms</b></div>
                    </div>

                    <div className="gs-sec">
                        <span className="gs-lbl">Order &amp; Quantity</span>
                        <div className="gs-row" style={{ marginBottom: 7 }}>
                            <TogglePill active={gs.shuffle} color="#7c4dff" onToggle={() => { gs.shuffle = !gs.shuffle; if (gs.shuffle) gs.reverse = false; saveSettings(); update(); }} on="🔀 Shuffle ON" off="🔀 Shuffle OFF" />
                            <TogglePill active={gs.reverse} color="#26c6da" onToggle={() => { gs.reverse = !gs.reverse; if (gs.reverse) gs.shuffle = false; saveSettings(); update(); }} on="🔃 Reverse ON" off="🔃 Reverse OFF" />
                        </div>
                        <div className="gs-row" style={{ marginBottom: 6 }}>
                            <span style={s}>Limit (0 = all)</span>
                            <NumStepper value={gs.limit} min={0} onChange={v => { gs.limit = v; saveSettings(); update(); }} />
                            <span style={s}>Repeat</span>
                            <NumStepper value={gs.repeat} min={1} onChange={v => { gs.repeat = v; saveSettings(); update(); }} />
                        </div>
                        {gifCount !== null && (
                            <div className="gs-hint">
                                Will send: <b style={{ color: "#c0c4d0" }}>{((gs.limit > 0 ? Math.min(gs.limit, gifCount) : gifCount) * Math.max(1, gs.repeat)).toLocaleString()}</b> GIFs total.
                            </div>
                        )}
                    </div>
                </>)}

                {gs.mode === "random" && (
                    <div className="gs-sec">
                        <span className="gs-lbl">Random Delay Range</span>
                        <div className="gs-row" style={{ marginBottom: 5 }}>
                            <span style={s}>Min</span>
                            <input type="number" className="gs-numinput" style={{ width: 68 }} defaultValue={gs.randomDelayMin}
                                onBlur={(e: React.FocusEvent<HTMLInputElement>) => { const v = parseInt(e.target.value); gs.randomDelayMin = Math.max(300, isNaN(v) ? 1000 : v); saveSettings(); update(); }} />
                            <span style={s}>ms</span>
                            <span style={s}>Max</span>
                            <input type="number" className="gs-numinput" style={{ width: 68 }} defaultValue={gs.randomDelayMax}
                                onBlur={(e: React.FocusEvent<HTMLInputElement>) => { const v = parseInt(e.target.value); gs.randomDelayMax = Math.max(300, isNaN(v) ? 4000 : v); saveSettings(); update(); }} />
                            <span style={s}>ms</span>
                        </div>
                        <div className="gs-hint">A random delay between <b style={{ color: "#c0c4d0" }}>{gs.randomDelayMin}–{gs.randomDelayMax} ms</b> is picked before each GIF.</div>
                    </div>
                )}

                <div className="gs-sec">
                    <div className="gs-row" style={{ marginBottom: 4 }}>
                        <span className="gs-lbl" style={{ margin: 0 }}>Delay Jitter</span>
                        <TogglePill active={gs.jitterEnabled} color="#ffa726" onToggle={() => { gs.jitterEnabled = !gs.jitterEnabled; saveSettings(); update(); }} on="Jitter ON" off="Jitter OFF" />
                        {gs.jitterEnabled && (<>
                            <span style={{ fontSize: 11, color: "#9096a8" }}>±</span>
                            <input type="number" className="gs-numinput" min={0} defaultValue={gs.jitterMs} style={{ width: 55 }}
                                onBlur={(e: React.FocusEvent<HTMLInputElement>) => { const v = parseInt(e.target.value); gs.jitterMs = Math.max(0, isNaN(v) ? 200 : v); saveSettings(); }} />
                            <span style={{ fontSize: 11, color: "#9096a8" }}>ms</span>
                        </>)}
                    </div>
                    <div className="gs-hint">Adds a random ±N ms offset to each delay — makes timing less predictable and harder for Discord to flag as automated.</div>
                </div>

                <div className="gs-sec">
                    <span className="gs-lbl">Keybind — hold modifiers (Ctrl/Shift/Alt/Meta) then press any key</span>
                    <KeybindRecorder update={update} />
                </div>

                <div className="gs-sec">
                    <span className="gs-lbl">Channel Lock</span>
                    <div className="gs-row" style={{ marginBottom: 4 }}>
                        <TogglePill active={gs.lockToChannel} color="#ff9800"
                            onToggle={() => { gs.lockToChannel = !gs.lockToChannel; saveSettings(); update(); }}
                            on="🔒 Locked to start channel" off="🔓 Follows current channel" />
                    </div>
                    <div className="gs-hint">
                        When <b style={{ color: "#ff9800" }}>ON</b>: switching channels won't stop the spammer — GIFs keep going to where it started.<br />
                        When <b style={{ color: "#c0c4d0" }}>OFF</b>: switching channels stops the spammer automatically.
                    </div>
                </div>

                {gifCount === 0 && (
                    <div style={{ fontSize: 11, color: "#f04747", background: "rgba(240,71,71,.1)", border: "1px solid rgba(240,71,71,.3)", borderRadius: 5, padding: "7px 10px" }}>
                        ❌ No favorite GIFs found! Go to Discord's GIF picker and save some first.
                    </div>
                )}

            </ModalContent>

            <ModalFooter>
                {isRunning
                    ? <Pill active color="#f04747" onClick={() => { stopSpamming(); props.onClose(); }}>⏹ Stop</Pill>
                    : <Pill active color="#43b581" onClick={() => { props.onClose(); startSpamming(); }}>▶ Start</Pill>
                }
                <span style={{ flex: 1 }} />
                <Pill active={false} color="#505260" onClick={props.onClose}>Close</Pill>
            </ModalFooter>
        </ModalRoot>
    );
}

function buildModal() { openModal(props => <GifSpamModal {...props} />); }

const PlayIcon: React.FC<{ className?: string; }> = ({ className }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" className={className}>
        <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <polygon points="10,8.5 10,15.5 16,12" fill="currentColor" />
        <circle cx="7.5" cy="18.5" r="0.9" fill="currentColor" />
        <circle cx="10.5" cy="18.5" r="0.9" fill="currentColor" />
        <circle cx="13.5" cy="18.5" r="0.9" fill="currentColor" />
    </svg>
);
const StopIcon: React.FC<{ className?: string; }> = ({ className }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" className={className}>
        <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
        <line x1="6" y1="19.5" x2="14" y2="19.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7.5" cy="18" r="0.9" fill="currentColor" />
        <circle cx="10.5" cy="18" r="0.9" fill="currentColor" />
        <circle cx="13.5" cy="18" r="0.9" fill="currentColor" />
    </svg>
);

const GifChatBar: ChatBarButtonFactory = ({ isAnyChat }) => {
    const [running, setRunning] = React.useState(isRunning);

    React.useEffect(() => {
        _openModal = buildModal;
        return () => { _openModal = null; };
    }, []);

    React.useEffect(() => {
        const iv = setInterval(() => { if (running !== isRunning) setRunning(isRunning); }, 150);
        return () => clearInterval(iv);
    }, [running]);

    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip={running ? "Stop GifSpammer" : "Open GifSpammer"}
            onClick={() => { if (running) { stopSpamming(); setRunning(false); } else buildModal(); }}
        >
            {running ? <StopIcon /> : <PlayIcon />}
        </ChatBarButton>
    );
};

const GifContextMenu: NavContextMenuPatchCallback = children => {
    const group = findGroupChildrenByChildId("submit-button", children as (React.ReactElement | null | undefined)[]);
    if (!group) return;
    const idx = group.findIndex(c => c?.props?.id === "submit-button");
    group.splice(idx >= 0 ? idx : 0, 0,
        <Menu.MenuItem id="vc-gs" label="GifSpammer">
            <Menu.MenuItem id="vc-gs-toggle" label={isRunning ? "⏹ Stop Spammer" : "▶ Start Spammer"} action={toggleSpamming} />
            <Menu.MenuItem id="vc-gs-settings" label="⚙ Open Settings" action={buildModal} />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "GifSpammer",
    description: "Send all your favorite GIFs with sequential/random modes, jitter, keybind, lock to channel, ChatBar button and context menu — ported from AutoMessageRepeater.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }, { name: "nnenaza", id: 0n }],
    dependencies: ["CommandsAPI", "ChatBarAPI"],

    contextMenus: { "textarea-context": GifContextMenu },
    chatBarButton: { icon: PlayIcon, render: GifChatBar },

    commands: [
        {
            name: "gifspam",
            description: "Start sending your favorite GIFs",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "mode",    description: "sequential | random (default: saved setting)",                       type: ApplicationCommandOptionType.STRING,  required: false },
                { name: "delay",   description: "Delay between GIFs — e.g. 500ms, 2s, 1m (default: saved setting)",  type: ApplicationCommandOptionType.STRING,  required: false },
                { name: "shuffle", description: "Shuffle order (default: saved setting)",                             type: ApplicationCommandOptionType.BOOLEAN, required: false },
                { name: "reverse", description: "Reverse order (default: saved setting)",                             type: ApplicationCommandOptionType.BOOLEAN, required: false },
                { name: "limit",   description: "Max GIFs to send, 0 = all (default: saved setting)",                type: ApplicationCommandOptionType.NUMBER,  required: false },
                { name: "repeat",  description: "Times to loop the list (default: saved setting)",                   type: ApplicationCommandOptionType.NUMBER,  required: false },
            ],
            execute(args, ctx) {
                if (isRunning) { sendBotMessage(ctx.channel.id, { content: "⚠️ Already running! Use **/gifstop** to stop." }); return; }

                const get = (n: string) => args.find(a => a.name === n)?.value;
                const modeArg = get("mode") as string | undefined;
                if (modeArg === "sequential" || modeArg === "random") { gs.mode = modeArg; }
                if (get("delay") !== undefined) gs.delay = get("delay") as string;
                if (get("shuffle") !== undefined) gs.shuffle = get("shuffle") as boolean;
                if (get("reverse") !== undefined) gs.reverse = get("reverse") as boolean;
                if (get("limit")   !== undefined) gs.limit   = get("limit")   as number;
                if (get("repeat")  !== undefined) gs.repeat  = get("repeat")  as number;
                saveSettings();
                startSpamming();
            },
        },
        {
            name: "gifstop",
            description: "Stop the running GifSpammer",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute(_args, ctx) {
                if (!isRunning) { sendBotMessage(ctx.channel.id, { content: "ℹ️ GifSpammer is not running." }); return; }
                stopSpamming();
                sendBotMessage(ctx.channel.id, { content: "🛑 Stopped!" });
            },
        },
        {
            name: "gifstatus",
            description: "Show current GifSpammer status and configuration",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute(_args, ctx) {
                let count = 0;
                try { count = getFavoriteGifUrls().length; } catch { }
                sendBotMessage(ctx.channel.id, {
                    content: [
                        `**GifSpammer** — ${isRunning ? "🟢 Running" : "🔴 Stopped"}`,
                        `**Mode:** ${gs.mode} | **Delay:** ${gs.delay} (${parseDelay(gs.delay).toLocaleString()} ms)`,
                        `**Jitter:** ${gs.jitterEnabled ? `ON ±${gs.jitterMs}ms` : "OFF"} | **Lock to channel:** ${gs.lockToChannel ? "ON" : "OFF"}`,
                        `**Shuffle:** ${gs.shuffle ? "ON" : "OFF"} | **Reverse:** ${gs.reverse ? "ON" : "OFF"} | **Limit:** ${gs.limit || "all"} | **Repeat:** ${gs.repeat}×`,
                        gs.mode === "random" ? `**Random delay:** ${gs.randomDelayMin}–${gs.randomDelayMax} ms` : "",
                        `**Keybind:** ${gs.keybind || "not set"} | **Saved GIFs:** ${count}`,
                    ].filter(Boolean).join("\n"),
                });
            },
        },
        {
            name: "gifcount",
            description: "Show how many favorite GIFs you have",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute(_args, ctx) {
                try {
                    const n = getFavoriteGifUrls().length;
                    sendBotMessage(ctx.channel.id, { content: `🎞️ You have **${n}** favorite GIF${n !== 1 ? "s" : ""}.` });
                } catch { sendBotMessage(ctx.channel.id, { content: "❌ Could not read your favorite GIFs." }); }
            },
        },
        {
            name: "gifpreview",
            description: "Preview your favorite GIFs (only visible to you)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{ name: "page", description: "Page number, 10 per page (default: 1)", type: ApplicationCommandOptionType.NUMBER, required: false }],
            execute(args, ctx) {
                let urls: string[];
                try { urls = getFavoriteGifUrls(); } catch { sendBotMessage(ctx.channel.id, { content: "❌ Could not fetch your favorite GIFs." }); return; }
                if (!urls.length) { sendBotMessage(ctx.channel.id, { content: "❌ No favorite GIFs." }); return; }

                const perPage = 10;
                const totalPages = Math.ceil(urls.length / perPage);
                const page = Math.min(Math.max(1, (args.find(a => a.name === "page")?.value as number) ?? 1), totalPages);
                const lines = urls.slice((page - 1) * perPage, page * perPage).map((u, i) => `**${(page - 1) * perPage + i + 1}.** ${u}`).join("\n");
                sendBotMessage(ctx.channel.id, { content: `🎞️ **Favorite GIFs** — Page **${page}/${totalPages}** (${urls.length} total)\n\n${lines}` });
            },
        },
        {
            name: "gifpanel",
            description: "Open the GifSpammer settings panel",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute() { buildModal(); },
        },
    ],

    async start() {
        injectCSS();
        gs = { ...DEFAULTS, ...(await DataStore.get(STORE_KEY) ?? {}) };
        FluxDispatcher.subscribe("CHANNEL_SELECT", handleChannelSelect);
        window.addEventListener("beforeunload", () => stopSpamming());
        window.addEventListener("keydown", onKeyDown, { capture: true });
    },

    stop() {
        stopSpamming();
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", handleChannelSelect);
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        document.getElementById("gs-css")?.remove();
    },
});
