import { DataStore } from "@api/index";
import { UserAreaButton } from "@api/UserArea";
import { definePluginSettings } from "@api/Settings";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, React, RestAPI, TextInput, Toasts, UserStore } from "@webpack/common";

const SK = "GNR_v1";

const C = {
    accent: "#a78bfa",
    accent2: "#7c3aed",
    green: "#4ade80",
    red: "#f87171",
    yellow: "#fbbf24",
    text: "#f5f3ff",
    muted: "#9ca3af",
    bg: "rgba(109,40,217,0.08)",
    border: "rgba(167,139,250,0.2)",
    card: "rgba(15,10,30,0.5)",
};

interface NameEntry {
    id: string;
    value: string;
}

interface HistoryEntry {
    name: string | null;
    ts: number;
}

interface StoreData {
    names: NameEntry[];
    history: HistoryEntry[];
    seqIndex: number;
    lastVal: string | null;
}

let names: NameEntry[] = [];
let history: HistoryEntry[] = [];
let seqIndex = 0;
let lastVal: string | null = null;
let rotatorTimer: ReturnType<typeof setTimeout> | null = null;
let pluginActive = false;

const settings = definePluginSettings({
    intervalSeconds: {
        type: OptionType.NUMBER,
        description: "Rotation interval in seconds. Min 360 recommended!",
        default: 360,
    },
    randomMode: {
        type: OptionType.BOOLEAN,
        description: "Pick names randomly instead of sequentially",
        default: false,
    },
    noDuplicateRandom: {
        type: OptionType.BOOLEAN,
        description: "Avoid repeating the same name consecutively (random mode)",
        default: true,
    },
    jitter: {
        type: OptionType.BOOLEAN,
        description: "Add ±20% random jitter to the interval. Experimental feature!",
        default: false,
    },
    autoStart: {
        type: OptionType.BOOLEAN,
        description: "Start rotating automatically when Discord launches",
        default: true,
    },
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show the quick-access button in the user area",
        default: true,
    },
    maxHistory: {
        type: OptionType.NUMBER,
        description: "Maximum number of history entries to keep",
        default: 25,
    },
    toastOnChange: {
        type: OptionType.BOOLEAN,
        description: "Show a toast notification when the name changes",
        default: false,
    },
});

const saveData = () => DataStore.set(SK, { names, history, seqIndex, lastVal } as StoreData);

function uid(): string {
    return Math.random().toString(36).slice(2, 10);
}

function getIntervalMs(): number {
    const base = Math.max(10, settings.store.intervalSeconds) * 1000;
    if (!settings.store.jitter) return base;
    const delta = base * 0.2;
    return base + (Math.random() * 2 - 1) * delta;
}

function pickNext(): string | null {
    if (!names.length) return null;
    if (!settings.store.randomMode) {
        const val = names[seqIndex % names.length].value;
        seqIndex = (seqIndex + 1) % names.length;
        return val;
    }
    if (names.length === 1) return names[0].value;
    if (settings.store.noDuplicateRandom && lastVal !== null) {
        const pool = names.filter(n => n.value !== lastVal);
        if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)].value;
    }
    return names[Math.floor(Math.random() * names.length)].value;
}

async function applyName(name: string | null): Promise<boolean> {
    try {
        await RestAPI.patch({ url: "/users/@me", body: { global_name: name ?? null } });
        lastVal = name;
        const entry: HistoryEntry = { name, ts: Date.now() };
        history = [entry, ...history].slice(0, Math.max(10, settings.store.maxHistory));
        await saveData();
        if (settings.store.toastOnChange) {
            Toasts.show({
                id: Toasts.genId(),
                message: name ? `Display name → ${name}` : "Display name cleared",
                type: Toasts.Type.SUCCESS,
            });
        }
        return true;
    } catch {
        Toasts.show({
            id: Toasts.genId(),
            message: "Failed to update display name",
            type: Toasts.Type.FAILURE,
        });
        return false;
    }
}

function tick() {
    const val = pickNext();
    if (val !== null) applyName(val);
    rotatorTimer = setTimeout(tick, getIntervalMs());
}

function startRotator() {
    if (rotatorTimer !== null) return;
    if (!names.length) {
        Toasts.show({ id: Toasts.genId(), message: "Add at least one name first", type: Toasts.Type.FAILURE });
        return;
    }
    tick();
}

function stopRotator() {
    if (rotatorTimer === null) return;
    clearTimeout(rotatorTimer);
    rotatorTimer = null;
}

function isRunning() { return rotatorTimer !== null; }

function reorder<T>(arr: T[], from: number, to: number): T[] {
    const r = [...arr];
    const [x] = r.splice(from, 1);
    r.splice(to, 0, x);
    return r;
}

function fmtTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + fmtTime(ts);
}

