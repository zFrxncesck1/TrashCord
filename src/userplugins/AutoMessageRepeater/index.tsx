/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { HeadingTertiary } from "@components/Heading";
import { Devs } from "@utils/constants";
import { getCurrentChannel, sendMessage } from "@utils/discord";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Menu, React, TextInput } from "@webpack/common";

type MessageEntry = { id: string; message: string; delay: string; };
type GenderMode = "all" | "male" | "female" | "neutral";
type WordLists = {
    general: string; dmGeneral: string; dmMale: string; dmFemale: string;
    serverGeneral: string; serverMale: string; serverFemale: string;
};
type ListEnabled = Record<keyof WordLists, boolean>;

const STORE = {
    ENTRIES: "AMR_messageEntries",
    LISTS:   "AMR_wordLists",
    ENABLED: "AMR_listEnabled",
    GENDER:  "AMR_genderMode",
    AUTO_CH: "AMR_autoChannel",
    LEGACY:  "AutoMessageRepeater_messageEntries",
};

const LIST_META: { key: keyof WordLists; label: string; short: string; color: string; }[] = [
    { key: "general",       label: "① General  —  always active",         short: "General",        color: "#7c4dff" },
    { key: "dmGeneral",     label: "② DM  —  General",                    short: "DM General",     color: "#b39ddb" },
    { key: "dmMale",        label: "③ DM  —  Male ♂",                     short: "DM Male",        color: "#64b5f6" },
    { key: "dmFemale",      label: "④ DM  —  Female ♀",                   short: "DM Female",      color: "#f48fb1" },
    { key: "serverGeneral", label: "⑤ Server / Group DM  —  General",     short: "Srv General",    color: "#6a1b9a" },
    { key: "serverMale",    label: "⑥ Server / Group DM  —  Male ♂",      short: "Srv Male",       color: "#1565c0" },
    { key: "serverFemale",  label: "⑦ Server / Group DM  —  Female ♀",    short: "Srv Female",     color: "#880e4f" },
];

const DEFAULT_LISTS: WordLists = {
    general:       "the turn understand use visit wait walk want warn watch wear",
    dmGeneral:     "hey hello hi howdy greetings",
    dmMale:        "bro dude man buddy mate",
    dmFemale:      "girl bestie hun dear sis",
    serverGeneral: "hello everyone hey all greetings folks",
    serverMale:    "guys lads bros fellas",
    serverFemale:  "girls ladies gals",
};

const DEFAULT_ENABLED: ListEnabled = {
    general: true, dmGeneral: true, dmMale: true, dmFemale: true,
    serverGeneral: true, serverMale: true, serverFemale: true,
};

let messageEntries: MessageEntry[] = [];
let wordLists: WordLists = { ...DEFAULT_LISTS };
let listEnabled: ListEnabled = { ...DEFAULT_ENABLED };
let genderMode: GenderMode = "all";
let autoChannel = true;
let isRepeating = false;
let activeTimers: NodeJS.Timeout[] = [];
let _openModalFn: (() => void) | null = null;
let lockedChannelId: string | null = null;

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function parseDelay(s: string): number {
    const m = s.match(/^(\d+)(ms|s|m|h)$/);
    if (!m) return 1000;
    const v = parseInt(m[1]);
    return m[2] === "ms" ? v : m[2] === "s" ? v * 1000 : m[2] === "m" ? v * 60000 : v * 3600000;
}

function applyCase(text: string, mode: string): string {
    if (mode === "upper") return text.toUpperCase();
    if (mode === "lower") return text.toLowerCase();
    if (mode === "capitalize") return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    return text;
}

function isGroupDM(type?: number) { return type === 3; }
function isTrueDM(type?: number)  { return type === 1; }

function getTargetChannelId(): string | null {
    if (lockedChannelId) return lockedChannelId;
    return getCurrentChannel()?.id ?? null;
}

function getActiveWordPool(): string[] {
    const sep = settings.store.wordListSeparator || " ";
    const split = (s: string) => (s || "").split(sep).map(w => w.trim()).filter(Boolean);
    const ch = getCurrentChannel();
    const trueDM = isTrueDM(ch?.type);
    const useMale   = genderMode !== "female" && genderMode !== "neutral";
    const useFemale = genderMode !== "male"   && genderMode !== "neutral";
    const add = (key: keyof WordLists) => listEnabled[key] ? split(wordLists[key]) : [];

    let pool = add("general");
    if (autoChannel) {
        if (trueDM) {
            pool = [...pool, ...add("dmGeneral")];
            if (useMale)   pool = [...pool, ...add("dmMale")];
            if (useFemale) pool = [...pool, ...add("dmFemale")];
        } else {
            pool = [...pool, ...add("serverGeneral")];
            if (useMale)   pool = [...pool, ...add("serverMale")];
            if (useFemale) pool = [...pool, ...add("serverFemale")];
        }
    } else {
        pool = [...pool, ...add("dmGeneral"), ...add("serverGeneral")];
        if (useMale)   pool = [...pool, ...add("dmMale"),   ...add("serverMale")];
        if (useFemale) pool = [...pool, ...add("dmFemale"), ...add("serverFemale")];
    }
    return pool.length ? pool : ["hello"];
}