const s: Record<string, React.CSSProperties> = {
    row: { display: "flex", alignItems: "center", gap: 6 },
    card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 13px", marginBottom: 8 },
    badge: { fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, letterSpacing: 0.5 },
    iconBtn: { background: "none", border: "none", cursor: "pointer", padding: "2px 5px", borderRadius: 6, fontSize: 15, lineHeight: 1 },
    section: { marginBottom: 18 },
    label: { fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1, color: C.muted, marginBottom: 6 },
    pill: { padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", userSelect: "none" as const },
};

function StatusDot({ active }: { active: boolean }) {
    return (
        <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: active ? C.green : C.muted,
            boxShadow: active ? `0 0 6px ${C.green}` : "none",
            flexShrink: 0,
        }} />
    );
}

function Tag({ color, label }: { color: string; label: string }) {
    return <span style={{ ...s.badge, background: color + "22", color, border: `1px solid ${color}55` }}>{label}</span>;
}

function NamesTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [input, setInput] = React.useState("");
    const [dragging, setDragging] = React.useState<number | null>(null);

    const add = () => {
        const v = input.trim().slice(0, 32);
        if (!v || names.find(n => n.value === v)) return;
        names = [...names, { id: uid(), value: v }];
        setInput("");
        saveData();
        forceUpdate();
    };

    const remove = (id: string) => {
        names = names.filter(n => n.id !== id);
        saveData();
        forceUpdate();
    };

    const applyNow = (val: string) => applyName(val);

    const onDragStart = (i: number) => setDragging(i);
    const onDragOver = (e: React.DragEvent, i: number) => {
        e.preventDefault();
        if (dragging !== null && dragging !== i) {
            names = reorder(names, dragging, i);
            setDragging(i);
            forceUpdate();
        }
    };
    const onDrop = () => { setDragging(null); saveData(); };

    return (
        <div style={s.section}>
            <div style={s.label}>Display Names ({names.length})</div>
            <div style={{ ...s.row, marginBottom: 12 }}>
                <TextInput
                    value={input}
                    onChange={setInput}
                    placeholder="Add a display name…"
                    maxLength={32}
                    style={{ flex: 1 }}
                    onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && add()}
                />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={add}>Add</Button>
            </div>
            {names.length === 0 && (
                <div style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "18px 0" }}>
                    No names yet — add one above.
                </div>
            )}
            {names.map((n, i) => (
                <div
                    key={n.id}
                    draggable
                    onDragStart={() => onDragStart(i)}
                    onDragOver={e => onDragOver(e, i)}
                    onDrop={onDrop}
                    style={{
                        ...s.card,
                        cursor: "grab",
                        opacity: dragging === i ? 0.5 : 1,
                        display: "flex", alignItems: "center", gap: 8,
                    }}
                >
                    <span style={{ color: C.muted, fontSize: 12, minWidth: 18, textAlign: "center" }}>⠿</span>
                    <span style={{ flex: 1, color: C.text, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.value}</span>
                    {lastVal === n.value && <Tag color={C.green} label="ACTIVE" />}
                    <button style={{ ...s.iconBtn, color: C.accent }} title="Apply now" onClick={() => applyNow(n.value)}>↑</button>
                    <button style={{ ...s.iconBtn, color: C.red }} title="Remove" onClick={() => remove(n.id)}>✕</button>
                </div>
            ))}
        </div>
    );
}

function ControlTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [running, setRunning] = React.useState(isRunning());
    const [manualInput, setManualInput] = React.useState("");
    const me = UserStore.getCurrentUser();

    const refresh = () => { setRunning(isRunning()); forceUpdate(); };

    const toggle = () => {
        if (isRunning()) stopRotator(); else startRotator();
        refresh();
    };

    const applyManual = async () => {
        const v = manualInput.trim().slice(0, 32);
        if (!v) return;
        await applyName(v);
        setManualInput("");
        refresh();
    };

    const clearName = async () => {
        await applyName(null);
        refresh();
    };

    const skipNext = () => {
        if (!isRunning()) return;
        stopRotator();
        startRotator();
        Toasts.show({ id: Toasts.genId(), message: "Skipped to next name", type: Toasts.Type.MESSAGE });
        refresh();
    };

    return (
        <div style={s.section}>
            <div style={{ ...s.card, marginBottom: 14 }}>
                <div style={{ ...s.row, gap: 10 }}>
                    <StatusDot active={running} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                            Rotator — <span style={{ color: running ? C.green : C.muted }}>{running ? "Running" : "Stopped"}</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                            {running
                                ? `Cycling ${names.length} name${names.length !== 1 ? "s" : ""} every ~${settings.store.intervalSeconds}s`
                                : "Not rotating"}
                        </div>
                    </div>
                    <Tag color={settings.store.randomMode ? C.yellow : C.accent} label={settings.store.randomMode ? "RANDOM" : "SEQ"} />
                </div>
                <div style={{ ...s.row, marginTop: 10, gap: 6 }}>
                    <Button size={Button.Sizes.SMALL} color={running ? Button.Colors.RED : Button.Colors.GREEN} onClick={toggle}>
                        {running ? "Stop" : "Start"}
                    </Button>
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={skipNext} disabled={!running}>Skip</Button>
                </div>
            </div>

            <div style={s.label}>Current Name</div>
            <div style={{ ...s.card, marginBottom: 14 }}>
                <div style={{ ...s.row, gap: 10 }}>
                    {me?.avatar && (
                        <img
                            src={`https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.webp?size=40`}
                            style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }}
                        />
                    )}
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{lastVal ?? (me as any)?.globalName ?? me?.username ?? "—"}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>@{me?.username ?? "unknown"}</div>
                    </div>
                </div>
            </div>

            <div style={s.label}>Manual Override</div>
            <div style={{ ...s.row, marginBottom: 10 }}>
                <TextInput
                    value={manualInput}
                    onChange={setManualInput}
                    placeholder="Type any name…"
                    maxLength={32}
                    style={{ flex: 1 }}
                    onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && applyManual()}
                />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={applyManual}>Set</Button>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={clearName} title="Reset to username">Clear</Button>
            </div>
        </div>
    );
}