function buildSentence(): string {
    const pool = getActiveWordPool();
    const outSep = settings.store.showSeparatorInOutput
        ? (settings.store.outputSeparator || settings.store.wordListSeparator || " ")
        : " ";
    const lenMin = Math.max(1, settings.store.sentenceLenMin ?? 4);
    const lenMax = Math.max(lenMin, settings.store.sentenceLenMax ?? 8);
    const len = lenMin === lenMax ? lenMin : Math.floor(Math.random() * (lenMax - lenMin + 1)) + lenMin;
    const picked = Array.from({ length: len }, () => pool[Math.floor(Math.random() * pool.length)]);
    const joined = picked.join(outSep);
    const cased = applyCase(joined, settings.store.capsMode || "none");
    return cased + (settings.store.periodEnabled ? (settings.store.periodChar || ".") : "");
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function getRandDelay(): number {
    const min = Math.max(100, settings.store.randomDelayMin ?? 800);
    const max = Math.max(min + 100, settings.store.randomDelayMax ?? 3000);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function applyJitter(base: number): number {
    if (!settings.store.variableDelayEnabled) return base;
    const j = Math.max(0, settings.store.jitterMs ?? 25);
    return Math.max(100, base + Math.floor(Math.random() * (j * 2 + 1)) - j);
}

async function sendBurst() {
    const chId = getTargetChannelId();
    if (!chId) return;
    const pool = getActiveWordPool();
    const hasWords = pool.length > 1 || pool[0] !== "hello";
    const n = hasWords ? Math.max(1, settings.store.spamCount ?? 1) : 1;
    for (let i = 0; i < n; i++) {
        if (!isRepeating) break;
        try { await sendMessage(chId, { content: buildSentence() }); } catch { }
        if (i < n - 1) await wait(300);
    }
}

async function sendEntry(entry: MessageEntry) {
    if (!isRepeating) return;
    const chId = getTargetChannelId();
    if (!chId) return;
    try { await sendMessage(chId, { content: entry.message }); } catch { return; }
    if (!settings.store.randomWordsEnabled) return;
    await wait(500);
    await sendBurst();
}

function scheduleEntry(entry: MessageEntry) {
    if (!isRepeating) return;
    const d = applyJitter(parseDelay(entry.delay));
    activeTimers.push(setTimeout(async () => { await sendEntry(entry); scheduleEntry(entry); }, d));
}

async function startRandomLoop() {
    const loop = async () => {
        if (!isRepeating) return;
        await sendBurst();
        activeTimers.push(setTimeout(loop, getRandDelay()));
    };
    activeTimers.push(setTimeout(loop, 0));
}

async function startRepeating() {
    if (isRepeating || !getCurrentChannel()) return;
    if (!messageEntries.length && !settings.store.randomWordsEnabled) return;
    isRepeating = true;
    lockedChannelId = settings.store.lockToChannel ? (getCurrentChannel()?.id ?? null) : null;
    activeTimers = [];
    if (!messageEntries.length) { await startRandomLoop(); return; }
    messageEntries.forEach((e, i) => activeTimers.push(setTimeout(async () => { await sendEntry(e); scheduleEntry(e); }, i * 100)));
}

function stopRepeating() {
    isRepeating = false;
    lockedChannelId = null;
    activeTimers.forEach(clearTimeout);
    activeTimers = [];
}

function handleChannelSelect() {
    if (!settings.store.lockToChannel) stopRepeating();
}

function toggleRepeating() { isRepeating ? stopRepeating() : startRepeating(); }

const save = {
    entries: () => DataStore.set(STORE.ENTRIES, messageEntries),
    lists:   () => DataStore.set(STORE.LISTS, wordLists),
    enabled: () => DataStore.set(STORE.ENABLED, listEnabled),
    gender:  () => DataStore.set(STORE.GENDER, genderMode),
    auto:    () => DataStore.set(STORE.AUTO_CH, autoChannel),
};

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
    const combo = settings.store.keybind;
    if (combo && matchesKeybind(e, combo)) { e.preventDefault(); toggleRepeating(); }
}

function fmtDatetime() {
    const n = new Date();
    const p = (v: number, l = 2) => String(v).padStart(l, "0");
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}_${p(n.getHours())}-${p(n.getMinutes())}-${p(n.getSeconds())}`;
}

function exportSettings() {
    const data = {
        exportedAt: new Date().toISOString(),
        messageEntries, wordLists, listEnabled, genderMode, autoChannel,
        settings: {
            spamCount: settings.store.spamCount, randomDelayMin: settings.store.randomDelayMin,
            randomDelayMax: settings.store.randomDelayMax, variableDelayEnabled: settings.store.variableDelayEnabled,
            jitterMs: settings.store.jitterMs, randomWordsEnabled: settings.store.randomWordsEnabled,
            capsMode: settings.store.capsMode, periodEnabled: settings.store.periodEnabled,
            periodChar: settings.store.periodChar, wordListSeparator: settings.store.wordListSeparator,
            outputSeparator: settings.store.outputSeparator, showSeparatorInOutput: settings.store.showSeparatorInOutput,
            keybind: settings.store.keybind,
        },
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `AMR_${fmtDatetime()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function importSettings(json: string): Promise<string> {
    try {
        const data = JSON.parse(json);
        if (data.messageEntries) { messageEntries = data.messageEntries; await save.entries(); }
        if (data.wordLists)      { wordLists = { ...DEFAULT_LISTS, ...data.wordLists }; await save.lists(); }
        if (data.listEnabled)    { listEnabled = { ...DEFAULT_ENABLED, ...data.listEnabled }; await save.enabled(); }
        if (data.genderMode)     { genderMode = data.genderMode; await save.gender(); }
        if (typeof data.autoChannel === "boolean") { autoChannel = data.autoChannel; await save.auto(); }
        if (data.settings) Object.entries(data.settings).forEach(([k, v]) => { (settings.store as any)[k] = v; });
        return "✅ Imported successfully!";
    } catch { return "❌ Invalid JSON — import failed."; }
}

const AMR_CSS = `
.amr-wrap input,.amr-wrap textarea{background:#16171a!important;color:#fff!important;border:1.5px solid #505260!important;border-radius:4px!important}
.amr-wrap input:focus,.amr-wrap textarea:focus{border-color:var(--brand-experiment)!important;outline:none!important}
.amr-wrap input::placeholder,.amr-wrap textarea::placeholder{color:#5a5d6b!important}
.amr-sec{margin-bottom:9px;padding-bottom:9px;border-bottom:1px solid #27282d}
.amr-sec:last-child{border-bottom:none;padding-bottom:0;margin-bottom:0}
.amr-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9096a8;margin-bottom:5px;display:block}
.amr-hint{font-size:10px;color:#6b6f7e;margin-top:3px;line-height:1.35}
.amr-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.amr-warn{font-size:10px;color:#faa61a;background:rgba(250,166,26,.1);border:1px solid rgba(250,166,26,.3);border-radius:4px;padding:5px 8px;margin-top:5px;line-height:1.35}
.amr-pill{padding:4px 11px;border-radius:20px;cursor:pointer;font-size:11px;font-weight:700;border:2px solid;transition:background .12s,color .12s,border-color .12s;user-select:none;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;box-sizing:border-box;line-height:1.4}
.amr-pill:hover{filter:brightness(1.15)}
.amr-numbox{padding:3px 6px;border-radius:4px;font-size:11px;background:#16171a;border:1.5px solid #505260;color:#fff;outline:none;text-align:center}
.amr-numbox:focus{border-color:var(--brand-experiment)}
.amr-nbtn{cursor:pointer;width:22px;height:22px;border-radius:4px;background:#2b2d31;border:1.5px solid #505260;color:#c0c4d0;font-size:14px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;user-select:none;flex-shrink:0;line-height:1}
.amr-nbtn:hover{background:#3a3b40;color:#fff}
`;

function injectCSS() {
    if (document.getElementById("amr-css")) return;
    const el = document.createElement("style");
    el.id = "amr-css";
    el.textContent = AMR_CSS;
    document.head.appendChild(el);
}

function Pill({ active, color, onClick, children, style }: {
    active: boolean; color: string; onClick?: () => void;
    children: React.ReactNode; style?: React.CSSProperties;
}) {
    const s: React.CSSProperties = active
        ? { borderColor: color, background: color, color: "#fff" }
        : { borderColor: color, background: "transparent", color };
    return (
        <span className="amr-pill" onClick={onClick} style={{ ...s, ...style }}>
            {children}
        </span>
    );
}

function TogglePill({ active, color, onToggle, on, off }: {
    active: boolean; color: string; onToggle: () => void; on: string; off: string;
}) {
    return (
        <Pill active={active} color={color} onClick={onToggle}>
            <span style={{ fontSize: 9, marginRight: 1 }}>{active ? "●" : "○"}</span>
            {active ? on : off}
        </Pill>
    );
}

function Lbl({ children, hint }: { children: React.ReactNode; hint?: string; }) {
    return (
        <>
            <span className="amr-lbl">{children}</span>
            {hint && <div className="amr-hint" style={{ marginTop: -3, marginBottom: 5 }}>{hint}</div>}
        </>
    );
}

function NumStepper({ value, min, onChange }: { value: number; min?: number; onChange: (v: number) => void; }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span className="amr-nbtn" onClick={() => onChange(Math.max(min ?? 0, value - 1))}>−</span>
            <span style={{ minWidth: 24, textAlign: "center" as const, fontWeight: 700, color: "#fff", fontSize: 12 }}>{value}</span>
            <span className="amr-nbtn" onClick={() => onChange(value + 1)}>+</span>
        </span>
    );
}

function NumInput({ value, min, width, storeKey, onDone }: {
    value: number; min?: number; width?: number; storeKey: string; onDone: () => void;
}) {
    return (
        <input type="number" className="amr-numbox" min={min} defaultValue={value}
            style={width ? { width } : undefined}
            onBlur={e => {
                const v = parseInt((e.target as HTMLInputElement).value);
                (settings.store as any)[storeKey] = isNaN(v) ? (min ?? 0) : Math.max(min ?? 0, v);
                onDone();
            }}
        />
    );
}

function GenderSelector({ onUpdate }: { onUpdate?: () => void; }) {
    const update = useForceUpdater();
    const MODES: { v: GenderMode; l: string; c: string; desc: string; }[] = [
        { v: "all",     l: "All ♂+♀+⊘", c: "#9b59b6", desc: "General + Male + Female lists" },
        { v: "male",    l: "Male ♂",      c: "#5dade2", desc: "General + Male lists only (Female excluded)" },
        { v: "female",  l: "Female ♀",    c: "#ec407a", desc: "General + Female lists only (Male excluded)" },
        { v: "neutral", l: "Neutral ⊘",   c: "#78909c", desc: "General lists only (both Male and Female excluded)" },
    ];
    const cur = MODES.find(m => m.v === genderMode);
    return (
        <div>
            <div className="amr-row">
                {MODES.map(m => (
                    <Pill key={m.v} active={genderMode === m.v} color={m.c}
                        onClick={() => { genderMode = m.v; save.gender(); update(); onUpdate?.(); }}>
                        {m.l}
                    </Pill>
                ))}
            </div>
            {cur && (
                <div className="amr-hint" style={{ marginTop: 4, color: "#8a8e9a" }}>
                    ℹ️  {cur.desc}  ·  General (Neutral) lists are <b style={{ color: "#b0b4c0" }}>always included</b> regardless of gender mode.
                    {genderMode === "male" && " ♂ Selecting Male also keeps Neutral lists — to exclude Neutral, disable list ① manually."}
                </div>
            )}
        </div>
    );
}

function ListEnableToggles({ onUpdate }: { onUpdate?: () => void; }) {
    const update = useForceUpdater();
    return (
        <div className="amr-row" style={{ gap: 4 }}>
            {LIST_META.map(m => (
                <Pill key={m.key} active={listEnabled[m.key]} color={m.color}
                    onClick={() => { listEnabled[m.key] = !listEnabled[m.key]; save.enabled(); update(); onUpdate?.(); }}>
                    {m.short}
                </Pill>
            ))}
        </div>
    );
}

function WordListsEditor() {
    const update = useForceUpdater();
    const [open, setOpen] = React.useState<number | null>(0);
    const sep = settings.store.wordListSeparator || " ";

    return (
        <div className="amr-wrap" style={{ marginTop: 2 }}>
            {LIST_META.map((meta, i) => (
                <div key={meta.key} style={{ marginBottom: 4 }}>
                    <div onClick={() => setOpen(open === i ? null : i)} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 10px", cursor: "pointer", userSelect: "none" as const,
                        background: open === i ? `${meta.color}22` : `${meta.color}0d`,
                        border: `2px solid ${meta.color}`,
                        borderBottom: open === i ? "none" : `2px solid ${meta.color}`,
                        borderRadius: open === i ? "5px 5px 0 0" : 5,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                            {!listEnabled[meta.key] && <span style={{ fontSize: 9, color: "#444", fontStyle: "italic" }}>disabled</span>}
                        </div>
                        <span style={{ color: meta.color, fontSize: 9, fontWeight: 700 }}>{open === i ? "▲" : "▼"}</span>
                    </div>
                    {open === i && (
                        <textarea
                            value={wordLists[meta.key] || ""}
                            onChange={e => { wordLists[meta.key] = (e.target as HTMLTextAreaElement).value; save.lists(); update(); }}
                            placeholder={`Entries separated by "${sep === " " ? "space" : sep}"`}
                            style={{
                                width: "100%", minHeight: 64, resize: "vertical" as const, display: "block",
                                background: "#16171a", border: `2px solid ${meta.color}`, borderTop: "none",
                                borderRadius: "0 0 5px 5px", color: "#e0e0e0", fontSize: 12, padding: "6px 10px",
                                boxSizing: "border-box" as const, fontFamily: "inherit", outline: "none", lineHeight: 1.5,
                            }}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}

function SpamCountSelector() {
    const update = useForceUpdater();
    const count = settings.store.spamCount ?? 1;
    const pool = getActiveWordPool();
    const hasWords = pool.length > 1 || pool[0] !== "hello";
    return (
        <div>
            <NumStepper value={count} min={1} onChange={v => { settings.store.spamCount = v; update(); }} />
            {!hasWords && (
                <div className="amr-warn" style={{ marginTop: 4 }}>
                    ⚠ Burst count ignored — no words found in the active lists. Add words to the enabled pools first.
                </div>
            )}
        </div>
    );
}

function KeybindRecorder() {
    const update = useForceUpdater();
    const [recording, setRecording] = React.useState(false);
    const [preview, setPreview] = React.useState("");
    const current = settings.store.keybind || "";

    React.useEffect(() => {
        if (!recording) { setPreview(""); return; }

        const MODS = ["Control", "Shift", "Alt", "Meta"];

        const onKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") { setRecording(false); return; }

            const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;

            const parts: string[] = [];
            if (e.ctrlKey)  parts.push("Ctrl");
            if (e.shiftKey) parts.push("Shift");
            if (e.altKey)   parts.push("Alt");
            if (e.metaKey)  parts.push("Meta");

            if (MODS.includes(k)) {
                setPreview(parts.join("+") + "+…");
                return;
            }

            parts.push(k);
            settings.store.keybind = parts.join("+");
            update();
            setRecording(false);
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
            const parts: string[] = [];
            if (e.ctrlKey)  parts.push("Ctrl");
            if (e.shiftKey) parts.push("Shift");
            if (e.altKey)   parts.push("Alt");
            if (e.metaKey)  parts.push("Meta");
            setPreview(parts.length ? parts.join("+") + "+…" : "");
        };

        window.addEventListener("keydown", onKeyDown, { capture: true });
        window.addEventListener("keyup",   onKeyUp,   { capture: true });
        return () => {
            window.removeEventListener("keydown", onKeyDown, { capture: true });
            window.removeEventListener("keyup",   onKeyUp,   { capture: true });
        };
    }, [recording]);

    const display = recording ? (preview || "Hold modifiers, then press a key…") : (current || "Not set");

    return (
        <div className="amr-wrap" style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{
                fontSize: 12, fontWeight: 700, minWidth: 180, padding: "4px 9px",
                background: "#16171a", border: `1.5px solid ${recording ? "#ff9800" : "#3a3b40"}`,
                borderRadius: 4, color: recording ? "#ff9800" : "#e0e0e0", fontFamily: "monospace",
            }}>
                {display}
            </span>
            <Pill active={recording} color="#ff9800" onClick={() => setRecording(r => !r)}>
                {recording ? "✕ Cancel" : "⌨ Record"}
            </Pill>
            {current && !recording && (
                <Pill active={false} color="#f04747" onClick={() => { settings.store.keybind = ""; update(); }}>Clear</Pill>
            )}
            {!recording && <span style={{ fontSize: 10, color: "#6b6f7e" }}>e.g. Ctrl+Shift+A  ·  Alt+F1  ·  Ctrl+Alt+R</span>}
        </div>
    );
}

function KeybindSection() {
    return (
        <div>
            <span className="amr-lbl" style={{ marginBottom: 7 }}>Keybind  —  hold modifiers (Ctrl / Shift / Alt / Meta) then press any key</span>
            <KeybindRecorder />
        </div>
    );
}

function WordListsSection() {
    return (
        <div>
            <span className="amr-lbl" style={{ marginBottom: 7 }}>Random Word Lists  —  7 color-coded pools · click a list header to expand and edit</span>
            <WordListsEditor />
        </div>
    );
}

function MessageEntries() {
    const update = useForceUpdater();
    React.useEffect(() => {
        injectCSS();
        DataStore.get(STORE.ENTRIES).then(v => { messageEntries = v ?? []; update(); });
    }, []);

    const setMsg = async (id: string, v: string) => { const i = messageEntries.findIndex(e => e.id === id); if (i >= 0) { messageEntries[i].message = v; await save.entries(); update(); } };
    const setDly = async (id: string, v: string) => { const i = messageEntries.findIndex(e => e.id === id); if (i >= 0) { messageEntries[i].delay = v; await save.entries(); update(); } };
    const add    = async () => { messageEntries.push({ id: generateId(), message: "Hello!", delay: "1s" }); await save.entries(); update(); };
    const rem    = async (id: string) => { const i = messageEntries.findIndex(e => e.id === id); if (i >= 0) { messageEntries.splice(i, 1); await save.entries(); update(); } };
    const reset  = async () => { messageEntries.length = 0; await DataStore.set(STORE.ENTRIES, []); update(); };

    const FL: React.CSSProperties = { fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--text-muted)", marginBottom: 3 };

    return (
        <div className="amr-wrap">
            {messageEntries.length === 0 && (
                <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11, padding: "7px 10px", border: "1px dashed #3a3b40", borderRadius: 5, marginBottom: 7 }}>
                    No messages — enable <b>Random Words</b> to run in random-only mode.
                </div>
            )}
            {messageEntries.map((e, i) => (
                <div key={e.id} style={{ background: "#16171a", border: "1px solid #2e2f34", borderRadius: 5, padding: "7px 9px", marginBottom: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>Message {i + 1}</span>
                        <span onClick={() => rem(e.id)} style={{ cursor: "pointer", color: "#f04747", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✕</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <div style={{ flex: 1 }}>
                            <div style={FL}>Message</div>
                            <TextInput placeholder="Hello!" value={e.message} onChange={v => setMsg(e.id, v)} />
                        </div>
                        <div style={{ width: 95 }}>
                            <div style={FL}>Delay</div>
                            <TextInput placeholder="1s" value={e.delay} onChange={v => setDly(e.id, v)} />
                            <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>ms · s · m · h</div>
                        </div>
                    </div>
                </div>
            ))}
            <div className="amr-row" style={{ marginTop: 4 }}>
                <Pill active={false} color="#43b581" onClick={add}>+ Add</Pill>
                {messageEntries.length > 0 && <Pill active={true} color="#f04747" onClick={reset}>Reset All</Pill>}
            </div>
        </div>
    );
}

function ExportImportPanel() {
    const [status, setStatus] = React.useState("");
    const fileRef = React.useRef<HTMLInputElement>(null);

    const doExport = () => { exportSettings(); setStatus("✅ Exported!"); setTimeout(() => setStatus(""), 2500); };
    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const text = await file.text();
        const msg = await importSettings(text);
        setStatus(msg);
        (e.target as HTMLInputElement).value = "";
        setTimeout(() => setStatus(""), 3500);
    };

    return (
        <div className="amr-wrap">
            <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={onFileChange} />
            <div className="amr-row">
                <Pill active={false} color="#7c4dff" onClick={doExport}>⬇ Export JSON</Pill>
                <Pill active={false} color="#7c4dff" onClick={() => fileRef.current?.click()}>⬆ Import JSON</Pill>
                {status && <span style={{ fontSize: 10, color: status.startsWith("✅") ? "#43b581" : "#f04747" }}>{status}</span>}
            </div>
            <div className="amr-hint">Export saves a timestamped .json file. Import opens file explorer to load a previous export.</div>
        </div>
    );
}

function GenderAndChannelSetting() {
    const update = useForceUpdater();
    React.useEffect(() => {
        Promise.all([DataStore.get(STORE.GENDER), DataStore.get(STORE.AUTO_CH), DataStore.get(STORE.ENABLED)])
            .then(([g, ac, en]) => {
                if (g) genderMode = g;
                if (ac !== undefined) autoChannel = ac;
                if (en) listEnabled = { ...DEFAULT_ENABLED, ...en };
                update();
            });
    }, []);
    return (
        <div>
            <div className="amr-row" style={{ marginBottom: 8 }}>
                <TogglePill active={autoChannel} color="#43b581"
                    onToggle={() => { autoChannel = !autoChannel; save.auto(); update(); }}
                    on="Auto channel detection ON" off="Manual mode (all lists combined)" />
            </div>
            <div className="amr-hint" style={{ marginBottom: 8 }}>
                When <b style={{ color: "#43b581" }}>ON</b>: 1-on-1 DMs use DM lists · Group DMs and Servers use Server/Group lists.<br />
                When <b style={{ color: "#c0c4d0" }}>OFF</b>: all lists are combined with no channel discrimination.
            </div>
            <span className="amr-lbl">Gender Mode</span>
            <GenderSelector onUpdate={update} />
            <div style={{ marginTop: 10 }}>
                <span className="amr-lbl">Active Lists  —  click to toggle individual pools</span>
                <ListEnableToggles onUpdate={update} />
            </div>
        </div>
    );
}

function JitterEditor() {
    const update = useForceUpdater();
    return (
        <div>
            <div className="amr-row">
                <TogglePill active={settings.store.variableDelayEnabled} color="#ffa726"
                    onToggle={() => { settings.store.variableDelayEnabled = !settings.store.variableDelayEnabled; update(); }}
                    on="Jitter ON" off="Jitter OFF" />
                {settings.store.variableDelayEnabled && (
                    <>
                        <span style={{ fontSize: 11, color: "#9096a8" }}>±</span>
                        <input type="number" className="amr-numbox" min={0} defaultValue={settings.store.jitterMs ?? 25}
                            style={{ width: 55 }}
                            onBlur={e => { const v = parseInt((e.target as HTMLInputElement).value); settings.store.jitterMs = isNaN(v) ? 0 : Math.max(0, v); update(); }}
                        />
                        <span style={{ fontSize: 11, color: "#9096a8" }}>ms</span>
                    </>
                )}
            </div>
            <div className="amr-hint">
                When <b style={{ color: "#ffa726" }}>ON</b>: each scheduled message has a random offset of ±N ms applied to its delay, making the timing irregular and harder for Discord to flag as automated. Set to 0 to disable the offset while keeping the toggle on.
            </div>
        </div>
    );
}

function DelayRangeEditor() {
    const update = useForceUpdater();
    return (
        <div>
            <div className="amr-row">
                <span style={{ fontSize: 10, color: "#9096a8", minWidth: 90 }}>Min wait between bursts</span>
                <input type="number" className="amr-numbox" min={100} defaultValue={settings.store.randomDelayMin ?? 800}
                    style={{ width: 68 }}
                    onBlur={e => { const v = parseInt((e.target as HTMLInputElement).value); settings.store.randomDelayMin = Math.max(100, isNaN(v) ? 800 : v); update(); }} />
                <span style={{ fontSize: 10, color: "#7a7e8e" }}>ms</span>
            </div>
            <div className="amr-row" style={{ marginTop: 4 }}>
                <span style={{ fontSize: 10, color: "#9096a8", minWidth: 90 }}>Max wait between bursts</span>
                <input type="number" className="amr-numbox" min={100} defaultValue={settings.store.randomDelayMax ?? 3000}
                    style={{ width: 68 }}
                    onBlur={e => { const v = parseInt((e.target as HTMLInputElement).value); settings.store.randomDelayMax = Math.max(100, isNaN(v) ? 3000 : v); update(); }} />
                <span style={{ fontSize: 10, color: "#7a7e8e" }}>ms</span>
            </div>
            <div className="amr-hint">A random wait between Min and Max ms is picked before each new burst of random sentences.</div>
        </div>
    );
}

function SentenceLengthEditor() {
    const update = useForceUpdater();
    const mkInput = (val: number, key: "sentenceLenMin" | "sentenceLenMax") => (
        <input type="number" className="amr-numbox" min={1} max={50} defaultValue={val} style={{ width: 50 }}
            onBlur={e => {
                const v = parseInt((e.target as HTMLInputElement).value);
                (settings.store as any)[key] = isNaN(v) ? (key === "sentenceLenMin" ? 4 : 8) : Math.max(1, Math.min(50, v));
                update();
            }} />
    );
    return (
        <div>
            <div className="amr-row">
                <span style={{ fontSize: 10, color: "#9096a8", minWidth: 78 }}>Min words/sentence</span>
                {mkInput(settings.store.sentenceLenMin ?? 4, "sentenceLenMin")}
                <span style={{ fontSize: 10, color: "#9096a8", minWidth: 78, marginLeft: 6 }}>Max words/sentence</span>
                {mkInput(settings.store.sentenceLenMax ?? 8, "sentenceLenMax")}
            </div>
            <div className="amr-hint">
                Number of words randomly picked per generated sentence. Current range: <b style={{ color: "#c0c4d0" }}>{settings.store.sentenceLenMin ?? 4}–{settings.store.sentenceLenMax ?? 8}</b> words.
            </div>
        </div>
    );
}

function OutputSeparatorEditor() {
    const update = useForceUpdater();
    return (
        <div>
            <div className="amr-row" style={{ marginBottom: 6 }}>
                <TogglePill active={settings.store.showSeparatorInOutput} color="#26c6da"
                    onToggle={() => { settings.store.showSeparatorInOutput = !settings.store.showSeparatorInOutput; update(); }}
                    on="Custom output separator ON" off="Words joined with space (default)" />
            </div>
            {settings.store.showSeparatorInOutput && (
                <>
                    <div className="amr-row amr-wrap" style={{ marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: "#9096a8" }}>Output separator (shown in chat):</span>
                        <div className="amr-wrap">
                            <input type="text" value={settings.store.outputSeparator ?? ""}
                                placeholder={settings.store.wordListSeparator || " "}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { settings.store.outputSeparator = e.target.value; update(); }}
                                style={{ width: 60, padding: "3px 7px", borderRadius: 4, fontSize: 12 }} />
                        </div>
                    </div>
                    <div className="amr-hint">
                        This character joins words in the generated sentence sent to chat. Leave empty to fall back to the list separator.<br />
                        Example: list separator = <code style={{ color: "#b39ddb", background: "#1a1b1f", padding: "0 3px", borderRadius: 2 }}>§</code> · output separator = <code style={{ color: "#26c6da", background: "#1a1b1f", padding: "0 3px", borderRadius: 2 }}>,</code> → sentence: <i style={{ color: "#b0b4c0" }}>word1,word2,word3</i>
                    </div>
                </>
            )}
            {!settings.store.showSeparatorInOutput && (
                <div className="amr-hint">Words in generated sentences will always be joined with a plain space.</div>
            )}
        </div>
    );
}

function RepeaterModal(props: ModalProps) {
    const update = useForceUpdater();
    const ch = getCurrentChannel();
    const trueDM = isTrueDM(ch?.type);
    const groupDM = isGroupDM(ch?.type);
    const showWarn = autoChannel && trueDM && genderMode === "all";

    let chLabel = "⚠ No channel";
    if (ch) {
        if (trueDM) chLabel = "📨 DM (1-on-1)";
        else if (groupDM) chLabel = "👥 Group DM → Server lists";
        else chLabel = "🖥 Server / Channel";
    }

    return (
        <ModalRoot {...props}>
            <ModalHeader>
                <HeadingTertiary>Auto Message Repeater</HeadingTertiary>
                <span style={{ marginLeft: "auto", fontSize: 11, color: isRepeating ? "#43b581" : "#6b6f7e", fontWeight: 700 }}>
                    {isRepeating ? "▶ Running" : "⏹ Stopped"}
                    <span style={{ margin: "0 6px", color: "#2e2f34" }}>·</span>
                    <span style={{ color: "#8a8e9a", fontWeight: 400 }}>{chLabel}</span>
                </span>
            </ModalHeader>

            <ModalContent style={{ padding: "12px 16px" }}>

                <div className="amr-sec">
                    <span className="amr-lbl">Messages</span>
                    <MessageEntries />
                </div>

                <div className="amr-sec">
                    <div className="amr-row" style={{ marginBottom: 4 }}>
                        <span className="amr-lbl" style={{ margin: 0 }}>Random Words</span>
                        <TogglePill active={settings.store.randomWordsEnabled} color="#9b59b6"
                            onToggle={() => { settings.store.randomWordsEnabled = !settings.store.randomWordsEnabled; update(); }}
                            on="ON" off="OFF" />
                        <span style={{ fontSize: 10, color: "#9096a8" }}>burst:</span>
                        <SpamCountSelector />
                    </div>
                    <DelayRangeEditor />
                    <div style={{ marginTop: 5 }}>
                        <SentenceLengthEditor />
                    </div>
                </div>

                <div className="amr-sec">
                    <span className="amr-lbl">Random Word Lists</span>
                    <WordListsEditor />
                </div>

                <div className="amr-sec">
                    <div className="amr-row" style={{ marginBottom: 4 }}>
                        <span className="amr-lbl" style={{ margin: 0 }}>Channel Detection</span>
                        <TogglePill active={autoChannel} color="#43b581"
                            onToggle={() => { autoChannel = !autoChannel; save.auto(); update(); }}
                            on="Auto" off="Manual" />
                        <span style={{ fontSize: 10, color: "#8a8e9a" }}>
                            {autoChannel
                                ? trueDM ? "DM lists" : groupDM ? "Server lists (Group DM)" : "Server lists"
                                : "all combined"}
                        </span>
                    </div>
                    <span className="amr-lbl">Gender Mode</span>
                    <GenderSelector onUpdate={update} />
                    {showWarn && <div className="amr-warn">⚠ 1-on-1 DM in <b>All</b> mode — gender unknown, both ♂ and ♀ lists active.</div>}
                </div>

                <div className="amr-sec">
                    <span className="amr-lbl">Active Word Lists</span>
                    <ListEnableToggles onUpdate={update} />
                </div>

                <div className="amr-sec">
                    <div className="amr-row" style={{ marginBottom: 3 }}>
                        <span className="amr-lbl" style={{ margin: 0 }}>Entry Jitter</span>
                    </div>
                    <JitterEditor />
                </div>

                <div className="amr-sec">
                    <span className="amr-lbl">Capitalization</span>
                    <div className="amr-row" style={{ marginBottom: 7 }}>
                        {([ ["none", "None"], ["capitalize", "Cap"], ["upper", "CAPS"], ["lower", "lower"] ] as const).map(([v, l]) => (
                            <Pill key={v} active={(settings.store.capsMode || "none") === v} color="#7c4dff"
                                onClick={() => { settings.store.capsMode = v; update(); }}>{l}</Pill>
                        ))}
                    </div>
                    <div className="amr-row">
                        <span className="amr-lbl" style={{ margin: 0 }}>Suffix</span>
                        <TogglePill active={!!settings.store.periodEnabled} color="#78909c"
                            onToggle={() => { settings.store.periodEnabled = !settings.store.periodEnabled; update(); }}
                            on="On" off="Off" />
                        {settings.store.periodEnabled && (
                            <div className="amr-wrap">
                                <input type="text" value={settings.store.periodChar || "."} placeholder="."
                                    onChange={e => { settings.store.periodChar = (e.target as HTMLInputElement).value; update(); }}
                                    style={{ width: 38, padding: "2px 5px", borderRadius: 4, fontSize: 12 }} />
                            </div>
                        )}
                        <span style={{ fontSize: 10, color: "#8a8e9a" }}>appended to each sentence</span>
                    </div>
                </div>

                <div className="amr-sec">
                    <div className="amr-row">
                        <span className="amr-lbl" style={{ margin: 0 }}>List Sep.</span>
                        <div className="amr-wrap">
                            <input type="text" value={settings.store.wordListSeparator ?? " "}
                                onChange={e => { settings.store.wordListSeparator = (e.target as HTMLInputElement).value; update(); }}
                                placeholder="space" style={{ width: 52, padding: "2px 5px", borderRadius: 4, fontSize: 12 }} />
                        </div>
                        <span className="amr-lbl" style={{ margin: "0 0 0 6px" }}>Output Sep.</span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                        <OutputSeparatorEditor />
                    </div>
                </div>

                <div className="amr-sec">
                    <span className="amr-lbl">Keybind  —  Ctrl / Shift / Alt / Meta + any key</span>
                    <KeybindRecorder />
                </div>

                <div className="amr-sec">
                    <span className="amr-lbl">Export / Import</span>
                    <ExportImportPanel />
                </div>

            </ModalContent>

            <ModalFooter>
                {isRepeating
                    ? <Pill active={true} color="#f04747" onClick={() => { stopRepeating(); props.onClose(); }}>⏹ Stop</Pill>
                    : <Pill active={true} color="#43b581" onClick={() => { startRepeating(); props.onClose(); }}>▶ Start Repeating</Pill>
                }
                <span style={{ flex: 1 }} />
                <TogglePill
                    active={!!settings.store.lockToChannel}
                    color="#ff9800"
                    onToggle={() => { settings.store.lockToChannel = !settings.store.lockToChannel; update(); }}
                    on="🔒 Lock to Channel"
                    off="🔓 Lock to Channel"
                />
                <span style={{ flex: 1 }} />
                <Pill active={false} color="#505260" onClick={props.onClose}>Cancel</Pill>
            </ModalFooter>
        </ModalRoot>
    );
}

function buildRepeaterModal() {
    openModal(props => <RepeaterModal {...props} />);
}

const RepeaterContextMenu: NavContextMenuPatchCallback = children => {
    const group = findGroupChildrenByChildId("submit-button", children as (React.ReactElement | null | undefined)[]);
    if (!group) return;
    const idx = group.findIndex(c => c?.props?.id === "submit-button");
    group.splice(idx >= 0 ? idx : 0, 0,
        <Menu.MenuItem id="vc-amr" label="Auto Message Repeater">
            <Menu.MenuItem
                id="vc-amr-toggle"
                label={isRepeating ? "⏹ Stop Repeater" : "▶ Start Repeater"}
                action={() => toggleRepeating()}
            />
            <Menu.MenuItem
                id="vc-amr-settings"
                label="⚙ Open Settings"
                action={() => buildRepeaterModal()}
            />
        </Menu.MenuItem>
    );
};

const settings = definePluginSettings({
    messages: {
        type: OptionType.COMPONENT,
        description: "Messages to repeat — leave empty and enable Random Words for random-only mode",
        component: MessageEntries,
    },
    randomWordsEnabled: {
        type: OptionType.BOOLEAN,
        description: "Random Words — send randomly built sentences from active word pools (runs continuously if no message entries set)",
        default: false,
    },
    randomSpamCount: {
        type: OptionType.COMPONENT,
        description: "Sentences per burst — how many random sentences to send at once (ignored if word lists are empty)",
        component: SpamCountSelector,
    },
    randomDelayRange: {
        type: OptionType.COMPONENT,
        description: "Min/Max wait between bursts — a random delay between these two values is chosen before each new burst",
        component: DelayRangeEditor,
    },
    sentenceLengthRange: {
        type: OptionType.COMPONENT,
        description: "Sentence length — min and max number of words randomly picked per generated sentence (1–50)",
        component: SentenceLengthEditor,
    },
    wordListsData: {
        type: OptionType.COMPONENT,
        description: "Random Word Lists — 7 color-coded pools combined based on channel type and gender mode",
        component: WordListsSection,
    },
    genderAndChannel: {
        type: OptionType.COMPONENT,
        description: "Gender mode (which gendered lists to include), channel auto-detection, and per-list enable toggles",
        component: GenderAndChannelSetting,
    },
    variableDelayEnabled: {
        type: OptionType.BOOLEAN,
        description: "Entry Delay Jitter — when ON, adds a random ±N ms offset to each scheduled message to break repeating patterns and help avoid bot-detection",
        default: true,
    },
    jitterMsInput: {
        type: OptionType.COMPONENT,
        description: "Jitter ±ms — max deviation applied per entry. Set to 0 for no offset. Has no effect when Jitter is OFF.",
        component: JitterEditor,
    },
    capsMode: {
        type: OptionType.SELECT,
        description: "Capitalization of generated random sentences",
        options: [
            { label: "None (keep as typed)", value: "none", default: true },
            { label: "Capitalize first letter", value: "capitalize" },
            { label: "ALL CAPS", value: "upper" },
            { label: "all lowercase", value: "lower" },
        ],
    },
    periodEnabled: {
        type: OptionType.BOOLEAN,
        description: "Append suffix — add a custom character at the end of each generated sentence",
        default: true,
    },
    periodCharInput: {
        type: OptionType.COMPONENT,
        description: "Suffix character — character appended when suffix is enabled (default: .)",
        component: () => {
            const update = useForceUpdater();
            return (
                <div className="amr-wrap">
                    <input type="text" value={settings.store.periodChar ?? "."} placeholder="."
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { settings.store.periodChar = e.target.value; update(); }}
                        style={{ width: 55, padding: "5px 9px", borderRadius: 4, fontSize: 13 }} />
                </div>
            );
        },
    },
    wordListSeparatorInput: {
        type: OptionType.COMPONENT,
        description: "Word list separator — character used to split entries in all word lists (default: space). Supports comma, pipe, §, etc.",
        component: () => {
            const update = useForceUpdater();
            return (
                <div className="amr-wrap" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="text" value={settings.store.wordListSeparator ?? " "} placeholder="space"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { settings.store.wordListSeparator = e.target.value; update(); }}
                        style={{ width: 80, padding: "5px 9px", borderRadius: 4, fontSize: 13 }} />
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>default = space · comma, pipe, §, etc.</span>
                </div>
            );
        },
    },
    outputSeparatorSetting: {
        type: OptionType.COMPONENT,
        description: "Output separator — custom character to join words in the generated sentence shown in chat (independent from the list separator)",
        component: OutputSeparatorEditor,
    },
    showSeparatorInOutput: {
        type: OptionType.BOOLEAN,
        description: "Use output separator — when ON, words in generated sentences are joined with the output separator instead of a plain space",
        default: false,
    },
    lockToChannel: {
        type: OptionType.BOOLEAN,
        description: "Lock to Channel — when ON, switching channel does NOT stop the repeater. Messages keep going to the channel where it was started. Turn OFF to restore the default behavior (stops automatically on channel switch).",
        default: false,
    },
    keybindSetting: {
        type: OptionType.COMPONENT,
        description: "Keyboard shortcut to toggle start/stop — hold modifiers (Ctrl/Shift/Alt/Meta) then press any key",
        component: KeybindSection,
    },
    exportImport: {
        type: OptionType.COMPONENT,
        description: "Export all settings, word lists and entries to a timestamped JSON file — or import from a previous export via file picker",
        component: ExportImportPanel,
    },
    wordList:             { type: OptionType.STRING,  description: "", default: DEFAULT_LISTS.general, hidden: true },
    spamCount:            { type: OptionType.NUMBER,  description: "", default: 1,     hidden: true },
    keybind:              { type: OptionType.STRING,  description: "", default: "",    hidden: true },
    randomDelayMin:       { type: OptionType.NUMBER,  description: "", default: 800,   hidden: true },
    randomDelayMax:       { type: OptionType.NUMBER,  description: "", default: 3000,  hidden: true },
    periodChar:           { type: OptionType.STRING,  description: "", default: ".",   hidden: true },
    wordListSeparator:    { type: OptionType.STRING,  description: "", default: " ",   hidden: true },
    outputSeparator:      { type: OptionType.STRING,  description: "", default: "",    hidden: true },
    jitterMs:             { type: OptionType.NUMBER,  description: "", default: 25,    hidden: true },
    sentenceLenMin:       { type: OptionType.NUMBER,  description: "", default: 4,     hidden: true },
    sentenceLenMax:       { type: OptionType.NUMBER,  description: "", default: 8,     hidden: true },
});

const StartIcon: React.FC<{ className?: string; }> = ({ className }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" className={className}><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
);
const StopIcon: React.FC<{ className?: string; }> = ({ className }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" className={className}><path fill="currentColor" d="M6 6h12v12H6z" /></svg>
);

const AMRChatBarRender: ChatBarButtonFactory = ({ isAnyChat }) => {
    const [running, setRunning] = React.useState(isRepeating);

    React.useEffect(() => {
        _openModalFn = buildRepeaterModal;
        return () => { _openModalFn = null; };
    }, []);

    React.useEffect(() => {
        const iv = setInterval(() => { if (running !== isRepeating) setRunning(isRepeating); }, 100);
        return () => clearInterval(iv);
    }, [running]);

    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip={running ? "Ferma Auto Ripetitore" : "Configura e avvia il ripetitore"}
            onClick={() => { if (running) { stopRepeating(); setRunning(false); } else buildRepeaterModal(); }}
        >
            {running ? <StopIcon /> : <StartIcon />}
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "AutoMessageRepeater",
    description: "Repeat messages with smart word-list mixing, gender mode, channel-aware pools, jitter, output separator, and export/import",
    authors: [Devs.x2b, { name: "zFrxncesck1", id: 456195985404592149n }],
    settings,
    dependencies: ["CommandsAPI"],

    contextMenus: {
        "textarea-context": RepeaterContextMenu,
    },

    commands: [{
        name: "amr",
        description: "Control AutoMessageRepeater — configure directly via options",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action",  description: "start | stop | toggle",                                                                                                          type: 3, required: false },
            { name: "panel",   description: "Type anything to open the settings panel",                                                                                       type: 3, required: false },
            { name: "gender",  description: "Set gender mode: all | male | female | neutral",                                                                                 type: 3, required: false },
            { name: "auto",    description: "Channel auto-detection: on | off",                                                                                               type: 3, required: false },
            { name: "lists",   description: "Toggle lists by number (comma-separated): 1=General 2=DM-Gen 3=DM-Male 4=DM-Female 5=Srv-Gen 6=Srv-Male 7=Srv-Female",          type: 3, required: false },
            { name: "random",  description: "Random word bursts: on | off",                                                                                                   type: 3, required: false },
            { name: "jitter",  description: "Entry delay jitter: on | off",                                                                                                   type: 3, required: false },
            { name: "status",  description: "Show current configuration summary",                                                                                             type: 5, required: false },
        ],
        execute(args, ctx) {
            const get = (name: string) => (args as any[]).find(a => a.name === name)?.value;
            const msgs: string[] = [];
            const action = get("action") as string | undefined;
            const panel  = get("panel")  as string | undefined;
            const gender = get("gender") as string | undefined;
            const auto   = get("auto")   as string | undefined;
            const lists  = get("lists")  as string | undefined;
            const random = get("random") as string | undefined;
            const jitter = get("jitter") as string | undefined;
            const status = get("status") as boolean | undefined;

            if (panel !== undefined) {
                _openModalFn?.();
                return;
            }

            if (gender && ["all", "male", "female", "neutral"].includes(gender)) {
                genderMode = gender as GenderMode;
                save.gender();
                const icon = { all: "♂+♀+⊘", male: "♂", female: "♀", neutral: "⊘" }[gender] ?? "";
                msgs.push(`Gender mode → **${gender}** ${icon}`);
                if (gender === "all") {
                    const c = getCurrentChannel();
                    if (c && c.type === 1 && autoChannel)
                        msgs.push("⚠ 1-on-1 DM detected — gender unknown, both ♂ and ♀ lists will be used.");
                }
            }
            if (auto === "on" || auto === "off")     { autoChannel = auto === "on"; save.auto(); msgs.push(`Auto channel detection → **${auto}**`); }
            if (random === "on" || random === "off") { settings.store.randomWordsEnabled = random === "on"; msgs.push(`Random Words → **${random}**`); }
            if (jitter === "on" || jitter === "off") { settings.store.variableDelayEnabled = jitter === "on"; msgs.push(`Entry Jitter → **${jitter}**`); }

            if (lists) {
                const keys = LIST_META.map(m => m.key);
                lists.split(",").map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
                    .forEach(n => { const k = keys[n - 1]; if (k) listEnabled[k] = !listEnabled[k]; });
                save.enabled();
                msgs.push(`Active lists → ${LIST_META.filter(m => listEnabled[m.key]).map(m => m.short).join(", ") || "none"}`);
            }

            if (action === "start")       { startRepeating(); msgs.push(isRepeating ? "▶ AutoMessageRepeater - Started." : "⚠ Nothing to repeat — add messages or enable Random Words."); }
            else if (action === "stop")   { stopRepeating();  msgs.push("⏹ AutoMessageRepeater - Stopped."); }
            else if (action === "toggle" || (!gender && !auto && !lists && !random && !jitter && !status && panel === undefined)) {
                toggleRepeating();
                msgs.push(isRepeating ? "▶ AutoMessageRepeater - Started." : "⏹ AutoMessageRepeater - Stopped.");
            }

            if (status) {
                msgs.push([
                    `**Status:** ${isRepeating ? "▶ AutoMessageRepeater - Running" : "⏹ AutoMessageRepeater - Stopped"}`,
                    `**Gender:** ${genderMode}  ·  **Auto-detect:** ${autoChannel ? "on" : "off"}`,
                    `**Random Words:** ${settings.store.randomWordsEnabled ? "on" : "off"}  (${settings.store.spamCount ?? 1}× burst · ${settings.store.randomDelayMin ?? 800}–${settings.store.randomDelayMax ?? 3000} ms)`,
                    `**Entry Jitter:** ${settings.store.variableDelayEnabled ? `on ±${settings.store.jitterMs ?? 25} ms` : "off"}`,
                    `**Active lists:** ${LIST_META.filter(m => listEnabled[m.key]).map(m => m.short).join(", ") || "none"}`,
                    `**Entries:** ${messageEntries.length}  ·  **Caps:** ${settings.store.capsMode || "none"}  ·  **Keybind:** ${settings.store.keybind || "not set"}`,
                    `**Output separator:** ${settings.store.showSeparatorInOutput ? (settings.store.outputSeparator || "(list sep)") : "space"}`,
                ].join("\n"));
            }

            if (msgs.length) sendBotMessage(ctx.channel.id, { content: msgs.join("\n") });
        },
    }],

    chatBarButton: { icon: StartIcon, render: AMRChatBarRender },

    async start() {
        injectCSS();
        const legacy = await DataStore.get(STORE.LEGACY);
        messageEntries = await DataStore.get(STORE.ENTRIES) ?? legacy ?? [];
        wordLists = { ...DEFAULT_LISTS, ...(await DataStore.get(STORE.LISTS) ?? {}) };
        if (settings.store.wordList && settings.store.wordList !== DEFAULT_LISTS.general && wordLists.general === DEFAULT_LISTS.general) {
            wordLists.general = settings.store.wordList;
            await save.lists();
        }
        listEnabled = { ...DEFAULT_ENABLED, ...(await DataStore.get(STORE.ENABLED) ?? {}) };
        genderMode  = (await DataStore.get(STORE.GENDER))  ?? "all";
        autoChannel = (await DataStore.get(STORE.AUTO_CH)) ?? true;
        FluxDispatcher.subscribe("CHANNEL_SELECT", handleChannelSelect);
        window.addEventListener("beforeunload", stopRepeating);
        window.addEventListener("keydown", onKeyDown, { capture: true });
    },

    stop() {
        stopRepeating();
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", handleChannelSelect);
        window.removeEventListener("beforeunload", stopRepeating);
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        document.getElementById("amr-css")?.remove();
    },
});