function HistoryTab({ forceUpdate }: { forceUpdate: () => void }) {
    const clearHistory = () => { history = []; saveData(); forceUpdate(); };

    return (
        <div style={s.section}>
            <div style={{ ...s.row, marginBottom: 10 }}>
                <div style={{ ...s.label, marginBottom: 0, flex: 1 }}>Recent Changes ({history.length})</div>
                {history.length > 0 && (
                    <button style={{ ...s.iconBtn, color: C.red, fontSize: 12 }} onClick={clearHistory}>Clear All</button>
                )}
            </div>
            {history.length === 0 && (
                <div style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "18px 0" }}>
                    No history yet.
                </div>
            )}
            {history.map((h, i) => (
                <div key={i} style={{ ...s.card, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, color: h.name ? C.text : C.muted, fontWeight: 500 }}>
                            {h.name ?? "(cleared)"}
                        </span>
                    </div>
                    <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>{fmtDate(h.ts)}</span>
                    {h.name && (
                        <button
                            style={{ ...s.iconBtn, color: C.accent }}
                            title="Re-apply"
                            onClick={() => { applyName(h.name); forceUpdate(); }}
                        >↑</button>
                    )}
                </div>
            ))}
        </div>
    );
}

function DataTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [importText, setImportText] = React.useState("");

    const exportData = () => {
        const blob = JSON.stringify({ names: names.map(n => n.value), seqIndex }, null, 2);
        navigator.clipboard.writeText(blob).then(() =>
            Toasts.show({ id: Toasts.genId(), message: "Copied to clipboard!", type: Toasts.Type.SUCCESS })
        );
    };

    const importData = () => {
        try {
            const parsed = JSON.parse(importText.trim());
            const arr: string[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.names) ? parsed.names : []);
            if (!arr.length) throw new Error("No names found");
            const added = arr.filter(v => typeof v === "string" && v.trim()).map(v => ({ id: uid(), value: v.trim().slice(0, 32) }));
            const existing = new Set(names.map(n => n.value));
            const fresh = added.filter(n => !existing.has(n.value));
            names = [...names, ...fresh];
            saveData();
            setImportText("");
            forceUpdate();
            Toasts.show({ id: Toasts.genId(), message: `Imported ${fresh.length} new name(s)`, type: Toasts.Type.SUCCESS });
        } catch {
            Toasts.show({ id: Toasts.genId(), message: "Invalid JSON", type: Toasts.Type.FAILURE });
        }
    };

    const clearAll = () => {
        stopRotator();
        names = [];
        history = [];
        seqIndex = 0;
        lastVal = null;
        saveData();
        forceUpdate();
        Toasts.show({ id: Toasts.genId(), message: "Data cleared", type: Toasts.Type.SUCCESS });
    };

    return (
        <div style={s.section}>
            <div style={s.label}>Export Names</div>
            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={exportData} style={{ marginBottom: 16 }}>
                Copy JSON to Clipboard
            </Button>

            <div style={s.label}>Import Names (JSON array or {"{ names: [] }"})</div>
            <TextInput
                value={importText}
                onChange={setImportText}
                placeholder='["Name A", "Name B"]'
                style={{ marginBottom: 8 }}
            />
            <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={importData} style={{ marginBottom: 20 }}>
                Import
            </Button>

            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <div style={s.label}>Danger Zone</div>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={clearAll}>
                    Clear All Data
                </Button>
            </div>
        </div>
    );
}

function GNRModal({ modalProps }: { modalProps: ModalProps }) {
    const forceUpdate = useForceUpdater();
    const [tab, setTab] = React.useState<"control" | "names" | "history" | "data">("control");

    type TabId = "control" | "names" | "history" | "data";
    const tabs: { id: TabId; label: string; color: string }[] = [
        { id: "control", label: "Control",  color: C.green   },
        { id: "names",   label: "Names",    color: C.accent  },
        { id: "history", label: "History",  color: C.yellow  },
        { id: "data",    label: "Data",     color: "#f97316" },
    ];

    return (
        <ModalRoot {...modalProps} style={{ maxWidth: 480 }}>
            <style>{`
                .gnr-tab-bar { display:flex; gap:2px; border-bottom:2px solid ${C.border}; margin-bottom:14px; }
                .gnr-tab { background:none; border:none; border-bottom:2px solid transparent; padding:7px 14px; cursor:pointer; font-size:13px; font-weight:600; color:${C.muted}; transition:color .15s,border-color .15s; margin-bottom:-2px; }
                .gnr-tab:hover { color:${C.text}; }
            `}</style>

            <ModalHeader>
                <div style={{ ...s.row, gap: 10, flex: 1 }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill={C.accent}>
                        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                    </svg>
                    <Forms.FormTitle tag="h4" style={{ margin: 0, color: C.text }}>Global Name Rotator</Forms.FormTitle>
                    <Tag color={C.accent} label="v1.0" />
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "12px 16px", overflowY: "auto", maxHeight: "66vh" }}>
                <div className="gnr-tab-bar">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            className="gnr-tab"
                            style={tab === t.id ? { color: t.color, borderBottomColor: t.color } : {}}
                            onClick={() => setTab(t.id)}
                        >{t.label}</button>
                    ))}
                </div>
                {tab === "control" && <ControlTab forceUpdate={forceUpdate} />}
                {tab === "names"   && <NamesTab   forceUpdate={forceUpdate} />}
                {tab === "history" && <HistoryTab forceUpdate={forceUpdate} />}
                {tab === "data"    && <DataTab    forceUpdate={forceUpdate} />}
            </ModalContent>

            <ModalFooter>
                <div style={{ ...s.row, width: "100%", gap: 10 }}>
                    <div style={{ flex: 1, fontSize: 11, color: C.muted }}>
                        <StatusDot active={isRunning()} />
                        {" "}{isRunning() ? `Rotating · ${settings.store.intervalSeconds}s · ${settings.store.randomMode ? "random" : "seq"}` : "Stopped"}
                    </div>
                    <Button color={Button.Colors.TRANSPARENT} onClick={modalProps.onClose}>Close</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function GNRUserAreaButton() {
    const [running, setRunning] = React.useState(false);

    React.useEffect(() => {
        const id = setInterval(() => setRunning(isRunning()), 1000);
        return () => clearInterval(id);
    }, []);

    if (!settings.store.showButton) return null;
    return (
        <UserAreaButton
            tooltipText={running ? "Global Name Rotator — running" : "Global Name Rotator"}
            icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                    {running && <circle cx="18" cy="6" r="4" fill={C.green} stroke="none" />}
                </svg>
            }
            onClick={() => openModal(props => <GNRModal modalProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "GlobalNameRotator",
    description: "Automatically rotates your global display name (not server nicknames). Sequential or random cycling, manual override, history tracking, JSON import/export, and live status in the user area.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
    settings,
    dependencies: ["UserAreaAPI"],

    settingsAboutComponent: () => (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <Button color={Button.Colors.BRAND} onClick={() => openModal(props => <GNRModal modalProps={props} />)}>
                Open Global Name Rotator
            </Button>
            <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)", fontSize: 12, color: "#9ca3af" }}>
                Changes your <b style={{ color: "#a78bfa" }}>global display name</b> — the name visible across all servers and DMs. Server nicknames are unaffected.
            </div>
        </div>
    ),

    async start() {
        pluginActive = true;
        rotatorTimer = null;

        const defaults: StoreData = { names: [], history: [], seqIndex: 0, lastVal: null };
        const stored: StoreData = (await DataStore.get(SK)) ?? defaults;
        names     = stored.names    ?? [];
        history   = stored.history  ?? [];
        seqIndex  = stored.seqIndex ?? 0;
        lastVal   = stored.lastVal  ?? null;

        Vencord.Api.UserArea.addUserAreaButton("global-name-rotator", () => <GNRUserAreaButton />);

        if (settings.store.autoStart && names.length > 0) startRotator();
    },

    stop() {
        pluginActive = false;
        stopRotator();
        Vencord.Api.UserArea.removeUserAreaButton("global-name-rotator");
    },
});