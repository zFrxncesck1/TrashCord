import { DataStore } from "@api/index";
import { UserAreaButton } from "@api/UserArea";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { Button, Forms, React, RestAPI, TextInput, Toasts, UserStore } from "@webpack/common";

const SK = "RS_v1";
const PALETTE = ["#7c4dff","#9c67ff","#b24df7","#6a1fff","#a855f7","#8b5cf6","#7e22ce","#c084fc","#d946ef","#a21caf","#6d28d9","#4c1d95"];
const UNICODE_EMOJI_RE = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u;
const CUSTOM_EMOJI_RE  = /^:([^:]+):(\d{17,20}):\s*/;
const DISCORD_EMOJI_RE = /<a?:([^:]+):(\d+)>/;
function msToLabel(ms: number): string {
    if (!ms) return "";
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
}
function minutesToMs(raw: string): number {
    const n = parseFloat(raw);
    return isNaN(n) || n <= 0 ? 0 : Math.round(n * 60000);
}

type StatusType = "online" | "idle" | "dnd" | "invisible" | "auto";
const STATUS_OPTIONS: { value: StatusType; label: string; color: string }[] = [
    { value: "online",    label: "Online",    color: "#23a55a" },
    { value: "idle",      label: "Idle",      color: "#f0b232" },
    { value: "dnd",       label: "DND",       color: "#f23f43" },
    { value: "invisible", label: "Invis",     color: "#80848e" },
    { value: "auto",      label: "Auto",      color: "#9c67ff" },
];

type NickMode = "custom" | "global" | "both";
const NM_NEXT: Record<NickMode, NickMode> = { custom: "global", global: "both", both: "custom" };
const NM_LABEL: Record<NickMode, string> = { custom: "Custom", global: "Global", both: "Both" };
const NM_COLOR: Record<NickMode, string> = { custom: "#9575cd", global: "#4dd0e1", both: "#f48fb1" };

const C = {
    status: "#4caf50", clan: "#42a5f5", bio: "#ce93d8", pronoun: "#f48fb1",
    nick: "#4dd0e1", data: "#ffa726", enabled: "#66bb6a", text: "#f0eaff",
    hint: "#9e9e9e", muted: "#5a4a7a", del: "#ef9a9a",
};

interface GuildEntry {
    id: string; name: string; nicks: string[]; enabled: boolean; seqIndex: number;
    manual: boolean; nickMode: NickMode; lastNickVal?: string | null;
    guildPronouns: string[]; guildPronounsEnabled: boolean;
    guildPronounsSeqIdx: number; guildPronounsLastVal: string | null;
    guildPronounsMode: NickMode; voiceActivated: boolean;
    nickVoiceEnabled: boolean;
    pronounsVoiceEnabled: boolean;
}
interface StatusEntry {
    emojiName: string | null; emojiId: string | null; text: string;
    animated?: boolean; status?: StatusType; preset?: string;
    clearAfter?: number;
}
interface StatusPreset { id: string; name: string; clearAfter?: number; }
interface StoreData {
    createdAt: string; globalNicks: string[]; guilds: GuildEntry[];
    bioEntries: string[]; pronounsList: string;
    statusEntries: StatusEntry[]; statusPresets: StatusPreset[];
    statuses?: string;
    clanIds: string[];
    statusSeqIdx: number; clanSeqIdx: number; bioSeqIdx: number; prSeqIdx: number;
    statusLastVal?: string | null; clanLastVal?: string | null;
    bioLastVal?: string | null; prLastVal?: string | null;
    globalNickEntries: string[]; globalNickSeqIdx: number; globalNickLastVal?: string | null;
    globalGuildPronouns: string[];
}

let storeCreatedAt = "";
let globalNicks: string[] = [];
let guilds: GuildEntry[] = [];
let bioEntries: string[] = [];
let pronounsList = "";
let statusEntries: StatusEntry[] = [];
let statusPresets: StatusPreset[] = [];
let clanIds: string[] = [];
let statusSeqIdx = 0; let clanSeqIdx = 0; let bioSeqIdx = 0; let prSeqIdx = 0;
let statusLastVal: string | null = null;
let clanLastVal: string | null = null;
let bioLastVal: string | null = null;
let prLastVal: string | null = null;
let globalNickEntries: string[] = [];
let globalNickSeqIdx = 0;
let globalNickLastVal: string | null = null;
let globalGuildPronouns: string[] = [];

let cachedToken: any = null; let cachedGuildStore: any = null;
let cachedClanGuilds: string[] = []; let lastClanFetch = 0;
const nickTimers = new Map<string, ReturnType<typeof setTimeout>>();
const guildPronounsTimers = new Map<string, ReturnType<typeof setTimeout>>();
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let clanTimer: ReturnType<typeof setTimeout> | null = null;
let bioTimer: ReturnType<typeof setTimeout> | null = null;
let pronounsTimer: ReturnType<typeof setTimeout> | null = null;
let globalNickTimer: ReturnType<typeof setTimeout> | null = null;
let globalSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastGlobalNickApply = 0;
const GLOBAL_NICK_MIN_MS = 429000;
let pluginActive = false;
let onCloseHandler: (() => void) | null = null;
let voiceCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastVoiceGuildId: string | null = null;
let cachedVoiceStateStore: any = null;
let cachedChannelStore: any = null;

async function applyCloseStatus(): Promise<void> {
    if (!settings.store.closeStatusEnabled) return;
    const raw = settings.store.closeStatusText.trim();
    const emojiRaw = settings.store.closeStatusEmoji.trim();
    if (!raw && !emojiRaw) return;
    const parsed = parseDiscordEmoji(emojiRaw + (raw ? " " + raw : ""));
    const statusType = settings.store.closeStatusType as StatusType;
    const entry: StatusEntry = {
        ...parsed,
        status: statusType === "auto" ? undefined : statusType,
        clearAfter: undefined,
    };
    await applyStatus(entry);
}

async function applyCloseClan(): Promise<void> {
    if (!settings.store.closeClanEnabled) return;
    const id = settings.store.closeClanId.trim();
    if (!id || !/^\d{17,20}$/.test(id)) return;
    await applyClan(id);
}

const saveData = () => DataStore.set(SK, {
    createdAt: storeCreatedAt, globalNicks,
    guilds: guilds.map(g => { const { lastNickVal: _, ...rest } = g as any; return rest; }),
    bioEntries, pronounsList, statusEntries, statusPresets, clanIds,
    statusSeqIdx, clanSeqIdx, bioSeqIdx, prSeqIdx,
    statusLastVal, clanLastVal, bioLastVal, prLastVal,
    globalNickEntries, globalNickSeqIdx, globalNickLastVal,
    globalGuildPronouns,
} as StoreData);

function parseList(raw: string): string[] { return raw.split("§").map(s => s.trim()).filter(Boolean); }
function reorder<T>(arr: T[], from: number, to: number): T[] {
    const r = [...arr]; const [x] = r.splice(from, 1); r.splice(to, 0, x); return r;
}
function colorFor(id: string): string {
    let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}
function getMs(sec: string): number { return Math.max(1000, (parseFloat(sec) || 30) * 1000); }

function pickItem<T>(list: T[], idx: number, rnd: boolean, lastVal: T | null | undefined): { val: T | null; next: number; lastPicked: T | null } {
    if (!list.length) return { val: null, next: idx, lastPicked: lastVal ?? null };
    if (!rnd) { const i = idx % list.length; return { val: list[i], next: idx + 1, lastPicked: list[i] }; }
    if (list.length === 1) return { val: list[0], next: idx, lastPicked: list[0] };
    if (settings.store.noDuplicateRandom && lastVal != null) {
        const pool = list.filter(v => v !== lastVal);
        if (pool.length > 0) { const v = pool[Math.floor(Math.random() * pool.length)]; return { val: v, next: idx, lastPicked: v }; }
    }
    const v = list[Math.floor(Math.random() * list.length)];
    return { val: v, next: idx, lastPicked: v };
}

function getToken(): string | null { if (!cachedToken) cachedToken = findByProps("getToken"); return cachedToken?.getToken?.() ?? null; }
function getGuildStore() { if (!cachedGuildStore) cachedGuildStore = findByProps("getGuilds"); return cachedGuildStore; }
function getDiscordGuilds(): { id: string; name: string }[] {
    try { return Object.values(getGuildStore()?.getGuilds?.() ?? {}).map((x: any) => ({ id: x.id, name: x.name })); }
    catch { return []; }
}
function syncGuildsFromDiscord() {
    for (const { id, name } of getDiscordGuilds())
        if (!guilds.find(g => g.id === id))
            guilds.push({ id, name, nicks: [], enabled: false, seqIndex: 0, manual: false, nickMode: "custom", guildPronouns: [], guildPronounsEnabled: false, guildPronounsSeqIdx: 0, guildPronounsLastVal: null, guildPronounsMode: "custom", voiceActivated: false, nickVoiceEnabled: false, pronounsVoiceEnabled: false });
}

function nickModeOf(g: GuildEntry): NickMode { return g.nickMode ?? ((g as any).useGlobal ? "global" : "custom"); }
function nicksForGuild(g: GuildEntry): string[] {
    const m = nickModeOf(g);
    if (m === "global") return globalNicks;
    if (m === "both") return [...new Set([...globalNicks, ...g.nicks])];
    return g.nicks.length ? g.nicks : globalNicks;
}

async function applyNick(guildId: string, nick: string): Promise<number | null> {
    try {
        await RestAPI.patch({ url: `/guilds/${guildId}/members/@me`, body: { nick } });
        if (settings.store.enableLogs) console.log(`[RS/Nick] [${guildId}] -> "${nick}"`);
        return null;
    } catch (err: any) {
        const st = err?.status ?? err?.response?.status ?? 0;
        if (st === 429) {
            const ra = Math.max(parseFloat(err?.body?.retry_after ?? err?.retry_after ?? "5") || 5, 1);
            if (settings.store.enableLogs) console.warn(`[RS/Nick] 429 retry ${ra}s`);
            return ra;
        }
        if (settings.store.enableLogs) console.error("[RS/Nick] err:", err);
        return null;
    }
}

function scheduleNickTick(g: GuildEntry, ms: number) {
    nickTimers.set(g.id, setTimeout(async () => {
        if (!pluginActive || !g.enabled || !settings.store.nickEnabled || !nickTimers.has(g.id)) return;
        const nks = nicksForGuild(g);
        if (!nks.length) { nickTimers.delete(g.id); return; }
        if (g.seqIndex < 0 || g.seqIndex > nks.length * 2) g.seqIndex = 0;
        const { val: nick, next, lastPicked } = pickItem(nks, g.seqIndex, settings.store.nickRandomize, g.lastNickVal);
        g.seqIndex = next; g.lastNickVal = lastPicked;
        if (nick) {
            const retry = await applyNick(g.id, nick);
            if (!pluginActive || !g.enabled || !nickTimers.has(g.id)) return;
            if (retry !== null) {
                nickTimers.set(g.id, setTimeout(() => {
                    if (pluginActive && g.enabled && nickTimers.has(g.id))
                        scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
                }, retry * 1000 + 429));
                return;
            }
        }
        saveData();
        if (!settings.store.globalSync) scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
        else nickTimers.delete(g.id);
    }, ms));
}
function startNickGuild(g: GuildEntry) {
    if (!nickTimers.has(g.id) && !settings.store.globalSync && settings.store.nickEnabled)
        scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
}
function stopNickGuild(id: string) { const t = nickTimers.get(id); if (t) { clearTimeout(t); nickTimers.delete(id); } }
function stopAllNicks() { [...nickTimers.keys()].forEach(stopNickGuild); }
function tickAllNicks() {
    if (!settings.store.nickEnabled) return;
    for (const g of guilds.filter(x => x.enabled)) {
        const nks = nicksForGuild(g);
        if (!nks.length) continue;
        if (g.seqIndex < 0 || g.seqIndex > nks.length * 2) g.seqIndex = 0;
        const { val: nick, next, lastPicked } = pickItem(nks, g.seqIndex, settings.store.nickRandomize, g.lastNickVal);
        g.seqIndex = next; g.lastNickVal = lastPicked;
        if (nick) applyNick(g.id, nick);
    }
}

function pronounsForGuild(g: GuildEntry): string[] {
    const m: NickMode = g.guildPronounsMode ?? "custom";
    if (m === "global") return globalGuildPronouns;
    if (m === "both") return [...new Set([...globalGuildPronouns, ...(g.guildPronouns ?? [])])];
    const local = g.guildPronouns ?? [];
    return local.length > 0 ? local : globalGuildPronouns;
}

function scheduleGuildPronounsTick(g: GuildEntry, ms: number) {
    const tid = setTimeout(async () => {
        if (guildPronounsTimers.get(g.id) !== tid) return;
        guildPronounsTimers.delete(g.id);
        if (!pluginActive || !g.guildPronounsEnabled || !settings.store.serverPronounsEnabled) return;
        const pool = pronounsForGuild(g);
        if (!pool.length) return;
        const { val: pr, next, lastPicked } = pickItem(pool, g.guildPronounsSeqIdx ?? 0, settings.store.serverPronounsRandomize, g.guildPronounsLastVal);
        g.guildPronounsSeqIdx = next; g.guildPronounsLastVal = lastPicked;
        if (pr) await applyGuildPronoun(g.id, pr);
        saveData();
        if (pluginActive && g.guildPronounsEnabled && settings.store.serverPronounsEnabled && !settings.store.globalSync && !guildPronounsTimers.has(g.id))
            scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
    }, ms) as ReturnType<typeof setTimeout>;
    guildPronounsTimers.set(g.id, tid);
}
function startGuildPronouns(g: GuildEntry) {
    if (!guildPronounsTimers.has(g.id) && !settings.store.globalSync && g.guildPronounsEnabled && settings.store.serverPronounsEnabled && pronounsForGuild(g).length > 0)
        scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
}
function stopGuildPronouns(id: string) { const t = guildPronounsTimers.get(id); if (t) { clearTimeout(t); guildPronounsTimers.delete(id); } }
function stopAllGuildPronouns() { [...guildPronounsTimers.keys()].forEach(stopGuildPronouns); }
function tickAllGuildPronouns() {
    if (!settings.store.serverPronounsEnabled) return;
    for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0)) {
        const pool = pronounsForGuild(g);
        const { val: pr, next, lastPicked } = pickItem(pool, g.guildPronounsSeqIdx ?? 0, settings.store.serverPronounsRandomize, g.guildPronounsLastVal);
        g.guildPronounsSeqIdx = next; g.guildPronounsLastVal = lastPicked;
        if (pr) applyGuildPronoun(g.id, pr);
    }
}

function parseLegacyStatuses(raw: string): StatusEntry[] {
    return parseList(raw).map(line => {
        const cm = line.match(CUSTOM_EMOJI_RE);
        if (cm) return { emojiName: cm[1], emojiId: cm[2], text: line.slice(cm[0].length).trim() };
        const um = line.match(UNICODE_EMOJI_RE);
        if (um) return { emojiName: um[1], emojiId: null, text: line.slice(um[0].length).trim() };
        return { emojiName: null, emojiId: null, text: line };
    });
}
function parseStatuses(raw: string): StatusEntry[] { return parseLegacyStatuses(raw); }

function parseDiscordEmoji(input: string): Pick<StatusEntry, "text" | "emojiName" | "emojiId" | "animated"> {
    const dm = input.replace(/^\\/, "").match(DISCORD_EMOJI_RE);
    if (dm) return { text: input.replace(DISCORD_EMOJI_RE, "").trim(), emojiName: dm[1], emojiId: dm[2], animated: input.includes("<a:") };
    const cm = input.match(CUSTOM_EMOJI_RE);
    if (cm) return { text: input.slice(cm[0].length).trim(), emojiName: cm[1], emojiId: cm[2], animated: false };
    const um = input.match(UNICODE_EMOJI_RE);
    if (um) return { text: input.slice(um[0].length).trim(), emojiName: um[1], emojiId: null, animated: false };
    return { text: input, emojiName: null, emojiId: null, animated: false };
}

function statusKey(e: StatusEntry): string { return `${e.emojiId ?? ""}|${e.emojiName ?? ""}|${e.text}`; }

const RS_EVAL = "eval ";
async function resolveField(value: string): Promise<string> {
    if (!value.startsWith(RS_EVAL)) return value;
    try {
        const _eval = globalThis.eval;
        const result = _eval(value.slice(RS_EVAL.length));
        return String(result ?? "");
    } catch (e: any) {
        if (settings.store.enableLogs) console.error("[RS/eval]", e?.message ?? e);
        return "";
    }
}
async function resolveStatusEntry(entry: StatusEntry): Promise<StatusEntry> {
    const [text, emojiName] = await Promise.all([
        resolveField(entry.text ?? ""),
        entry.emojiName ? resolveField(entry.emojiName) : Promise.resolve(entry.emojiName),
    ]);
    return { ...entry, text, emojiName: emojiName as string | null };
}

const CustomStatusSetting = getUserSettingLazy<{ text: string; emojiId: string; emojiName: string; expiresAtMs: string; createdAtMs: string }>("status", "customStatus");
const PresenceSetting = getUserSettingLazy<string>("status", "status");

async function applyStatus(entry: StatusEntry, retries = 3): Promise<void> {
    const clearMs = entry.clearAfter ?? 0;
    const expiresAtMs = clearMs > 0 ? String(Date.now() + clearMs) : "0";
    const expiresAtIso = clearMs > 0 ? new Date(Date.now() + clearMs).toISOString() : null;
    if (CustomStatusSetting) {
        try {
            await CustomStatusSetting.updateSetting({
                text: entry.text || "",
                emojiName: entry.emojiName ?? "",
                emojiId: entry.emojiId ?? "0",
                createdAtMs: Date.now().toString(),
                expiresAtMs,
            });
            if (entry.status && entry.status !== "auto" && PresenceSetting) await PresenceSetting.updateSetting(entry.status);
            if (settings.store.enableLogs) console.log(`[RS/Status] -> "${entry.text}" [${entry.status ?? "auto"}]`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 429) return;
            if (settings.store.enableLogs) console.warn("[RS/Status] UserSetting fallback RestAPI:", e);
        }
    }
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await RestAPI.patch({
                url: "/users/@me/settings",
                body: { custom_status: { text: entry.text || null, emoji_name: entry.emojiName, emoji_id: entry.emojiId, expires_at: expiresAtIso } }
            });
            if (settings.store.enableLogs) console.log(`[RS/Status] -> "${entry.text}" attempt=${attempt + 1}`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 429) {
                const ra = Math.max(parseFloat(e?.body?.retry_after ?? e?.retry_after ?? "3") || 3, 1);
                await new Promise(r => setTimeout(r, ra * 1000 + 200));
                continue;
            }
            if (settings.store.enableLogs) console.error(`[RS/Status] attempt=${attempt + 1} err:`, e);
            if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1500));
        }
    }
}

function getActiveStatusPool(): StatusEntry[] {
    const mode = settings.store.statusRunMode as "all" | "presets" | "none";
    if (mode === "none") return [];
    if (mode !== "presets") return statusEntries;
    try {
        const sel: string[] = JSON.parse(settings.store.statusSelectedPresets || "[]");
        if (!sel.length) return statusEntries;
        return statusEntries.filter(e => e.preset && sel.includes(e.preset));
    } catch { return statusEntries; }
}

function isEvalEntry(e: StatusEntry): boolean {
    return !!(e.text?.startsWith("eval ") || e.emojiName?.startsWith("eval "));
}

function tickStatus() {
    if (!settings.store.statusEnabled) return;
    const pool = getActiveStatusPool();
    if (!pool.length) return;
    if (pool.length === 1 && isEvalEntry(pool[0])) {
        resolveStatusEntry(pool[0]).then(resolved => applyStatus(resolved));
        return;
    }
    const { val: entry, next, lastPicked } = pickItem(pool, statusSeqIdx, settings.store.statusRandomize, pool.find(e => statusKey(e) === statusLastVal) ?? null);
    statusSeqIdx = next; statusLastVal = lastPicked ? statusKey(lastPicked) : null;
    if (entry) resolveStatusEntry(entry).then(resolved => applyStatus(resolved));
}

function scheduleStatusLoop() {
    if (statusTimer !== null) return;
    statusTimer = setTimeout(() => {
        statusTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickStatus(); saveData();
        if (settings.store.statusEnabled) scheduleStatusLoop();
    }, getMs(settings.store.statusIntervalSeconds));
}
function stopStatusTimer() { if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; } }

function getActiveClanIds(): string[] {
    if (!settings.store.clanAutoDetect) return clanIds;
    const refreshMs = Math.max(10000, (parseFloat(settings.store.clanAutoDetectRefreshSeconds) || 180) * 1000);
    const now = Date.now();
    if (!cachedClanGuilds.length || now - lastClanFetch >= refreshMs) {
        cachedClanGuilds = getDiscordGuilds().map(g => g.id); lastClanFetch = now;
        if (settings.store.enableLogs) console.log(`[RS/Clan] Auto-detect: ${cachedClanGuilds.length} guilds`);
    }
    return cachedClanGuilds;
}

async function applyClan(id: string, retries = 4): Promise<void> {
    const token = getToken(); if (!token) return;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const res = await fetch("https://discord.com/api/v9/users/@me/clan", {
                method: "PUT",
                headers: {
                    "authorization": token,
                    "content-type": "application/json",
                    "x-discord-locale": "en-US",
                    "x-discord-timezone": "UTC",
                },
                body: JSON.stringify({ identity_enabled: true, identity_guild_id: id })
            });
            if (res.ok) {
                if (settings.store.enableLogs) console.log(`[RS/Clan] -> ${id} attempt=${attempt + 1}`);
                return;
            }
            if (res.status === 300) {
                const json = await res.json().catch(() => ({}));
                const ra = Math.max((json?.retry_after ?? 3), 1);
                await new Promise(r => setTimeout(r, ra * 1000 + 300));
                continue;
            }
            if (settings.store.enableLogs) console.error(`[RS/Clan] HTTP ${res.status} attempt=${attempt + 1}`);
            if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
            if (settings.store.enableLogs) console.error(`[RS/Clan] attempt=${attempt + 1} err:`, e);
            if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1500));
        }
    }
}

function tickClan() {
    if (!settings.store.clanEnabled) return;
    const list = getActiveClanIds(); if (!list.length) return;
    const { val: id, next, lastPicked } = pickItem(list, clanSeqIdx, settings.store.clanRandomize, clanLastVal);
    clanSeqIdx = next; clanLastVal = lastPicked;
    if (id) applyClan(id);
}

function scheduleClanLoop() {
    if (clanTimer !== null) return;
    clanTimer = setTimeout(() => {
        clanTimer = null;
        if (!pluginActive) return;
        tickClan(); saveData();
        if (settings.store.clanEnabled) scheduleClanLoop();
    }, getMs(settings.store.clanIntervalSeconds));
}
function stopClanTimer() { if (clanTimer) { clearTimeout(clanTimer); clanTimer = null; } }

async function patchProfile(body: Record<string, string>) {
    try {
        await RestAPI.patch({ url: "/users/@me/profile", body });
        if (settings.store.enableLogs) console.log("[RS/Profile] ->", body);
    } catch (e: any) { if (settings.store.enableLogs) console.error("[RS/Profile]:", e); }
}

async function applyGlobalNick(displayName: string, retries = 3): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
        if (!pluginActive) return;
        try {
            await RestAPI.patch({ url: "/users/@me", body: { global_name: displayName } });
            if (settings.store.enableLogs) console.log(`[RS/GlobalNick] -> "${displayName}"`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 429) {
                const ra = Math.max(parseFloat(e?.body?.retry_after ?? e?.retry_after ?? "300") || 300, 10);
                if (settings.store.enableLogs) console.warn(`[RS/GlobalNick] 429 retry ${ra}s`);
                await new Promise(r => setTimeout(r, ra * 1000 + 500));
                continue;
            }
            if (settings.store.enableLogs) console.error(`[RS/GlobalNick] attempt=${attempt + 1}:`, e);
            if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function applyGuildPronoun(guildId: string, pronouns: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await RestAPI.patch({ url: `/users/@me/guilds/${guildId}/profile`, body: { pronouns } });
            if (settings.store.enableLogs) console.log(`[RS/GuildPronouns] [${guildId}] -> "${pronouns}"`);
            return;
        } catch (e: any) {
            const st = e?.status ?? e?.response?.status ?? 0;
            if (st === 300) {
                const ra = Math.max(parseFloat(e?.body?.retry_after ?? e?.retry_after ?? "5") || 5, 1);
                if (settings.store.enableLogs) console.warn(`[RS/GuildPronouns] 429 [${guildId}] retry ${ra}s`);
                await new Promise(r => setTimeout(r, ra * 1000 + 300));
                continue;
            }
            if (st === 403 || st === 404) {
                if (settings.store.enableLogs) console.warn(`[RS/GuildPronouns] [${guildId}] HTTP ${st} - server pronouns not supported for this server`);
                return;
            }
            if (settings.store.enableLogs) console.error("[RS/GuildPronouns]:", e);
            return;
        }
    }
}

function tickBio() {
    if (!settings.store.profileBioEnabled || !bioEntries.length) return;
    const { val, next, lastPicked } = pickItem(bioEntries, bioSeqIdx, settings.store.bioRandomize, bioLastVal);
    bioSeqIdx = next; bioLastVal = lastPicked;
    if (val) patchProfile({ bio: val });
}
function scheduleBioLoop() {
    if (bioTimer !== null) return;
    bioTimer = setTimeout(() => {
        bioTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickBio(); saveData();
        if (settings.store.profileBioEnabled) scheduleBioLoop();
    }, getMs(settings.store.bioIntervalSeconds));
}
function stopBioTimer() { if (bioTimer) { clearTimeout(bioTimer); bioTimer = null; } }

function tickPronouns() {
    if (!settings.store.profilePronounsEnabled) return;
    const pList = parseList(pronounsList);
    if (!pList.length) return;
    const { val, next, lastPicked } = pickItem(pList, prSeqIdx, settings.store.pronounsRandomize, prLastVal);
    prSeqIdx = next; prLastVal = lastPicked;
    if (val) patchProfile({ pronouns: val });
}
function schedulePronounsLoop() {
    if (pronounsTimer !== null) return;
    pronounsTimer = setTimeout(() => {
        pronounsTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickPronouns(); saveData();
        if (settings.store.profilePronounsEnabled) schedulePronounsLoop();
    }, getMs(settings.store.pronounsIntervalSeconds));
}
function stopPronounsTimer() { if (pronounsTimer) { clearTimeout(pronounsTimer); pronounsTimer = null; } }

function tickGlobalNick() {
    if (!settings.store.globalNickEnabled || !globalNickEntries.length) return;
    const now = Date.now();
    if (now - lastGlobalNickApply < GLOBAL_NICK_MIN_MS) return;
    lastGlobalNickApply = now;
    const { val, next, lastPicked } = pickItem(globalNickEntries, globalNickSeqIdx, settings.store.globalNickRandomize, globalNickLastVal);
    globalNickSeqIdx = next; globalNickLastVal = lastPicked;
    if (val) applyGlobalNick(val);
}
function scheduleGlobalNickLoop() {
    if (globalNickTimer !== null) return;
    const ms = Math.max(429000, getMs(settings.store.globalNickIntervalSeconds));
    globalNickTimer = setTimeout(() => {
        globalNickTimer = null;
        if (!pluginActive || settings.store.globalSync) return;
        tickGlobalNick(); saveData();
        if (settings.store.globalNickEnabled) scheduleGlobalNickLoop();
    }, ms);
}
function stopGlobalNickTimer() { if (globalNickTimer) { clearTimeout(globalNickTimer); globalNickTimer = null; } }

function globalTick() { tickStatus(); tickBio(); tickPronouns(); tickGlobalNick(); tickAllNicks(); tickAllGuildPronouns(); saveData(); }

function scheduleGlobalLoop() {
    if (globalSyncTimer !== null) return;
    globalSyncTimer = setTimeout(() => {
        globalSyncTimer = null;
        if (!pluginActive || !settings.store.globalSync) return;
        globalTick();
        scheduleGlobalLoop();
    }, getMs(settings.store.globalSyncSeconds));
}
function stopGlobalTimer() { if (globalSyncTimer) { clearTimeout(globalSyncTimer); globalSyncTimer = null; } }

function getMyVoiceGuildId(): string | null {
    try {
        const user = UserStore.getCurrentUser(); if (!user) return null;
        if (!cachedVoiceStateStore) cachedVoiceStateStore = findByProps("getVoiceStateForUser", "getVoiceStatesForChannel");
        const state = cachedVoiceStateStore?.getVoiceStateForUser?.(user.id);
        if (!state?.channelId) return null;
        if (!cachedChannelStore) cachedChannelStore = findByProps("getChannel", "getDMFromUserId");
        const ch = cachedChannelStore?.getChannel?.(state.channelId);
        return ch ? (ch.guild_id ?? "DM") : null;
    } catch { return null; }
}

function onVoiceJoin(guildId: string | null) {
    if (!pluginActive || settings.store.globalSync) return;
    if (settings.store.voiceActivateGlobal) {
        if (settings.store.nickEnabled)
            for (const g of guilds.filter(x => x.enabled && !nickTimers.has(x.id)))
                scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
        if (settings.store.serverPronounsEnabled)
            for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0 && !guildPronounsTimers.has(x.id)))
                scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
        return;
    }
    if (!guildId || guildId === "DM") return;
    const g = guilds.find(x => x.id === guildId && x.voiceActivated);
    if (!g) return;
    if (settings.store.nickEnabled && g.enabled && g.nickVoiceEnabled && !nickTimers.has(g.id))
        scheduleNickTick(g, 300);
    if (g.guildPronounsEnabled && pronounsForGuild(g).length > 0 && settings.store.serverPronounsEnabled && g.pronounsVoiceEnabled && !guildPronounsTimers.has(g.id))
        scheduleGuildPronounsTick(g, 300);
}

function onVoiceLeave(prevGuildId: string | null) {
    if (!pluginActive) return;
    if (settings.store.voiceActivateGlobal) { stopAllNicks(); stopAllGuildPronouns(); return; }
    if (!prevGuildId || prevGuildId === "DM") return;
    const g = guilds.find(x => x.id === prevGuildId && x.voiceActivated);
    if (g) { stopNickGuild(prevGuildId); stopGuildPronouns(prevGuildId); }
}

function startVoiceWatcher() {
    if (voiceCheckInterval !== null) return;
    lastVoiceGuildId = getMyVoiceGuildId();
    voiceCheckInterval = setInterval(() => {
        if (!pluginActive) return;
        const curr = getMyVoiceGuildId();
        if (curr === lastVoiceGuildId) return;
        const prev = lastVoiceGuildId; lastVoiceGuildId = curr;
        if (curr && !prev) onVoiceJoin(curr);
        else if (!curr && prev) onVoiceLeave(prev);
        else { onVoiceLeave(prev); onVoiceJoin(curr); }
    }, 2000);
}

function stopVoiceWatcher() {
    if (voiceCheckInterval) { clearInterval(voiceCheckInterval); voiceCheckInterval = null; }
    lastVoiceGuildId = null;
}

function stopAllRotators() {
    stopAllNicks(); stopAllGuildPronouns();
    stopStatusTimer(); stopClanTimer();
    stopBioTimer(); stopPronounsTimer(); stopGlobalNickTimer();
    stopGlobalTimer(); stopVoiceWatcher();
}

function startAllRotators() {
    stopAllRotators();
    if (!pluginActive) return;
    if (settings.store.clanEnabled) scheduleClanLoop();
    if (settings.store.globalSync) {
        globalTick(); scheduleGlobalLoop();
    } else {
        if (settings.store.statusEnabled) scheduleStatusLoop();
        if (settings.store.profileBioEnabled) scheduleBioLoop();
        if (settings.store.profilePronounsEnabled) schedulePronounsLoop();
        if (settings.store.globalNickEnabled) scheduleGlobalNickLoop();
        if (!settings.store.voiceActivateGlobal) {
            if (settings.store.nickEnabled)
                for (const g of guilds.filter(x => x.enabled && !x.voiceActivated)) startNickGuild(g);
            for (const g of guilds.filter(x => x.guildPronounsEnabled && !x.voiceActivated && pronounsForGuild(x).length > 0))
                startGuildPronouns(g);
        }
    }
    if (settings.store.voiceActivateEnabled) startVoiceWatcher();
}

function SettingsSep({ title, color = "#9c67ff" }: { title: string; color?: string }) {
    return (
        <div style={{ margin: "14px 0 2px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color, whiteSpace: "nowrap" }}>{title}</span>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
        </div>
    );
}

const settings = definePluginSettings({
    _sOpen: {
        type: OptionType.COMPONENT, description: "",
        component: () => (
            <div style={{ marginTop: 4 }}>
                <Button color={Button.Colors.BRAND} onClick={() => openModal(props => <RotatorSuiteModal modalProps={props} />)}>
                    Open Rotator Suite Panel
                </Button>
                <div style={{ fontSize: 11, color: "#9e9e9e", marginTop: 6, lineHeight: 1.5 }}>
                    All rotator settings (intervals, enable/disable, randomize, Master Sync) are configured directly inside the panel tabs.
                </div>
            </div>
        )
    },
    _sSyncGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Master Sync" color={C.data} /> },
    globalSync: { type: OptionType.BOOLEAN, default: false, description: "Master Sync (configure in Data tab).", onChange: () => { if (pluginActive) startAllRotators(); } },
    globalSyncSeconds: { type: OptionType.STRING, default: "500", description: "Master Sync interval seconds (configure in Data tab)." },
    noDuplicateRandom: { type: OptionType.BOOLEAN, default: true, description: "No-Duplicate Random (configure in Data tab)." },
    _sStatusGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Status" color={C.status} /> },
    statusEnabled: { type: OptionType.BOOLEAN, default: false, description: "Status rotator enabled (configure in Status tab)." },
    statusIntervalSeconds: { type: OptionType.STRING, default: "10", description: "Status interval seconds (configure in Status tab)." },
    statusRandomize: { type: OptionType.BOOLEAN, default: true, description: "Status randomize (configure in Status tab)." },
    statusRunMode: { type: OptionType.STRING, default: "all", description: "Status run mode: all | presets | none (configure in Status tab)." },
    statusSelectedPresets: { type: OptionType.STRING, default: "[]", description: "JSON array of preset names to include when run mode is presets." },
    _sCloseGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="On Close Status" color="#64b5f6" /> },
    closeStatusEnabled: { type: OptionType.BOOLEAN, default: false, description: "Apply a default status when Discord closes (beforeunload). Does not fire on crash/kill." },
    closeStatusText: { type: OptionType.STRING, default: "", description: "Status text to apply on close." },
    closeStatusEmoji: { type: OptionType.STRING, default: "", description: "Emoji prefix for on-close status (unicode or <:name:id>)." },
    closeStatusType: { type: OptionType.STRING, default: "auto", description: "Presence type on close: online | idle | dnd | invisible | auto." },
    _sCloseClanGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="On Close Clan" color={C.clan} /> },
    closeClanEnabled: { type: OptionType.BOOLEAN, default: false, description: "Switch to a specific clan when Discord closes (beforeunload)." },
    closeClanId: { type: OptionType.STRING, default: "", description: "Clan server ID to apply on close." },
    _sClanGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Clan" color={C.clan} /> },
    clanEnabled: { type: OptionType.BOOLEAN, default: false, description: "Clan switcher enabled (configure in Clan tab)." },
    clanIntervalSeconds: { type: OptionType.STRING, default: "5", description: "Clan interval seconds (configure in Clan tab)." },
    clanAutoDetect: { type: OptionType.BOOLEAN, default: false, description: "Clan auto-detect (configure in Clan tab)." },
    clanAutoDetectRefreshSeconds: { type: OptionType.STRING, default: "400", description: "Clan auto-detect refresh seconds (configure in Clan tab)." },
    clanRandomize: { type: OptionType.BOOLEAN, default: true, description: "Clan randomize (configure in Clan tab)." },
    _sProfileGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Profile" color={C.bio} /> },
    globalNickEnabled: { type: OptionType.BOOLEAN, default: false, description: "Global display name rotation enabled (Profile tab)." },
    globalNickRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize global display name rotation order (Profile tab)." },
    globalNickIntervalSeconds: { type: OptionType.STRING, default: "429", description: "Seconds between display name changes. Discord rate-limits /users/@me - minimum enforced at 429." },
    profilePronounsEnabled: { type: OptionType.BOOLEAN, default: false, description: "Global pronouns rotation enabled (Profile tab)." },
    pronounsRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize global pronouns rotation order (Profile tab)." },
    pronounsIntervalSeconds: { type: OptionType.STRING, default: "30", description: "Seconds between global pronoun changes (Profile tab)." },
    profileBioEnabled: { type: OptionType.BOOLEAN, default: false, description: "Bio rotation enabled (Profile tab)." },
    bioRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize bio rotation order (Profile tab)." },
    bioIntervalSeconds: { type: OptionType.STRING, default: "60", description: "Seconds between bio changes (Profile tab)." },
    _sServerProfilesGroup: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Server Profiles" color={C.nick} /> },
    nickEnabled: { type: OptionType.BOOLEAN, default: false, description: "Server nicknames master switch - when OFF, no nick timers run even if servers are toggled on." },
    nickIntervalSeconds: { type: OptionType.STRING, default: "30", description: "Seconds between server nickname changes (Server Profiles tab)." },
    nickRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize server nickname order (Server Profiles tab)." },
    serverPronounsEnabled: { type: OptionType.BOOLEAN, default: false, description: "Server pronouns master switch - when OFF, no server pronoun timers run." },
    serverPronounsRandomize: { type: OptionType.BOOLEAN, default: true, description: "Randomize server pronoun order (Server Profiles tab)." },
    serverPronounsIntervalSeconds: { type: OptionType.STRING, default: "30", description: "Seconds between server pronoun changes (Server Profiles tab)." },
    _sVoice: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Voice Activation" color="#7986cb" /> },
    voiceActivateEnabled: { type: OptionType.BOOLEAN, default: false, description: "Enable voice-based activation (configure in Server Profiles tab).", onChange: v => { if (pluginActive) { stopVoiceWatcher(); if (v) startVoiceWatcher(); else startAllRotators(); } } },
    voiceActivateGlobal: { type: OptionType.BOOLEAN, default: false, description: "Global: activate ALL server nick+pronoun rotators when in any voice/call. Overrides per-server." },
    _sMisc: { type: OptionType.COMPONENT, description: "", component: () => <SettingsSep title="Misc" color={C.hint} /> },
    showButton: { type: OptionType.BOOLEAN, default: true, description: "Show the Rotator Suite button in the user area (bottom-left)." },
    autoStart: { type: OptionType.BOOLEAN, default: true, description: "Auto-start all enabled rotators when Discord loads." },
    enableLogs: { type: OptionType.BOOLEAN, default: false, description: "Print rotator activity and errors to the console (F12)." },
});

function injectCSS() {
    if (document.getElementById("rs-css")) return;
    const s = document.createElement("style"); s.id = "rs-css";
    s.textContent = `
.rs-modal{width:760px;max-width:95vw}
.rs-tab-bar{display:flex;border-bottom:2px solid rgba(124,77,255,.3);margin-bottom:11px}
.rs-tab{padding:6px 14px;font-size:12px;font-weight:700;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;color:#9575cd;border-radius:4px 4px 0 0}
.rs-tab:hover{color:#ce93d8;background:rgba(124,77,255,.1)}
.rs-dot{border-radius:50%;flex-shrink:0;display:inline-block}
.rs-item{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:7px;border:1px solid rgba(124,77,255,.2);margin-bottom:3px;background:rgba(20,5,50,.55)}
.rs-item:hover{background:rgba(124,77,255,.09)}
.rs-item.rs-over{border-color:#ffa726!important;background:rgba(255,167,38,.07)!important}
.rs-item.rs-dragging{opacity:.3;border-style:dashed}
.rs-item-compact{padding:4px 8px}
.rs-drag{cursor:grab;color:#5a4a7a;font-size:14px;user-select:none;flex-shrink:0;line-height:1;padding:0 3px}
.rs-drag:hover{color:#ce93d8}
.rs-item-icon{font-size:14px;flex-shrink:0;min-width:18px;text-align:center;color:#ce93d8}
.rs-item-text{flex:1;font-size:12px;color:#f0eaff;cursor:pointer}
.rs-item-text:hover{color:#ce93d8}
.rs-item-mono{flex:1;font-size:12px;font-family:monospace;color:#b0c4de;cursor:pointer}
.rs-item-input{flex:1;background:rgba(10,0,30,.7);border:1px solid #9c67ff;border-radius:5px;color:#f0eaff;font-size:12px;outline:none;font-family:inherit;min-width:0;caret-color:#9c67ff;padding:1px 6px}
.rs-pill-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;min-height:20px}
.rs-pill{display:flex;align-items:center;gap:4px;padding:3px 9px 3px 11px;border-radius:20px;font-size:12px;font-weight:700;color:#f3e5ff}
.rs-pill button{background:none;border:none;cursor:pointer;color:rgba(243,229,255,.5);font-size:13px;padding:0;line-height:1}
.rs-pill button:hover{color:#fff}
.rs-row{display:flex;gap:7px;align-items:center;margin-top:7px}
.rs-row>*:first-child{flex:1}
.rs-empty{font-size:12px;color:#757575;font-style:italic;padding:3px 0}
.rs-btn-sm{font-size:12px!important;padding:4px 10px!important;min-height:unset!important;height:28px!important}
.rs-sort-btn{font-size:11px!important;padding:3px 9px!important;min-height:unset!important;height:26px!important;border-radius:6px!important}
.rs-divider{height:1px;background:rgba(124,77,255,.2);margin:9px 0}
.rs-toolbar{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.rs-toolbar>*:first-child{flex:1}
.rs-card{border-radius:9px;padding:9px 12px;margin-bottom:6px;border:1.5px solid rgba(124,77,255,.25);background:rgba(20,5,50,.55)}
.rs-card-header{display:flex;align-items:center;justify-content:space-between;gap:8px}
.rs-card-left{display:flex;align-items:center;gap:7px;min-width:0;flex:1}
.rs-server-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e8d5ff}
.rs-server-id{font-size:10px;color:#757575;flex-shrink:0}
.rs-badge{font-size:10px;padding:1px 7px;border-radius:8px;font-weight:700;flex-shrink:0;white-space:nowrap}
.rs-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
.rs-manual-add{border:2px dashed rgba(124,77,255,.25);border-radius:8px;padding:9px;margin:6px 0}
.rs-manual-add-title{font-size:11px;color:#9575cd;margin-bottom:6px}
.rs-count-badge{font-size:10px;background:rgba(124,77,255,.2);border-radius:8px;padding:2px 8px;color:#ce93d8}
.rs-count{font-size:10px;padding:2px 7px;border-radius:8px;font-weight:700;background:rgba(124,77,255,.18);color:#ce93d8}
.rs-sec-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
.rs-bio-list{display:flex;flex-direction:column;gap:3px;margin-bottom:6px}
.rs-bio-item{display:flex;align-items:flex-start;border-radius:7px;overflow:hidden;border:1px solid rgba(124,77,255,.25);background:rgba(124,77,255,.06)}
.rs-bio-item.editing{border-color:#9c67ff;background:rgba(124,77,255,.13)}
.rs-bio-item.rs-over{border-color:#ffa726!important}
.rs-bio-item.rs-dragging{opacity:.3}
.rs-bio-view{flex:1;padding:6px 9px;font-size:12px;color:#e8d5ff;white-space:pre-wrap;word-break:break-word;line-height:1.4;font-family:monospace;cursor:pointer;min-height:24px}
.rs-bio-view:hover{background:rgba(124,77,255,.07)}
.rs-bio-edit-area{flex:1;resize:vertical;min-height:50px;font-size:12px;background:transparent;border:none;padding:6px 9px;color:#f0eaff;font-family:monospace;line-height:1.4;outline:none;width:0;caret-color:#9c67ff}
.rs-bio-btns{display:flex;flex-direction:column;border-left:1px solid rgba(124,77,255,.18)}
.rs-bio-btn{background:none;border:none;cursor:pointer;padding:4px 7px;color:#757575;font-size:12px;flex:1;white-space:nowrap}
.rs-bio-btn:hover{color:#e8d5ff;background:rgba(124,77,255,.12)}
.rs-bio-btn.save{color:#9c67ff}.rs-bio-btn.save:hover{color:#fff;background:#7c4dff}
.rs-bio-btn.del:hover{color:#ef9a9a;background:rgba(239,83,80,.1)}
.rs-add-row{display:flex;gap:6px;align-items:flex-start;margin-top:6px}
.rs-add-row textarea{flex:1;min-height:52px;resize:vertical;font-size:12px;background:rgba(15,5,40,.8);border:1px solid rgba(124,77,255,.3);border-radius:8px;padding:6px 9px;color:#f0eaff;font-family:monospace;box-sizing:border-box;caret-color:#9c67ff}
.rs-add-row textarea:focus{outline:none;border-color:#9c67ff}
.rs-add-row textarea::placeholder{color:#4a3a6a}
.rs-btn{padding:5px 13px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;border:none;color:#f3e5ff}
.rs-btn:hover{filter:brightness(1.2)}
.rs-clearall{background:rgba(239,83,80,.15)!important;border:1px solid rgba(239,83,80,.3)!important;color:#ef9a9a!important;font-size:11px;padding:3px 9px;border-radius:6px;cursor:pointer;font-weight:700}
.rs-clearall:hover{background:rgba(239,83,80,.3)!important;color:#fff!important}
.rs-confirm-box{background:rgba(239,83,80,.1);border:1px solid rgba(239,83,80,.35);border-radius:8px;padding:8px 12px;margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rs-confirm-box span{font-size:12px;color:#ef9a9a;flex:1;min-width:120px}
.rs-hint{font-size:11px;color:#9e9e9e;margin-top:3px;line-height:1.5}
.rs-hint b{color:#ce93d8}
.rs-del-btn{background:none;border:none;cursor:pointer;color:#5a4a7a;padding:2px 5px;border-radius:4px;font-size:12px;flex-shrink:0}
.rs-del-btn:hover{color:#ef9a9a;background:rgba(239,83,80,.12)}
.rs-edit-btn{background:none;border:none;cursor:pointer;color:#5a4a7a;padding:2px 5px;border-radius:4px;font-size:11px;flex-shrink:0}
.rs-edit-btn:hover{color:#9c67ff;background:rgba(124,77,255,.15)}
.rs-data-card{border:1px solid rgba(124,77,255,.25);border-radius:9px;padding:11px;margin-bottom:8px;background:rgba(20,5,50,.55)}
.rs-data-title{font-size:11px;font-weight:800;color:#ffa726;margin-bottom:5px;text-transform:uppercase;letter-spacing:.7px}
.rs-data-desc{font-size:12px;color:#9e9e9e;margin-bottom:8px;line-height:1.5}
.rs-master-box{border:2px solid rgba(255,167,38,.35);border-radius:9px;padding:11px 13px;margin-bottom:8px;background:rgba(30,15,5,.5)}
.rs-master-title{font-size:13px;font-weight:800;color:#f0eaff;margin-bottom:3px}
.rs-master-sub{font-size:11px;color:#9e9e9e;line-height:1.5}
.rs-master-state{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:800;padding:2px 9px;border-radius:10px;margin-top:6px;text-transform:uppercase;letter-spacing:.4px}
.rs-master-on{background:rgba(255,167,38,.15);color:#ffa726;border:1px solid rgba(255,167,38,.4)}
.rs-master-off{background:rgba(40,20,70,.5);color:#757575;border:1px solid rgba(100,80,140,.28)}
.rs-warn-box{background:rgba(255,152,0,.08);border:1px solid rgba(255,152,0,.3);border-radius:7px;padding:7px 11px;font-size:11px;color:#ffb74d;margin-top:7px;line-height:1.5}
.rs-footer-info{flex:1;font-size:11px;color:#9e9e9e;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.rs-footer-info b{color:#ce93d8}
.rs-import-status{font-size:12px;margin-bottom:7px;padding:6px 10px;border-radius:7px;border:1px solid}
.rs-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:12px;color:#9e9e9e}
.rs-summary-grid b{color:#ce93d8}
.rs-nick-expand{margin-top:6px;border-top:1px solid rgba(124,77,255,.18);padding-top:7px}
.rs-nick-list{display:flex;flex-direction:column;gap:3px;margin-bottom:5px}
.rs-sec-hdr{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.rs-sec-hdr-line{flex:1;height:1px}
.rs-sec-hdr-label{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px}
.rs-settings-panel{border:1px solid rgba(124,77,255,.22);border-radius:9px;padding:8px 10px;margin-bottom:8px;background:rgba(20,5,50,.5)}
.rs-run-mode-row{display:flex;gap:4px;margin-bottom:4px}
.rs-run-mode-btn{flex:1;padding:5px 0;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;border:1.5px solid rgba(80,60,110,.4);background:rgba(15,5,35,.6);color:#5a4a7a;transition:all .15s;text-align:center}
.rs-run-mode-btn:hover{border-color:rgba(124,77,255,.5);color:#ce93d8}
.rs-run-mode-btn.active-all{background:rgba(76,175,80,.12);border-color:#4caf5088;color:#4caf50}
.rs-run-mode-btn.active-presets{background:rgba(124,77,255,.12);border-color:#9c67ff88;color:#ce93d8}
.rs-run-mode-btn.active-none{background:rgba(239,83,80,.1);border-color:#ef9a9a66;color:#ef9a9a}
.rs-preset-check-row{display:flex;flex-direction:column;gap:3px;margin-top:5px;padding:6px 8px;border-radius:7px;background:rgba(10,0,25,.4);border:1px solid rgba(124,77,255,.18)}
.rs-preset-check-item{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:5px;cursor:pointer;transition:background .12s}
.rs-preset-check-item:hover{background:rgba(124,77,255,.1)}
.rs-preset-check-box{width:14px;height:14px;border-radius:3px;border:1.5px solid rgba(124,77,255,.5);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .12s}
.rs-preset-check-box.checked{background:#9c67ff;border-color:#9c67ff}
.rs-preset-check-label{font-size:12px;font-weight:600;flex:1}
.rs-preset-check-count{font-size:10px;color:#757575}
.rs-run-mode-hint{font-size:10px;color:#757575;margin-top:4px;line-height:1.4}
.rs-status-preview{border:1px solid rgba(124,77,255,.28);border-radius:10px;padding:9px 13px;margin-bottom:9px;background:rgba(20,5,50,.6);display:flex;align-items:center;gap:10px}
.rs-preview-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid rgba(124,77,255,.3)}
.rs-preview-info{flex:1;min-width:0}
.rs-preview-name{font-size:12px;font-weight:700;color:#e8d5ff;margin-bottom:2px}
.rs-preview-row{display:flex;align-items:center;gap:4px}
.rs-preview-emoji{font-size:14px;flex-shrink:0}
.rs-preview-emoji-img{width:16px;height:16px;object-fit:contain;flex-shrink:0}
.rs-preview-text{font-size:12px;color:#b0a0cc;font-style:italic}
.rs-preview-label{font-size:9px;font-weight:800;color:#9c67ff;text-transform:uppercase;letter-spacing:.9px;margin-bottom:5px}
.rs-status-dot-indicator{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.rs-status-type-row{display:flex;gap:4px;flex-wrap:wrap;margin:5px 0}
.rs-status-type-btn{display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;border:1px solid rgba(124,77,255,.3);background:rgba(20,5,50,.6);cursor:pointer;font-size:11px;font-weight:700;color:#b0a0cc;transition:all .15s}
.rs-status-type-btn:hover{border-color:rgba(124,77,255,.6);color:#f0eaff}
.rs-status-type-btn.active{border-color:currentColor;color:#f0eaff;background:rgba(124,77,255,.18)}
.rs-status-type-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.rs-entry-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-left:1px}
.rs-preset-tag{font-size:10px;padding:1px 7px;border-radius:8px;background:rgba(124,77,255,.18);color:#ce93d8;font-weight:700;border:1px solid rgba(124,77,255,.28)}
.rs-preset-section{margin-bottom:6px;border-radius:8px;border:1px solid rgba(124,77,255,.2);overflow:hidden}
.rs-preset-header{display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(124,77,255,.07);cursor:pointer;user-select:none}
.rs-preset-header:hover{background:rgba(124,77,255,.12)}
.rs-preset-name{font-size:11px;font-weight:800;color:#ce93d8;text-transform:uppercase;letter-spacing:.5px}
.rs-preset-count{font-size:10px;background:rgba(124,77,255,.2);border-radius:8px;padding:1px 7px;color:#9575cd}
.rs-preset-body{padding:4px 6px 6px}
.rs-no-preset-label{font-size:10px;color:#5a4a7a;font-style:italic;padding:3px 0}
.rs-add-preset-row{display:flex;gap:5px;margin-top:5px}
.rs-preset-pill-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px}
`;
    document.head.appendChild(s);
}

type TabId = "status" | "clan" | "profile" | "servers" | "data";
type SortMode = "name" | "enabled" | "nicks" | "running" | "pronouns";

function useDrag(onReorder: (from: number, to: number) => void) {
    const dragRef = React.useRef<number | null>(null);
    const [overIdx, setOverIdx] = React.useState<number | null>(null);
    const props = (i: number) => ({
        draggable: true as const,
        onDragStart: (e: React.DragEvent) => { dragRef.current = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); },
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverIdx(prev => prev !== i ? i : prev); },
        onDrop: (e: React.DragEvent) => { e.preventDefault(); const from = dragRef.current; if (from !== null && from !== i) onReorder(from, i); dragRef.current = null; setOverIdx(null); },
        onDragEnd: (e: React.DragEvent) => { e.preventDefault(); dragRef.current = null; setOverIdx(null); },
        onDragLeave: () => { setOverIdx(prev => prev === i ? null : prev); },
    });
    const cls = (i: number, base: string) =>
        `${base}${overIdx === i && dragRef.current !== i ? " rs-over" : ""}${dragRef.current === i ? " rs-dragging" : ""}`;
    return { props, cls };
}

function Hdr({ label, color, count }: { label: string; color: string; count?: string | number }) {
    return (
        <div className="rs-sec-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color }}>{label}</span>
            {count !== undefined && <span className="rs-count">{count}</span>}
        </div>
    );
}

function ConfirmBox({ msg, onConfirm, onCancel }: { msg: string; onConfirm: () => void; onCancel: () => void }) {
    return (
        <div className="rs-confirm-box">
            <span>{msg}</span>
            <button className="rs-btn" style={{ background: "#c62828", fontSize: 11, padding: "3px 11px" }} onClick={onConfirm}>Yes, delete</button>
            <button className="rs-btn" style={{ background: "rgba(100,80,140,.35)", fontSize: 11, padding: "3px 11px" }} onClick={onCancel}>Cancel</button>
        </div>
    );
}

function PanelToggle({ label, description, value, color, onChange, compact }: { label: string; description?: string; value: boolean; color?: string; onChange: (v: boolean) => void; compact?: boolean }) {
    const activeColor = color ?? C.enabled;
    return (
        <div
            onClick={() => onChange(!value)}
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: compact ? "4px 8px" : "7px 10px", borderRadius: 7, marginBottom: compact ? 0 : 4, cursor: "pointer",
                border: `1px solid ${value ? activeColor + "55" : "rgba(80,60,110,.35)"}`,
                background: value ? `${activeColor}12` : "rgba(15,5,35,.5)",
                transition: "border-color .15s, background .15s",
            }}>
            <div style={{ flex: 1, pointerEvents: "none" }}>
                <span style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: value ? activeColor : "#6a5a8a" }}>{label}</span>
                {description && <div style={{ fontSize: 10, color: value ? "#9e9e9e" : "#4a3a6a", marginTop: 1 }}>{description}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, pointerEvents: "none" }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".5px", color: value ? activeColor : "#4a3a6a" }}>{value ? "ON" : "OFF"}</span>
                <div style={{
                    width: 36, height: 20, borderRadius: 10, position: "relative",
                    background: value ? activeColor : "#1a0f2e",
                    border: `1.5px solid ${value ? activeColor : "#3a2a5a"}`,
                    transition: "background .18s, border-color .18s",
                }}>
                    <span style={{
                        position: "absolute", top: 2, left: value ? 17 : 2,
                        width: 13, height: 13, borderRadius: "50%",
                        background: value ? "#fff" : "#5a4a7a",
                        transition: "left .18s, background .18s", display: "block",
                        boxShadow: value ? "0 1px 3px rgba(0,0,0,.4)" : "none",
                    }} />
                </div>
            </div>
        </div>
    );
}

function PanelInterval({ label, description, storeKey, onApply, disabled }: {
    label: string; description?: string;
    storeKey: keyof typeof settings.store & string;
    onApply?: () => void; disabled?: boolean;
}) {
    const [val, setVal] = React.useState(String((settings.store as any)[storeKey]));
    const commit = () => {
        const n = Math.max(1, parseFloat(val) || 1);
        (settings.store as any)[storeKey] = String(n);
        setVal(String(n));
        onApply?.();
    };
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(124,77,255,.18)", background: "rgba(20,5,50,.45)", marginBottom: 4, opacity: disabled ? .45 : 1 }}>
            <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f0eaff" }}>{label}</span>
                {description && <div style={{ fontSize: 10, color: "#757575", marginTop: 1 }}>{description}</div>}
            </div>
            <input
                value={val}
                onChange={e => setVal(e.target.value)}
                onBlur={commit}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); }}
                disabled={disabled}
                style={{ width: 52, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 12, padding: "2px 6px", outline: "none", textAlign: "center", fontFamily: "monospace" }}
            />
            <span style={{ fontSize: 11, color: "#757575" }}>s</span>
        </div>
    );
}

function getAvatarUrl(userId: string, avatar: string | null): string {
    return avatar
        ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;
}
function getEmojiUrl(id: string, animated?: boolean): string {
    return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;
}

function StatusLivePreview({ entry, statusType }: { entry: Pick<StatusEntry, "emojiId" | "emojiName" | "animated" | "text">; statusType: StatusType }) {
    const user = UserStore.getCurrentUser() as any;
    const dot = STATUS_OPTIONS.find(s => s.value === statusType)?.color ?? "#23a55a";
    return (
        <div className="rs-status-preview">
            <div style={{ position: "relative", flexShrink: 0 }}>
                <img className="rs-preview-avatar"
                    src={user ? getAvatarUrl(user.id, user.avatar) : undefined}
                    alt="" />
                <span style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: dot === "#9c67ff" ? "linear-gradient(135deg,#9c67ff,#6a1fff)" : dot, border: "2px solid rgba(20,5,50,.9)", display: "block" }} />
            </div>
            <div className="rs-preview-info">
                <div className="rs-preview-label">PREVIEW</div>
                <div className="rs-preview-name">{user?.username ?? "user"}</div>
                <div className="rs-preview-row">
                    {entry.emojiId
                        ? <img className="rs-preview-emoji-img" src={getEmojiUrl(entry.emojiId, entry.animated)} alt="" />
                        : entry.emojiName
                            ? <span className="rs-preview-emoji">{entry.emojiName}</span>
                            : null}
                    <span className="rs-preview-text">{entry.text || <em>No text set...</em>}</span>
                </div>
            </div>
        </div>
    );
}

function StatusTypeSelector({ value, onChange }: { value: StatusType; onChange: (v: StatusType) => void }) {
    return (
        <div className="rs-status-type-row">
            {STATUS_OPTIONS.map(s => (
                <button key={s.value}
                    className={`rs-status-type-btn${value === s.value ? " active" : ""}`}
                    style={value === s.value ? { color: s.color, borderColor: s.color } : {}}
                    onClick={() => onChange(s.value)}>
                    <span className="rs-status-type-dot" style={{ background: s.color }} />
                    {s.label}
                </button>
            ))}
        </div>
    );
}

function ClearAfterSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [raw, setRaw] = React.useState(value > 0 ? String(Math.round(value / 60000)) : "");
    const commit = () => onChange(minutesToMs(raw));
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0" }}>
            <span style={{ fontSize: 11, color: C.hint, flexShrink: 0 }}>Clear after:</span>
            <input value={raw} onChange={e => setRaw(e.target.value)} onBlur={commit}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); }}
                placeholder="0 = never"
                style={{ width: 72, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "2px 6px", outline: "none", fontFamily: "monospace" }} />
            <span style={{ fontSize: 11, color: "#757575" }}>min</span>
        </div>
    );
}

function StatusRunModeSelector({ presets, forceUpdate }: { presets: StatusPreset[]; forceUpdate: () => void }) {
    const mode = settings.store.statusRunMode as "all" | "presets" | "none";
    const getSel = (): string[] => { try { return JSON.parse(settings.store.statusSelectedPresets || "[]"); } catch { return []; } };
    const setSel = (v: string[]) => { settings.store.statusSelectedPresets = JSON.stringify(v); forceUpdate(); };
    const selected = getSel();

    const setMode = (m: "all" | "presets" | "none") => {
        settings.store.statusRunMode = m;
        if (pluginActive) { stopStatusTimer(); if (settings.store.statusEnabled && m !== "none" && !settings.store.globalSync) scheduleStatusLoop(); }
        forceUpdate();
    };

    const togglePreset = (name: string) => {
        const next = selected.includes(name) ? selected.filter(x => x !== name) : [...selected, name];
        setSel(next);
        if (pluginActive && settings.store.statusEnabled && !settings.store.globalSync) { stopStatusTimer(); scheduleStatusLoop(); }
    };

    const MODES: { key: "all" | "presets" | "none"; label: string; cls: string; hint: string }[] = [
        { key: "all",     label: "All Entries",      cls: "active-all",     hint: "Cycle through every status entry regardless of preset" },
        { key: "presets", label: "Selected Presets",  cls: "active-presets", hint: "Only cycle entries belonging to the checked presets below" },
        { key: "none",    label: "None",              cls: "active-none",    hint: "Status rotator is paused - no entries will be cycled" },
    ];

    const activeHint = MODES.find(m => m.key === mode)?.hint ?? "";
    const pool = (() => {
        if (mode === "none") return 0;
        if (mode !== "presets") return statusEntries.length;
        return statusEntries.filter(e => e.preset && selected.includes(e.preset)).length;
    })();

    return (
        <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: C.status, marginBottom: 5 }}>
                Run Mode - pool: <span style={{ color: pool > 0 ? C.enabled : C.del }}>{pool} entries</span>
            </div>
            <div className="rs-run-mode-row">
                {MODES.map(m => (
                    <button key={m.key}
                        className={`rs-run-mode-btn${mode === m.key ? ` ${m.cls}` : ""}`}
                        onClick={() => setMode(m.key)}>
                        {m.label}
                    </button>
                ))}
            </div>
            <div className="rs-run-mode-hint">{activeHint}</div>
            {mode === "presets" && (
                <div className="rs-preset-check-row">
                    {presets.length === 0 && <span style={{ fontSize: 11, color: "#5a4a7a", fontStyle: "italic" }}>No presets yet - create one below.</span>}
                    {presets.map(p => {
                        const cnt = statusEntries.filter(e => e.preset === p.name).length;
                        const checked = selected.includes(p.name);
                        return (
                            <div key={p.id} className="rs-preset-check-item" onClick={() => togglePreset(p.name)}>
                                <div className={`rs-preset-check-box${checked ? " checked" : ""}`}>
                                    {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                                </div>
                                <span className="rs-preset-check-label" style={{ color: checked ? "#e8d5ff" : "#6a5a8a" }}>{p.name}</span>
                                <span className="rs-preset-check-count">{cnt} {cnt === 1 ? "entry" : "entries"}</span>
                            </div>
                        );
                    })}
                    {presets.length > 0 && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(124,77,255,.15)" }}>
                            <button className="rs-btn" style={{ background: "rgba(124,77,255,.25)", fontSize: 10, padding: "2px 9px" }}
                                onClick={() => setSel(presets.map(p => p.name))}>Select All</button>
                            <button className="rs-btn" style={{ background: "rgba(80,60,110,.25)", fontSize: 10, padding: "2px 9px" }}
                                onClick={() => setSel([])}>Clear</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function OnCloseStatusPanel({ forceUpdate }: { forceUpdate: () => void }) {
    const enabled = settings.store.closeStatusEnabled;
    const [text, setText] = React.useState(settings.store.closeStatusText);
    const [emoji, setEmoji] = React.useState(settings.store.closeStatusEmoji);
    const [type, setType] = React.useState<StatusType>((settings.store.closeStatusType as StatusType) || "auto");

    const save = () => {
        settings.store.closeStatusText = text.trim();
        settings.store.closeStatusEmoji = emoji.trim();
        settings.store.closeStatusType = type;
        forceUpdate();
    };

    return (
        <div>
            <PanelToggle label="On-Close Status" description="Apply a fixed status when Discord closes (beforeunload - not fired on crash/kill)"
                value={enabled} color="#64b5f6"
                onChange={v => { settings.store.closeStatusEnabled = v; forceUpdate(); }} />
            {enabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px", border: "1px solid rgba(100,181,246,.2)", borderRadius: 7, background: "rgba(10,20,50,.5)", marginTop: 3 }}>
                    <StatusTypeSelector value={type} onChange={v => { setType(v); settings.store.closeStatusType = v; }} />
                    <div style={{ display: "flex", gap: 6 }}>
                        <input value={emoji} onChange={e => setEmoji(e.target.value)} onBlur={save}
                            placeholder="Emoji (opt.)"
                            style={{ width: 110, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
                        <input value={text} onChange={e => setText(e.target.value)} onBlur={save}
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") save(); }}
                            placeholder="Status text..."
                            style={{ flex: 1, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.35)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none" }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#64b5f6", opacity: .7 }}>
                        <b>Auto</b> = mantieni la presenza attuale, aggiorna solo il testo. Leave text empty to clear the status entirely on close.
                    </div>
                </div>
            )}
        </div>
    );
}

function StatusTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [draft, setDraft] = React.useState("");
    const [draftStatusType, setDraftStatusType] = React.useState<StatusType>("online");
    const [draftPreset, setDraftPreset] = React.useState("");
    const [draftClearAfter, setDraftClearAfter] = React.useState(0);
    const [newPresetName, setNewPresetName] = React.useState("");
    const [editIdx, setEditIdx] = React.useState<number | null>(null);
    const [editText, setEditText] = React.useState("");
    const [editStatusType, setEditStatusType] = React.useState<StatusType>("online");
    const [editPreset, setEditPreset] = React.useState("");
    const [editClearAfter, setEditClearAfter] = React.useState(0);
    const [confirm, setConfirm] = React.useState(false);
    const [filterPreset, setFilterPreset] = React.useState<string | null>(null);

    const list = statusEntries;
    const presets = statusPresets;
    const filteredList = filterPreset ? list.filter(e => e.preset === filterPreset) : list;
    const previewEntry = editIdx !== null && list[editIdx] ? list[editIdx] : parseDiscordEmoji(draft);
    const previewStatus = editIdx !== null && list[editIdx] ? (list[editIdx].status ?? "online") : draftStatusType;

    const { props: dProps, cls } = useDrag((f, t) => {
        const realF = list.indexOf(filteredList[f]);
        const realT = list.indexOf(filteredList[t]);
        if (realF !== -1 && realT !== -1) {
            statusEntries = reorder(list, realF, realT);
            statusSeqIdx = 0; statusLastVal = null;
            saveData(); forceUpdate();
        }
    });

    function add() {
        const v = draft.trim(); if (!v) return;
        const parsed = parseDiscordEmoji(v);
        if (!parsed.text && !parsed.emojiId && !parsed.emojiName) return;
        statusEntries = [...list, { ...parsed, status: draftStatusType, preset: draftPreset.trim() || undefined, clearAfter: draftClearAfter || undefined }];
        statusSeqIdx = 0; statusLastVal = null;
        saveData(); setDraft(""); setDraftPreset(""); setDraftClearAfter(0); forceUpdate();
    }

    function remove(i: number) {
        statusEntries = list.filter((_, j) => j !== i);
        statusSeqIdx = 0; statusLastVal = null;
        saveData(); forceUpdate();
    }

    function startEdit(i: number) {
        const e = list[i];
        const raw = e.emojiId
            ? `<${e.animated ? "a" : ""}:${e.emojiName}:${e.emojiId}> ${e.text}`
            : e.emojiName ? `${e.emojiName} ${e.text}` : e.text;
        setEditIdx(i); setEditText(raw.trim()); setEditStatusType(e.status ?? "online"); setEditPreset(e.preset ?? ""); setEditClearAfter(e.clearAfter ?? 0);
    }

    function saveEdit(i: number) {
        const v = editText.trim(); if (!v) { setEditIdx(null); return; }
        const parsed = parseDiscordEmoji(v);
        const updated = [...list];
        updated[i] = { ...parsed, status: editStatusType, preset: editPreset.trim() || undefined, clearAfter: editClearAfter || undefined };
        statusEntries = updated; saveData(); setEditIdx(null); forceUpdate();
    }

    function addPreset() {
        const name = newPresetName.trim(); if (!name) return;
        if (statusPresets.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
        statusPresets = [...statusPresets, { id: Date.now().toString(), name }];
        setNewPresetName(""); saveData(); forceUpdate();
    }

    function removePreset(id: string) {
        const pName = presets.find(p => p.id === id)?.name;
        statusPresets = presets.filter(p => p.id !== id);
        if (pName) statusEntries = list.map(e => e.preset === pName ? { ...e, preset: undefined } : e);
        if (filterPreset === pName) setFilterPreset(null);
        saveData(); forceUpdate();
    }

    function applyPresetClearAfter(presetName: string, ms: number) {
        statusEntries = list.map(e => e.preset === presetName ? { ...e, clearAfter: ms || undefined } : e);
        saveData(); forceUpdate();
    }

    return (
        <div>
            <div className="rs-settings-panel">
                <PanelToggle label="Enabled" description="Automatically cycle your Discord custom status" value={settings.store.statusEnabled} color={C.status}
                    onChange={v => { settings.store.statusEnabled = v; if (pluginActive) { stopStatusTimer(); if (v && !settings.store.globalSync) scheduleStatusLoop(); } }} />
                <PanelToggle label="Randomize" description="Pick randomly instead of cycling in order" value={settings.store.statusRandomize}
                    onChange={v => { settings.store.statusRandomize = v; }} />
                <PanelInterval label="Interval" description="Seconds between status changes (ignored when Master Sync is ON)"
                    storeKey="statusIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.statusEnabled && !settings.store.globalSync) { stopStatusTimer(); scheduleStatusLoop(); } }} />
                <div className="rs-divider" style={{ margin: "6px 0" }} />
                <StatusRunModeSelector presets={statusPresets} forceUpdate={forceUpdate} />
                <div className="rs-divider" style={{ margin: "6px 0" }} />
                <OnCloseStatusPanel forceUpdate={forceUpdate} />
            </div>
            <div className="rs-divider" style={{ margin: "8px 0" }} />
            <StatusLivePreview entry={previewEntry} statusType={previewStatus} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.status }}>Add Status</span>
            </div>
            <TextInput value={draft} onChange={setDraft}
                placeholder="Status text... or Discord emoji <:name:id> + text"
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); add(); } }} />
            <div className="rs-hint" style={{ marginBottom: 4 }}>
                Prefix with <b>eval </b> for dynamic JS - e.g. <b>eval new Date().toLocaleTimeString()</b> · clock emoji: <b>eval ['🕛','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚'][(new Date()).getHours()%12]</b>
            </div>
            <StatusTypeSelector value={draftStatusType} onChange={setDraftStatusType} />
            <ClearAfterSelector value={draftClearAfter} onChange={setDraftClearAfter} />
            {presets.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: C.hint }}>Preset:</span>
                    <select value={draftPreset} onChange={e => setDraftPreset(e.target.value)}
                        style={{ flex: 1, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.3)", borderRadius: 6, color: "#f0eaff", fontSize: 11, padding: "2px 6px", outline: "none" }}>
                        <option value="">- none -</option>
                        {presets.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                    </select>
                </div>
            )}
            <div style={{ marginBottom: 8 }}>
                <button className="rs-btn" style={{ background: C.status }} onClick={add}>+ Add</button>
            </div>

            <div className="rs-divider" />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "7px 0 5px" }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.status }}>
                    Preset Groups
                </span>
                <span className="rs-count">{presets.length}</span>
            </div>
            <div className="rs-preset-pill-row">
                <button className="rs-preset-tag"
                    style={{ cursor: "pointer", opacity: filterPreset === null ? 1 : .5 }}
                    onClick={() => setFilterPreset(null)}>All ({list.length})</button>
                {presets.map(p => {
                    const cnt = list.filter(e => e.preset === p.name).length;
                    return (
                        <span key={p.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <button className="rs-preset-tag"
                                style={{ cursor: "pointer", opacity: filterPreset === p.name ? 1 : .6 }}
                                onClick={() => setFilterPreset(filterPreset === p.name ? null : p.name)}>
                                {p.name} ({cnt})
                            </button>
                            <button className="rs-del-btn" onClick={() => removePreset(p.id)} title="Delete preset">✕</button>
                        </span>
                    );
                })}
            </div>
            {presets.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6, padding: "6px 8px", border: "1px solid rgba(124,77,255,.18)", borderRadius: 7, background: "rgba(10,0,25,.4)" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".6px", color: C.hint, marginBottom: 2 }}>Bulk clear after (per preset)</span>
                    {presets.map(p => {
                        const cur = list.find(e => e.preset === p.name)?.clearAfter ?? 0;
                        const [rawMin, setRawMin] = React.useState(cur > 0 ? String(Math.round(cur / 60000)) : "");
                        const commit = () => applyPresetClearAfter(p.name, minutesToMs(rawMin));
                        return (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#ce93d8", minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                                <input value={rawMin} onChange={e => setRawMin(e.target.value)} onBlur={commit}
                                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); }}
                                    placeholder="0 = never"
                                    style={{ width: 72, background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.3)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "2px 6px", outline: "none", fontFamily: "monospace" }} />
                                <span style={{ fontSize: 11, color: "#757575" }}>min</span>
                                <button className="rs-btn" style={{ background: "rgba(124,77,255,.25)", fontSize: 10, padding: "2px 9px" }} onClick={commit}>Apply all</button>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="rs-add-preset-row">
                <TextInput value={newPresetName} onChange={setNewPresetName} placeholder="New preset name..."
                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addPreset(); }} />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={addPreset} className="rs-btn-sm">+ Preset</Button>
            </div>

            <div className="rs-divider" style={{ margin: "8px 0" }} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.status }}>
                    List {filterPreset ? `"${filterPreset}"` : "- All"}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="rs-count">{filteredList.length}</span>
                    {list.length > 0 && <button className="rs-clearall" onClick={() => setConfirm(true)}>Clear All</button>}
                </div>
            </div>
            {filteredList.length === 0 && <div className="rs-empty">No entries yet. Add one above.</div>}
            {filteredList.map((entry, fi) => {
                const i = list.indexOf(entry);
                const isEdit = editIdx === i;
                const dot = STATUS_OPTIONS.find(s => s.value === (entry.status ?? "online"))?.color ?? "#23a55a";
                return (
                    <div key={`st_${i}`} {...dProps(fi)} className={cls(fi, "rs-item")}>
                        <span className="rs-drag">⠿</span>
                        {entry.emojiId
                            ? <img style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} src={getEmojiUrl(entry.emojiId, entry.animated)} alt="" />
                            : entry.emojiName
                                ? <span className="rs-item-icon">{entry.emojiName}</span>
                                : null}
                        {isEdit ? (
                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                                <input autoFocus className="rs-item-input" value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveEdit(i); if (e.key === "Escape") setEditIdx(null); }} />
                                <StatusTypeSelector value={editStatusType} onChange={setEditStatusType} />
                                <ClearAfterSelector value={editClearAfter} onChange={setEditClearAfter} />
                                {presets.length > 0 && (
                                    <select value={editPreset} onChange={e => setEditPreset(e.target.value)}
                                        style={{ background: "rgba(10,0,30,.7)", border: "1px solid rgba(124,77,255,.3)", borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "2px 5px", outline: "none" }}>
                                        <option value="">- no preset -</option>
                                        {presets.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                )}
                                <div style={{ display: "flex", gap: 4 }}>
                                    <button className="rs-btn" style={{ background: C.status, fontSize: 11, padding: "2px 9px" }} onClick={() => saveEdit(i)}>✓ Save</button>
                                    <button className="rs-btn" style={{ background: "rgba(100,80,140,.35)", fontSize: 11, padding: "2px 9px" }} onClick={() => setEditIdx(null)}>✕</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <span className="rs-item-text" style={{ flex: 1 }} onClick={() => startEdit(i)}>
                                    {entry.text || <em style={{ color: "#4a3a6a" }}>(emoji only)</em>}
                                </span>
                                {(entry.text?.startsWith("eval ") || entry.emojiName?.startsWith("eval ")) && (
                                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: "rgba(255,167,38,.15)", color: "#ffa726", fontWeight: 800, border: "1px solid rgba(255,167,38,.3)", flexShrink: 0 }}>EVAL</span>
                                )}
                                <span className="rs-entry-status-dot" style={{ background: dot }} title={entry.status ?? "online"} />
                                {entry.clearAfter && entry.clearAfter > 0 && (
                                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 6, background: "rgba(66,165,245,.12)", color: "#64b5f6", fontWeight: 800, border: "1px solid rgba(66,165,245,.25)", flexShrink: 0 }}>
                                        {msToLabel(entry.clearAfter)}
                                    </span>
                                )}
                                {entry.preset && <span className="rs-preset-tag" style={{ fontSize: 9 }}>{entry.preset}</span>}
                            </>
                        )}
                        {!isEdit && <button className="rs-del-btn" onClick={() => remove(i)}>✕</button>}
                    </div>
                );
            })}
            {confirm && <ConfirmBox msg="Delete all status entries?" onConfirm={() => { statusEntries = []; statusSeqIdx = 0; statusLastVal = null; saveData(); forceUpdate(); setConfirm(false); }} onCancel={() => setConfirm(false)} />}
            <div className="rs-hint" style={{ marginTop: 6 }}>
                Ctrl+Enter to add · Enabled: <b style={{ color: settings.store.statusEnabled ? C.enabled : "#757575" }}>{settings.store.statusEnabled ? "yes" : "no"}</b> · Interval: <b style={{ color: C.data }}>{settings.store.statusIntervalSeconds}s</b> · Mode: <b style={{ color: "#ab47bc" }}>{settings.store.statusRandomize ? "random" : "seq"}</b>
            </div>
        </div>
    );
}

function OnCloseClanPanel({ forceUpdate }: { forceUpdate: () => void }) {
    const enabled = settings.store.closeClanEnabled;
    const [id, setId] = React.useState(settings.store.closeClanId);

    const save = () => { settings.store.closeClanId = id.trim(); forceUpdate(); };

    return (
        <div>
            <PanelToggle label="On-Close Clan" description="Switch to a specific clan server when Discord closes (beforeunload - not fired on crash/kill)"
                value={enabled} color={C.clan}
                onChange={v => { settings.store.closeClanEnabled = v; forceUpdate(); }} />
            {enabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 10px", border: `1px solid ${C.clan}33`, borderRadius: 7, background: "rgba(10,20,50,.5)", marginTop: 3 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: C.hint, flexShrink: 0 }}>Clan Server ID:</span>
                        <input value={id} onChange={e => setId(e.target.value)} onBlur={save}
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") save(); }}
                            placeholder="Server ID (17-20 digits)..."
                            style={{ flex: 1, background: "rgba(10,0,30,.7)", border: `1px solid ${C.clan}44`, borderRadius: 5, color: "#f0eaff", fontSize: 11, padding: "3px 7px", outline: "none", fontFamily: "monospace" }} />
                    </div>
                    {id.trim() && !/^\d{17,20}$/.test(id.trim()) && (
                        <div style={{ fontSize: 10, color: "#ef9a9a" }}>⚠ Invalid ID - must be 17-20 digits.</div>
                    )}
                    {id.trim() && /^\d{17,20}$/.test(id.trim()) && (
                        <div style={{ fontSize: 10, color: C.clan, opacity: .8 }}>Clan ID <b>{id.trim()}</b> will be applied upon closure.</div>
                    )}
                    <div style={{ fontSize: 10, color: C.hint, opacity: .7 }}>Paste the ID of the server whose clan badge you want to show upon closure.</div>
                </div>
            )}
        </div>
    );
}

function ClanTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [input, setInput] = React.useState("");
    const [editIdx, setEditIdx] = React.useState<number | null>(null);
    const [editVal, setEditVal] = React.useState("");
    const [confirm, setConfirm] = React.useState(false);
    const autoDetect = settings.store.clanAutoDetect;
    const detected = autoDetect ? getDiscordGuilds() : [];
    const { props: dProps, cls } = useDrag((f, t) => {
        clanIds = reorder(clanIds, f, t); clanSeqIdx = 0; clanLastVal = null;
        saveData(); forceUpdate();
    });

    function add() { const v = input.trim(); if (!v || !/^\d{17,20}$/.test(v) || clanIds.includes(v)) return; clanIds = [...clanIds, v]; saveData(); setInput(""); forceUpdate(); }
    function remove(id: string) { clanIds = clanIds.filter(c => c !== id); clanSeqIdx = 0; clanLastVal = null; saveData(); forceUpdate(); }
    function saveEdit(i: number) {
        const v = editVal.trim(); if (!v || !/^\d{17,20}$/.test(v)) { setEditIdx(null); return; }
        const n = [...clanIds]; n[i] = v; clanIds = n; saveData(); setEditIdx(null); forceUpdate();
    }

    return (
        <div>
            <div className="rs-settings-panel">
                <PanelToggle label="Enabled" description="Rotate your visible clan badge through server IDs" value={settings.store.clanEnabled} color={C.clan}
                    onChange={v => { settings.store.clanEnabled = v; if (pluginActive) { stopClanTimer(); if (v) scheduleClanLoop(); } }} />
                <PanelToggle label="Randomize" description="Pick clan randomly instead of in order" value={settings.store.clanRandomize}
                    onChange={v => { settings.store.clanRandomize = v; }} />
                <PanelToggle label="Auto-Detect" description="Automatically cycle through all your joined servers" value={settings.store.clanAutoDetect}
                    onChange={v => { settings.store.clanAutoDetect = v; cachedClanGuilds = []; lastClanFetch = 0; forceUpdate(); }} />
                <PanelInterval label="Interval" description="Seconds between clan changes (always independent timer)"
                    storeKey="clanIntervalSeconds"
                    onApply={() => { if (pluginActive && settings.store.clanEnabled) { stopClanTimer(); scheduleClanLoop(); } }} />
                {settings.store.clanAutoDetect && (
                    <PanelInterval label="Auto-Detect Refresh" description="How often to re-fetch your server list (seconds)"
                        storeKey="clanAutoDetectRefreshSeconds" />
                )}
                <div className="rs-divider" style={{ margin: "6px 0" }} />
                <OnCloseClanPanel forceUpdate={forceUpdate} />
            </div>
            <div className="rs-divider" style={{ margin: "8px 0" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.clan }}>Clan IDs</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="rs-count">{autoDetect ? "auto" : `${clanIds.length}`}</span>
                    {!autoDetect && clanIds.length > 0 && <button className="rs-clearall" onClick={() => setConfirm(true)}>Clear All</button>}
                </div>
            </div>
            <div className="rs-hint" style={{ marginBottom: 8 }}>
                {autoDetect ? <span>Auto-Detect <b style={{ color: C.enabled }}>ON</b> - cycling all joined servers.</span>
                    : <span>Server IDs to rotate clan tag. Click ID to edit inline.</span>}
            </div>
            {confirm && <ConfirmBox msg="Delete all clan IDs?" onConfirm={() => { clanIds = []; clanSeqIdx = 0; clanLastVal = null; saveData(); forceUpdate(); setConfirm(false); }} onCancel={() => setConfirm(false)} />}
            {autoDetect ? (
                <div style={{ padding: "8px 10px", border: "1px solid rgba(66,165,245,.2)", borderRadius: 8, marginBottom: 8, background: "rgba(10,20,50,.6)" }}>
                    <div className="rs-hint" style={{ marginBottom: 5 }}>Cycling <b style={{ color: C.clan }}>{detected.length}</b> joined servers.</div>
                    {detected.slice(0, 8).map(g => (
                        <div className="rs-item rs-item-compact" key={g.id}>
                            <span className="rs-item-text">{g.name}</span>
                            <span style={{ fontSize: 10, color: "#757575", fontFamily: "monospace" }}>{g.id}</span>
                        </div>
                    ))}
                    {detected.length > 8 && <div className="rs-hint">...and {detected.length - 8} more</div>}
                </div>
            ) : (
                <>
                    {clanIds.length === 0 && <div className="rs-empty" style={{ marginBottom: 6 }}>No clan IDs yet.</div>}
                    {clanIds.map((id, i) => (
                        <div key={id} {...dProps(i)} className={cls(i, "rs-item")}>
                            <span className="rs-drag">⠿</span>
                            {editIdx === i
                                ? <input autoFocus className="rs-item-input" value={editVal}
                                    onChange={e => setEditVal(e.target.value)}
                                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveEdit(i); if (e.key === "Escape") setEditIdx(null); }}
                                    onBlur={() => saveEdit(i)} />
                                : <span className="rs-item-mono" onClick={() => { setEditIdx(i); setEditVal(id); }}>{id}</span>
                            }
                            <button className="rs-del-btn" onClick={() => remove(id)}>✕</button>
                        </div>
                    ))}
                    <div className="rs-row" style={{ marginTop: 6 }}>
                        <TextInput value={input} onChange={setInput} placeholder="Server ID (17-20 digits)..."
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") add(); }} />
                        <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={add} className="rs-btn-sm">Add</Button>
                    </div>
                </>
            )}
            <div className="rs-hint" style={{ marginTop: 6 }}>
                Enabled: <b style={{ color: settings.store.clanEnabled ? C.enabled : "#757575" }}>{settings.store.clanEnabled ? "yes" : "no"}</b> · Interval: <b style={{ color: C.data }}>{settings.store.clanIntervalSeconds}s</b> · Mode: <b style={{ color: "#ab47bc" }}>{settings.store.clanRandomize ? "random" : "seq"}</b>
            </div>
        </div>
    );
}

function RndBtn({ value, color, onChange }: { value: boolean; color: string; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!value)}
            style={{
                display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
                borderRadius: 6, border: `1px solid ${value ? color + "55" : "rgba(80,60,110,.35)"}`,
                background: value ? `${color}20` : "rgba(15,5,35,.55)",
                color: value ? color : "#5a4a7a", cursor: "pointer",
                fontSize: 11, fontWeight: 800, flexShrink: 0,
                transition: "all .15s",
            }}>
            <span style={{ fontSize: 12 }}>{value ? "⟳" : "→"}</span>
            {value ? "Random" : "Sequential"}
        </button>
    );
}

function SectionHeader({ label, color, count, enabled, onToggleEnabled, rndValue, onToggleRnd, enableColor }: {
    label: string; color: string; count?: number;
    enabled: boolean; onToggleEnabled: (v: boolean) => void;
    rndValue: boolean; onToggleRnd: (v: boolean) => void;
    enableColor?: string;
}) {
    const ec = enableColor ?? C.enabled;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color }}>{label}</span>
            {count !== undefined && <span className="rs-count">{count}</span>}
            <div style={{ flex: 1, height: 1, background: `${color}33` }} />
            <RndBtn value={rndValue} color={color} onChange={onToggleRnd} />
            <button
                onClick={() => onToggleEnabled(!enabled)}
                style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "3px 10px",
                    borderRadius: 6, border: `1px solid ${enabled ? ec + "55" : "rgba(80,60,110,.35)"}`,
                    background: enabled ? `${ec}20` : "rgba(15,5,35,.55)",
                    color: enabled ? ec : "#5a4a7a", cursor: "pointer",
                    fontSize: 11, fontWeight: 800, flexShrink: 0,
                    transition: "all .15s",
                }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: enabled ? ec : "#3a2a5a", display: "inline-block", flexShrink: 0 }} />
                {enabled ? "Enabled" : "Disabled"}
            </button>
        </div>
    );
}

function ProfileTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [bioDraft, setBioDraft] = React.useState("");
    const [bioEditIdx, setBioEditIdx] = React.useState<number | null>(null);
    const [bioEditVal, setBioEditVal] = React.useState("");
    const [prDraft, setPrDraft] = React.useState("");
    const [gnDraft, setGnDraft] = React.useState("");
    const [gnEditIdx, setGnEditIdx] = React.useState<number | null>(null);
    const [gnEditVal, setGnEditVal] = React.useState("");
    const [confirmBio, setConfirmBio] = React.useState(false);
    const [confirmPr, setConfirmPr] = React.useState(false);
    const [confirmGn, setConfirmGn] = React.useState(false);
    const prList = parseList(pronounsList);

    const { props: bioDProps, cls: bioCls } = useDrag((f, t) => { bioEntries = reorder(bioEntries, f, t); bioSeqIdx = 0; bioLastVal = null; saveData(); forceUpdate(); });
    const { props: prDProps, cls: prCls } = useDrag((f, t) => { pronounsList = reorder(prList, f, t).join("§"); prSeqIdx = 0; prLastVal = null; saveData(); forceUpdate(); });
    const { props: gnDProps, cls: gnCls } = useDrag((f, t) => { globalNickEntries = reorder(globalNickEntries, f, t); globalNickSeqIdx = 0; globalNickLastVal = null; saveData(); forceUpdate(); });

    function addBio() { const v = bioDraft.trim(); if (!v) return; bioEntries = [...bioEntries, v]; saveData(); setBioDraft(""); forceUpdate(); }
    function removeBio(i: number) { bioEntries = bioEntries.filter((_, j) => j !== i); if (bioEditIdx === i) setBioEditIdx(null); bioSeqIdx = 0; bioLastVal = null; saveData(); forceUpdate(); }
    function saveBioEdit(i: number) { const v = bioEditVal.trim(); if (!v) { setBioEditIdx(null); return; } bioEntries = [...bioEntries]; bioEntries[i] = v; saveData(); setBioEditIdx(null); forceUpdate(); }
    function addPronoun() { const v = prDraft.trim(); if (!v || prList.includes(v)) return; pronounsList = [...prList, v].join("§"); saveData(); setPrDraft(""); forceUpdate(); }
    function removePronoun(i: number) { pronounsList = prList.filter((_, j) => j !== i).join("§"); prSeqIdx = 0; prLastVal = null; saveData(); forceUpdate(); }
    function addGn() { const v = gnDraft.trim(); if (!v || globalNickEntries.includes(v)) return; globalNickEntries = [...globalNickEntries, v]; saveData(); setGnDraft(""); forceUpdate(); }
    function removeGn(i: number) { globalNickEntries = globalNickEntries.filter((_, j) => j !== i); globalNickSeqIdx = 0; globalNickLastVal = null; saveData(); forceUpdate(); }
    function saveGnEdit(i: number) { const v = gnEditVal.trim(); if (!v) { setGnEditIdx(null); return; } globalNickEntries = [...globalNickEntries]; globalNickEntries[i] = v; saveData(); setGnEditIdx(null); forceUpdate(); }

    return (
        <div>

            <div className="rs-card">
                <SectionHeader
                    label="Global Display Name" color={C.nick} count={globalNickEntries.length}
                    enabled={settings.store.globalNickEnabled}
                    onToggleEnabled={v => { settings.store.globalNickEnabled = v; if (pluginActive) { stopGlobalNickTimer(); if (v && !settings.store.globalSync) scheduleGlobalNickLoop(); } forceUpdate(); }}
                    rndValue={settings.store.globalNickRandomize} onToggleRnd={v => { settings.store.globalNickRandomize = v; forceUpdate(); }}
                    enableColor={C.nick}
                />
                <PanelInterval label="Display Name Interval" description="Seconds between display name changes. Min enforced: 429s. Uses /users/@me global_name - separate endpoint from bio/pronouns."
                    storeKey="globalNickIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.globalNickEnabled && !settings.store.globalSync) { stopGlobalNickTimer(); scheduleGlobalNickLoop(); } }} />
                <div className="rs-hint" style={{ margin: "4px 0 6px" }}>
                    Changes your <b style={{ color: C.nick }}>global display name</b> via <b style={{ color: C.hint }}>/users/@me</b> (global_name). Max 32 chars. Minimum interval: 429s.
                </div>
                <div className="rs-divider" style={{ margin: "5px 0 6px" }} />
                {confirmGn && <ConfirmBox msg="Delete all display name entries?" onConfirm={() => { globalNickEntries = []; globalNickSeqIdx = 0; globalNickLastVal = null; saveData(); forceUpdate(); setConfirmGn(false); }} onCancel={() => setConfirmGn(false)} />}
                {globalNickEntries.length === 0 && <div className="rs-empty" style={{ marginBottom: 5 }}>No display name entries yet.</div>}
                {globalNickEntries.map((n, i) => (
                    <div key={`gn_${i}_${n}`} {...gnDProps(i)} className={gnCls(i, "rs-item rs-item-compact")}>
                        <span className="rs-drag">⠿</span>
                        {gnEditIdx === i
                            ? <input autoFocus className="rs-item-input" value={gnEditVal}
                                onChange={e => setGnEditVal(e.target.value)}
                                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveGnEdit(i); if (e.key === "Escape") setGnEditIdx(null); }}
                                onBlur={() => saveGnEdit(i)} maxLength={32} />
                            : <span className="rs-item-text" style={{ fontWeight: 600, color: C.nick }} onClick={() => { setGnEditIdx(i); setGnEditVal(n); }}>{n}</span>
                        }
                        <span style={{ fontSize: 9, color: "#757575" }}>{n.length}/32</span>
                        <button className="rs-edit-btn" onClick={() => { setGnEditIdx(i); setGnEditVal(n); }}>&#9998;</button>
                        <button className="rs-del-btn" onClick={() => removeGn(i)}>&#10005;</button>
                    </div>
                ))}
                <div className="rs-row" style={{ marginTop: 5 }}>
                    <TextInput value={gnDraft} onChange={(v: string) => setGnDraft(v.slice(0, 32))} placeholder="Add display name (max 32)..."
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addGn(); }} />
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={addGn} className="rs-btn-sm">Add</Button>
                    {globalNickEntries.length > 0 && <button className="rs-clearall" onClick={() => setConfirmGn(true)}>Clear</button>}
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Global Pronouns" color={C.pronoun} count={prList.length}
                    enabled={settings.store.profilePronounsEnabled}
                    onToggleEnabled={v => { settings.store.profilePronounsEnabled = v; if (pluginActive) { stopPronounsTimer(); if (v && !settings.store.globalSync) schedulePronounsLoop(); } forceUpdate(); }}
                    rndValue={settings.store.pronounsRandomize} onToggleRnd={v => { settings.store.pronounsRandomize = v; forceUpdate(); }}
                    enableColor={C.pronoun}
                />
                <PanelInterval label="Pronouns Interval" description="Seconds between global pronoun changes (ignored when Master Sync is ON)"
                    storeKey="pronounsIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.profilePronounsEnabled && !settings.store.globalSync) { stopPronounsTimer(); schedulePronounsLoop(); } }} />
                <div className="rs-hint" style={{ margin: "4px 0 6px" }}>Applied globally via <b style={{ color: C.hint }}>/users/@me/profile</b>. Drag to reorder.</div>
                <div className="rs-divider" style={{ margin: "5px 0 6px" }} />
                {confirmPr && <ConfirmBox msg="Delete all pronouns?" onConfirm={() => { pronounsList = ""; prSeqIdx = 0; prLastVal = null; saveData(); forceUpdate(); setConfirmPr(false); }} onCancel={() => setConfirmPr(false)} />}
                {prList.length === 0 && <div className="rs-empty" style={{ marginBottom: 5 }}>No pronouns yet.</div>}
                {prList.map((p, i) => (
                    <div key={`pr_${i}_${p}`} {...prDProps(i)} className={prCls(i, "rs-item rs-item-compact")}>
                        <span className="rs-drag">⠿</span>
                        <span style={{ flex: 1, fontSize: 12, color: C.text, fontWeight: 600 }}>{p}</span>
                        <button className="rs-del-btn" onClick={() => removePronoun(i)}>&#10005;</button>
                    </div>
                ))}
                <div className="rs-row" style={{ marginTop: 5 }}>
                    <TextInput value={prDraft} onChange={setPrDraft} placeholder="Add pronoun (e.g. he/him)..."
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addPronoun(); }} />
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={addPronoun} className="rs-btn-sm">Add</Button>
                    {prList.length > 0 && <button className="rs-clearall" onClick={() => setConfirmPr(true)}>Clear</button>}
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Bio" color={C.bio} count={bioEntries.length}
                    enabled={settings.store.profileBioEnabled}
                    onToggleEnabled={v => { settings.store.profileBioEnabled = v; if (pluginActive) { stopBioTimer(); if (v && !settings.store.globalSync) scheduleBioLoop(); } forceUpdate(); }}
                    rndValue={settings.store.bioRandomize} onToggleRnd={v => { settings.store.bioRandomize = v; forceUpdate(); }}
                    enableColor={C.bio}
                />
                <PanelInterval label="Bio Interval" description="Seconds between bio changes (ignored when Master Sync is ON)"
                    storeKey="bioIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.profileBioEnabled && !settings.store.globalSync) { stopBioTimer(); scheduleBioLoop(); } }} />
                <div className="rs-divider" style={{ margin: "7px 0 6px" }} />
                {confirmBio && <ConfirmBox msg="Delete all bio entries?" onConfirm={() => { bioEntries = []; bioSeqIdx = 0; bioLastVal = null; saveData(); forceUpdate(); setConfirmBio(false); }} onCancel={() => setConfirmBio(false)} />}
                <div className="rs-bio-list">
                    {bioEntries.length === 0 && <div className="rs-empty">No bio entries - add below.</div>}
                    {bioEntries.map((e, i) => (
                        <div key={`bio_${i}_${e.slice(0, 8)}`} {...bioDProps(i)} className={bioCls(i, `rs-bio-item${bioEditIdx === i ? " editing" : ""}`)}>
                            <span className="rs-drag" style={{ padding: "5px 3px", display: "flex", alignItems: "center", alignSelf: "stretch" }}>⠿</span>
                            {bioEditIdx === i
                                ? <textarea autoFocus className="rs-bio-edit-area" value={bioEditVal}
                                    onChange={ev => setBioEditVal(ev.target.value)}
                                    onKeyDown={(ev: React.KeyboardEvent) => { if (ev.key === "Enter" && ev.ctrlKey) saveBioEdit(i); if (ev.key === "Escape") setBioEditIdx(null); }} />
                                : <div className="rs-bio-view" onClick={() => { setBioEditIdx(i); setBioEditVal(e); }}>{e}</div>
                            }
                            <div className="rs-bio-btns">
                                {bioEditIdx === i
                                    ? (<><button className="rs-bio-btn save" onClick={() => saveBioEdit(i)}>&#10004;</button><button className="rs-bio-btn" onClick={() => setBioEditIdx(null)}>&#10005;</button></>)
                                    : (<><button className="rs-bio-btn" onClick={() => { setBioEditIdx(i); setBioEditVal(e); }}>&#9998;</button><button className="rs-bio-btn del" onClick={() => removeBio(i)}>&#10005;</button></>)
                                }
                            </div>
                        </div>
                    ))}
                </div>
                <div className="rs-add-row">
                    <textarea value={bioDraft} onChange={e => setBioDraft(e.target.value)} placeholder="New bio entry... (multi-line OK)"
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); addBio(); } }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button className="rs-btn" style={{ background: C.bio }} onClick={addBio}>Add</button>
                        {bioEntries.length > 0 && <button className="rs-clearall" onClick={() => setConfirmBio(true)}>Clear</button>}
                    </div>
                </div>
                <div className="rs-hint" style={{ marginTop: 3 }}>Click to edit · Drag to reorder · Ctrl+Enter to add · Interval: <b style={{ color: C.data }}>{settings.store.bioIntervalSeconds}s</b></div>
            </div>

        </div>
    );
}


function NicksTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [filter, setFilter] = React.useState("");
    const [sort, setSort] = React.useState<SortMode>("enabled");
    const [nickInputs, setNickInputs] = React.useState<Record<string, string>>({});
    const [nickEdit, setNickEdit] = React.useState<Record<string, { idx: number; val: string } | null>>({});
    const [manualId, setManualId] = React.useState("");
    const [manualName, setManualName] = React.useState("");

    const { props: gnDProps, cls: gnCls } = useDrag((f, t) => {
        globalNicks = reorder(globalNicks, f, t); saveData(); forceUpdate();
    });
    const { props: gpDProps, cls: gpCls } = useDrag((f, t) => {
        globalGuildPronouns = reorder(globalGuildPronouns, f, t); saveData(); forceUpdate();
    });

    function addNick(g: GuildEntry) { const v = (nickInputs[g.id] ?? "").trim(); if (!v || g.nicks.includes(v)) return; g.nicks = [...g.nicks, v]; saveData(); setNickInputs(p => ({ ...p, [g.id]: "" })); forceUpdate(); }
    function removeNick(g: GuildEntry, i: number) { g.nicks = g.nicks.filter((_, j) => j !== i); g.seqIndex = 0; g.lastNickVal = null; saveData(); forceUpdate(); }
    function saveNickEdit(g: GuildEntry) {
        const es = nickEdit[g.id]; if (!es) return;
        const v = es.val.trim();
        setNickEdit(p => ({ ...p, [g.id]: null }));
        if (!v) return;
        g.nicks = [...g.nicks]; g.nicks[es.idx] = v; saveData(); forceUpdate();
    }
    function toggleGuild(g: GuildEntry) {
        g.enabled = !g.enabled;
        if (g.enabled) {
            const voiceOnly = g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal;
            if (!voiceOnly && !settings.store.globalSync) {
                if (settings.store.nickEnabled) scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
                if (g.guildPronounsEnabled && pronounsForGuild(g).length > 0) startGuildPronouns(g);
            }
        } else {
            stopNickGuild(g.id); stopGuildPronouns(g.id);
        }
        saveData(); forceUpdate();
    }
    function toggleNickActive(g: GuildEntry) {
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            g.nickVoiceEnabled = !g.nickVoiceEnabled;
            saveData();
            if (pluginActive) {
                const inVoice = getMyVoiceGuildId() === g.id;
                if (g.nickVoiceEnabled && inVoice && settings.store.nickEnabled && !nickTimers.has(g.id)) {
                    scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
                } else if (!g.nickVoiceEnabled && nickTimers.has(g.id)) {
                    stopNickGuild(g.id);
                }
            }
            forceUpdate();
            return;
        }
        if (nickTimers.has(g.id)) stopNickGuild(g.id);
        else if (settings.store.nickEnabled && !settings.store.globalSync) scheduleNickTick(g, getMs(settings.store.nickIntervalSeconds));
        forceUpdate();
    }
    function toggleGuildPronounsActive(g: GuildEntry) {
        if (g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal) {
            g.pronounsVoiceEnabled = !g.pronounsVoiceEnabled;
            saveData();
            if (pluginActive) {
                const inVoice = getMyVoiceGuildId() === g.id;
                if (g.pronounsVoiceEnabled && inVoice && settings.store.serverPronounsEnabled && !guildPronounsTimers.has(g.id)) {
                    scheduleGuildPronounsTick(g, getMs(settings.store.serverPronounsIntervalSeconds));
                } else if (!g.pronounsVoiceEnabled && guildPronounsTimers.has(g.id)) {
                    stopGuildPronouns(g.id);
                }
            }
            forceUpdate();
            return;
        }
        if (!settings.store.serverPronounsEnabled) return;
        g.guildPronounsEnabled = !g.guildPronounsEnabled;
        if (pluginActive) {
            if (g.guildPronounsEnabled) startGuildPronouns(g);
            else stopGuildPronouns(g.id);
        }
        saveData(); forceUpdate();
    }
    function cycleMode(g: GuildEntry) { g.nickMode = NM_NEXT[nickModeOf(g)]; g.seqIndex = 0; g.lastNickVal = null; saveData(); forceUpdate(); }
    function addManual() {
        const id = manualId.trim(); const name = manualName.trim() || id;
        if (!id || !/^\d{17,20}$/.test(id) || guilds.find(g => g.id === id)) return;
        guilds.push({ id, name, nicks: [], enabled: false, seqIndex: 0, manual: true, nickMode: "custom", guildPronouns: [], guildPronounsEnabled: false, guildPronounsSeqIdx: 0, guildPronounsLastVal: null, guildPronounsMode: "custom", voiceActivated: false, nickVoiceEnabled: false, pronounsVoiceEnabled: false });
        saveData(); setManualId(""); setManualName(""); forceUpdate();
    }
    function removeGuild(g: GuildEntry) { stopNickGuild(g.id); guilds = guilds.filter(x => x.id !== g.id); saveData(); forceUpdate(); }
    function enableAll() { guilds.forEach(g => { if (!g.enabled) { g.enabled = true; if (!settings.store.globalSync) { startNickGuild(g); startGuildPronouns(g); } } }); saveData(); forceUpdate(); }
    function disableAll() { guilds.forEach(g => { g.enabled = false; stopNickGuild(g.id); }); saveData(); forceUpdate(); }
    function resetAllNicks() { guilds.forEach(g => { g.nicks = []; g.seqIndex = 0; g.lastNickVal = null; }); saveData(); forceUpdate(); }

    let sorted = [...guilds];
    if (filter) sorted = sorted.filter(g => g.name.toLowerCase().includes(filter.toLowerCase()) || g.id.includes(filter));
    if (sort === "enabled") sorted.sort((a, b) => Number(b.enabled) - Number(a.enabled));
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "nicks") sorted.sort((a, b) => b.nicks.length - a.nicks.length);
    else if (sort === "running") sorted.sort((a, b) => Number(nickTimers.has(b.id)) - Number(nickTimers.has(a.id)));
    else if (sort === "pronouns") sorted.sort((a, b) => (b.guildPronouns?.length ?? 0) - (a.guildPronouns?.length ?? 0));

    const activeCount = nickTimers.size;
    const enabledCount = guilds.filter(g => g.enabled).length;

    return (
        <div>
            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Server Nicknames" color={C.nick}
                    enabled={settings.store.nickEnabled}
                    onToggleEnabled={v => { settings.store.nickEnabled = v; if (pluginActive) { if (v) { for (const g of guilds.filter(x => x.enabled)) startNickGuild(g); } else stopAllNicks(); } forceUpdate(); }}
                    rndValue={settings.store.nickRandomize} onToggleRnd={v => { settings.store.nickRandomize = v; forceUpdate(); }}
                    enableColor={C.nick}
                />
                <PanelInterval label="Nickname Interval" description="Seconds between nickname changes per server (ignored when Master Sync is ON)"
                    storeKey="nickIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.nickEnabled && !settings.store.globalSync) { stopAllNicks(); for (const g of guilds.filter(x => x.enabled)) startNickGuild(g); } }} />
                <div className="rs-hint" style={{ marginTop: 5 }}>
                    Nick source mode per server - <b style={{ color: NM_COLOR.custom }}>Custom</b>: server-specific only · <b style={{ color: NM_COLOR.global }}>Global</b>: shared pool · <b style={{ color: NM_COLOR.both }}>Both</b>: merged
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8 }}>
                <SectionHeader
                    label="Server Pronouns" color={C.pronoun}
                    enabled={settings.store.serverPronounsEnabled}
                    onToggleEnabled={v => { settings.store.serverPronounsEnabled = v; if (pluginActive) { if (v) { for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0)) startGuildPronouns(g); } else stopAllGuildPronouns(); } forceUpdate(); }}
                    rndValue={settings.store.serverPronounsRandomize} onToggleRnd={v => { settings.store.serverPronounsRandomize = v; forceUpdate(); }}
                    enableColor={C.pronoun}
                />
                <PanelInterval label="Pronouns Interval" description="Seconds between pronoun changes per server (ignored when Master Sync is ON)"
                    storeKey="serverPronounsIntervalSeconds" disabled={settings.store.globalSync}
                    onApply={() => { if (pluginActive && settings.store.serverPronounsEnabled && !settings.store.globalSync) { stopAllGuildPronouns(); for (const g of guilds.filter(x => x.guildPronounsEnabled && pronounsForGuild(x).length > 0)) startGuildPronouns(g); } }} />
                <div className="rs-hint" style={{ marginTop: 5 }}>Each server can have its own pronoun list. Servers with no local entries fall back to the <b style={{ color: C.pronoun }}>Global Pronoun Pool</b>.</div>
                <div className="rs-warn-box" style={{ marginTop: 6 }}>
                    ⚠️ Server pronouns use <b>/users/@me/guilds/&#123;id&#125;/profile</b> — Discord may return 403/404 on servers where this is restricted. 429 errors in console during cycles are expected and handled automatically.
                </div>
            </div>

            <div className="rs-card" style={{ marginBottom: 8, border: "1.5px solid rgba(121,134,203,.3)", background: "rgba(10,10,40,.5)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: "#7986cb" }}>Voice Activation</span>
                    <div style={{ flex: 1, height: 1, background: "rgba(121,134,203,.2)" }} />
                    <button
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, border: `1px solid ${settings.store.voiceActivateEnabled ? "#7986cb55" : "rgba(80,60,110,.3)"}`, background: settings.store.voiceActivateEnabled ? "#7986cb20" : "rgba(15,5,35,.5)", color: settings.store.voiceActivateEnabled ? "#7986cb" : "#5a4a7a", cursor: "pointer", fontSize: 11, fontWeight: 800 }}
                        onClick={() => { settings.store.voiceActivateEnabled = !settings.store.voiceActivateEnabled; if (pluginActive) { stopVoiceWatcher(); if (settings.store.voiceActivateEnabled) startVoiceWatcher(); else startAllRotators(); } forceUpdate(); }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: settings.store.voiceActivateEnabled ? "#7986cb" : "#3a2a5a", display: "inline-block" }} />
                        {settings.store.voiceActivateEnabled ? "Enabled" : "Disabled"}
                    </button>
                </div>
                {settings.store.voiceActivateEnabled && (
                    <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
                        <PanelToggle label="Global Voice" description="Join ANY voice/call/DM → start ALL enabled server nick+pronoun cycles. Leave → stop all. Overrides per-server."
                            value={settings.store.voiceActivateGlobal} color="#7986cb"
                            onChange={v => { settings.store.voiceActivateGlobal = v; if (pluginActive) startAllRotators(); forceUpdate(); }} />
                        <div className="rs-hint">
                            {settings.store.voiceActivateGlobal
                                ? "Global: all server nicks+pronouns activate on any voice join, deactivate on leave."
                                : "Per-server: use the 🔊 VC-only / Always button (left of ON/OFF) on each server card to set its mode."
                            }
                        </div>
                    </div>
                )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.nick }}>Global Nick Pool</span>
                <div style={{ flex: 1, height: 1, background: `${C.nick}33` }} />
                <span className="rs-count">{globalNicks.length}</span>
            </div>
            <div className="rs-hint" style={{ marginBottom: 5 }}>Shared nicknames for servers in <b style={{ color: NM_COLOR.global }}>Global</b> or <b style={{ color: NM_COLOR.both }}>Both</b> mode. Drag to reorder, click to edit.</div>
            <div className="rs-nick-list">
                {globalNicks.length === 0 && <span className="rs-empty">No shared nicks yet.</span>}
                {globalNicks.map((n, ni) => {
                    const es = nickEdit["__g"];
                    return (
                        <div key={`gn_${ni}`} {...gnDProps(ni)} className={gnCls(ni, "rs-item rs-item-compact")}>
                            <span className="rs-drag">⠿</span>
                            {es && es.idx === ni
                                ? <input autoFocus className="rs-item-input" value={es.val}
                                    onChange={e => setNickEdit(p => ({ ...p, __g: { idx: ni, val: e.target.value } }))}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                        if (e.key === "Enter") { const v = es.val.trim(); if (v) { globalNicks = [...globalNicks]; globalNicks[ni] = v; saveData(); } setNickEdit(p => ({ ...p, __g: null })); forceUpdate(); }
                                        if (e.key === "Escape") setNickEdit(p => ({ ...p, __g: null }));
                                    }}
                                    onBlur={() => { const v = es.val.trim(); if (v) { globalNicks = [...globalNicks]; globalNicks[ni] = v; saveData(); } setNickEdit(p => ({ ...p, __g: null })); forceUpdate(); }} />
                                : <span className="rs-item-text" style={{ fontWeight: 600, color: C.nick }}>{n}</span>
                            }
                            <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, __g: { idx: ni, val: n } }))}>&#9998;</button>
                            <button className="rs-del-btn" onClick={() => { globalNicks = globalNicks.filter((_, j) => j !== ni); saveData(); forceUpdate(); }}>&#10005;</button>
                        </div>
                    );
                })}
            </div>
            <div className="rs-row" style={{ marginTop: 5, marginBottom: 10 }}>
                <TextInput placeholder="Add to global nick pool..." value={nickInputs.__g ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, __g: v }))}
                    onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter") { const v = (nickInputs.__g ?? "").trim(); if (v && !globalNicks.includes(v)) { globalNicks = [...globalNicks, v]; saveData(); setNickInputs(p => ({ ...p, __g: "" })); forceUpdate(); } }
                    }} />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={() => {
                    const v = (nickInputs.__g ?? "").trim();
                    if (v && !globalNicks.includes(v)) { globalNicks = [...globalNicks, v]; saveData(); setNickInputs(p => ({ ...p, __g: "" })); forceUpdate(); }
                }}>Add</Button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".8px", color: C.pronoun }}>Global Pronoun Pool</span>
                <div style={{ flex: 1, height: 1, background: `${C.pronoun}33` }} />
                <span className="rs-count">{globalGuildPronouns.length}</span>
            </div>
            <div className="rs-hint" style={{ marginBottom: 5 }}>Fallback pool for servers with no local pronouns. Drag to reorder, click to edit.</div>
            <div className="rs-nick-list">
                {globalGuildPronouns.length === 0 && <span className="rs-empty">No global pronouns yet.</span>}
                {globalGuildPronouns.map((pr, pi) => {
                    const key = `__gpr_${pi}`;
                    const es = nickEdit[key];
                    return (
                        <div key={`ggpr_${pi}`} {...gpDProps(pi)} className={gpCls(pi, "rs-item rs-item-compact")}>
                            <span className="rs-drag">⠿</span>
                            {es
                                ? <input autoFocus className="rs-item-input" value={es.val} maxLength={40}
                                    onChange={e => setNickEdit(p => ({ ...p, [key]: { idx: pi, val: e.target.value } }))}
                                    onKeyDown={(e: React.KeyboardEvent) => {
                                        if (e.key === "Enter") { const v = es.val.trim(); if (v) { globalGuildPronouns = [...globalGuildPronouns]; globalGuildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [key]: null })); forceUpdate(); }
                                        if (e.key === "Escape") setNickEdit(p => ({ ...p, [key]: null }));
                                    }}
                                    onBlur={() => { const v = es.val.trim(); if (v) { globalGuildPronouns = [...globalGuildPronouns]; globalGuildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [key]: null })); forceUpdate(); }} />
                                : <span className="rs-item-text" style={{ fontWeight: 600, color: C.pronoun }}>{pr}</span>
                            }
                            <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, [key]: { idx: pi, val: pr } }))}>&#9998;</button>
                            <button className="rs-del-btn" onClick={() => { globalGuildPronouns = globalGuildPronouns.filter((_, j) => j !== pi); saveData(); forceUpdate(); }}>&#10005;</button>
                        </div>
                    );
                })}
            </div>
            <div className="rs-row" style={{ marginTop: 5, marginBottom: 10 }}>
                <TextInput placeholder="Add to global pronoun pool (max 40)..." value={nickInputs.__gpr ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, __gpr: v.slice(0, 40) }))}
                    onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter") { const v = (nickInputs.__gpr ?? "").trim(); if (v && !globalGuildPronouns.includes(v)) { globalGuildPronouns = [...globalGuildPronouns, v]; saveData(); setNickInputs(p => ({ ...p, __gpr: "" })); forceUpdate(); } }
                    }} />
                <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={() => {
                    const v = (nickInputs.__gpr ?? "").trim();
                    if (v && !globalGuildPronouns.includes(v)) { globalGuildPronouns = [...globalGuildPronouns, v]; saveData(); setNickInputs(p => ({ ...p, __gpr: "" })); forceUpdate(); }
                }}>Add</Button>
            </div>

            <div className="rs-divider" style={{ margin: "4px 0 8px" }} />

            <div className="rs-toolbar">
                <TextInput placeholder="Filter servers..." value={filter} onChange={setFilter} />
                {(["enabled", "name", "nicks", "pronouns", "running"] as SortMode[]).map(m => (
                    <button key={m} className="rs-sort-btn"
                        style={{ background: sort === m ? "rgba(124,77,255,.35)" : "rgba(124,77,255,.1)", border: "1px solid rgba(124,77,255,.25)", color: sort === m ? "#e8d5ff" : "#757575", cursor: "pointer" }}
                        onClick={() => setSort(m)}>{m}</button>
                ))}
            </div>

            {sorted.length === 0 && <div className="rs-empty">No servers found.</div>}
            {sorted.map(g => {
                const color = colorFor(g.id);
                const running = nickTimers.has(g.id) && settings.store.nickEnabled;
                const mode = nickModeOf(g);
                const effective = [...new Set(nicksForGuild(g))];
                const es = nickEdit[g.id] ?? null;
                const gPrList = g.guildPronouns ?? [];
                const effectivePrList = pronounsForGuild(g);
                // Determine if nick should be considered "active" for styling
                const isNickActive = g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal
                    ? g.nickVoiceEnabled
                    : running;
                const isPronounsActive = g.voiceActivated && settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal
                    ? g.pronounsVoiceEnabled
                    : g.guildPronounsEnabled;
                return (
                    <div key={g.id} className="rs-card" style={{ borderColor: (g.enabled && settings.store.nickEnabled) ? `${color}60` : "rgba(124,77,255,.2)" }}>
                        <div className="rs-card-header">
                            <div className="rs-card-left">
                                <div className="rs-dot" style={{ width: 7, height: 7, background: running ? color : "#2a1a4a" }} />
                                <span className="rs-server-name">{g.name}</span>
                                <span className="rs-server-id">{g.id}</span>
                                <span className="rs-badge" style={{ background: `${NM_COLOR[mode]}18`, color: NM_COLOR[mode], border: `1px solid ${NM_COLOR[mode]}33` }}>
                                    {NM_LABEL[mode]} · {mode === "global" ? globalNicks.length : mode === "both" ? effective.length : g.nicks.length} nicks
                                </span>
                                {g.guildPronounsEnabled && (
                                    <span className="rs-badge" style={{ background: `${NM_COLOR[g.guildPronounsMode ?? "custom"]}18`, color: NM_COLOR[g.guildPronounsMode ?? "custom"], border: `1px solid ${NM_COLOR[g.guildPronounsMode ?? "custom"]}33` }}>
                                        {NM_LABEL[g.guildPronounsMode ?? "custom"]} · {effectivePrList.length} pr
                                    </span>
                                )}
                                {g.manual && <span className="rs-badge" style={{ background: "rgba(120,120,120,.12)", color: "#9e9e9e" }}>manual</span>}
                            </div>
                            <div className="rs-actions">
                                {settings.store.voiceActivateEnabled && !settings.store.voiceActivateGlobal && (
                                    <button
                                        style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", borderRadius: 6, border: `1px solid ${g.voiceActivated ? "#7986cb55" : "rgba(80,60,110,.3)"}`, background: g.voiceActivated ? "#7986cb22" : "rgba(15,5,35,.5)", color: g.voiceActivated ? "#7986cb" : "#5a4a7a", cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0 }}
                                        title="Toggle: Voice-only activates nicks+pronouns only when in this server's voice"
                                        onClick={() => { g.voiceActivated = !g.voiceActivated; saveData(); forceUpdate(); }}>
                                        🔊 {g.voiceActivated ? "VC-only" : "Always"}
                                    </button>
                                )}
                                <Button size={Button.Sizes.SMALL} color={g.enabled ? Button.Colors.GREEN : Button.Colors.GREY} className="rs-btn-sm"
                                    onClick={() => toggleGuild(g)}>{g.enabled ? "ON" : "OFF"}</Button>
                                {g.manual && <button className="rs-del-btn" onClick={() => removeGuild(g)}>&#10005;</button>}
                            </div>
                        </div>
                        {g.enabled && (
                            <div className="rs-nick-expand">
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: NM_COLOR[mode] }}>Nicks</span>
                                    <div style={{ flex: 1, height: 1, background: `${NM_COLOR[mode]}22` }} />
                                    <span className="rs-count" style={{ background: `${NM_COLOR[mode]}18`, color: NM_COLOR[mode] }}>
                                        {mode === "global" ? globalNicks.length : mode === "both" ? effective.length : g.nicks.length}
                                    </span>
                                    <button
                                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6, border: `1px solid ${NM_COLOR[mode]}44`, background: `${NM_COLOR[mode]}18`, color: NM_COLOR[mode], cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0, transition: "all .15s" }}
                                        title="Cycle: Custom → Global → Both" onClick={() => cycleMode(g)}>{NM_LABEL[mode]}
                                    </button>
                                    <button
                                        style={{
                                            display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6,
                                            border: `1px solid ${isNickActive ? NM_COLOR[mode] + "44" : "rgba(80,60,110,.35)"}`,
                                            background: isNickActive ? `${NM_COLOR[mode]}20` : "rgba(15,5,35,.55)",
                                            color: isNickActive ? NM_COLOR[mode] : "#5a4a7a",
                                            cursor: settings.store.nickEnabled ? "pointer" : "not-allowed",
                                            fontSize: 10, fontWeight: 800, flexShrink: 0,
                                            opacity: settings.store.nickEnabled ? 1 : 0.4
                                        }}
                                        onClick={() => { if (settings.store.nickEnabled) toggleNickActive(g); }}>
                                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: isNickActive ? NM_COLOR[mode] : "#3a2a5a", display: "inline-block" }} />
                                        {settings.store.nickEnabled ? (isNickActive ? "Active" : "Inactive") : "Disabled"}
                                    </button>
                                </div>
                                <div className="rs-hint" style={{ marginBottom: 5, color: NM_COLOR[mode] }}>
                                    {mode === "custom" ? "Server-specific nicks only (falls back to global if empty)" : mode === "global" ? "Global pool only" : "Global pool + server-specific, merged"}
                                </div>
                                {(mode === "custom" || mode === "both") && (
                                    <>
                                        <div className="rs-nick-list">
                                            {g.nicks.length === 0
                                                ? <span className="rs-empty">{mode === "custom" ? `No custom nicks - using global pool (${globalNicks.length}).` : "No custom nicks yet."}</span>
                                                : g.nicks.map((n, ni) => (
                                                    <div key={`${g.id}_n_${ni}`}
                                                        draggable
                                                        onDragStart={de => { de.dataTransfer.effectAllowed = "move"; de.dataTransfer.setData("text/plain", `NICK:${g.id}:${ni}`); }}
                                                        onDragOver={de => de.preventDefault()}
                                                        onDrop={de => {
                                                            de.preventDefault();
                                                            const [type, dGid, dI] = de.dataTransfer.getData("text/plain").split(":");
                                                            if (type === "NICK" && dGid === g.id) { const from = parseInt(dI, 10); if (!isNaN(from) && from !== ni) { g.nicks = reorder(g.nicks, from, ni); g.seqIndex = 0; g.lastNickVal = null; saveData(); forceUpdate(); } }
                                                        }}
                                                        className="rs-item rs-item-compact">
                                                        <span className="rs-drag">⠿</span>
                                                        {es && es.idx === ni
                                                            ? <input autoFocus className="rs-item-input" value={es.val}
                                                                onChange={e2 => setNickEdit(p => ({ ...p, [g.id]: { idx: ni, val: e2.target.value } }))}
                                                                onKeyDown={(e2: React.KeyboardEvent) => { if (e2.key === "Enter") saveNickEdit(g); if (e2.key === "Escape") setNickEdit(p => ({ ...p, [g.id]: null })); }}
                                                                onBlur={() => saveNickEdit(g)} />
                                                            : <span className="rs-item-text" style={{ color: color, fontWeight: 600 }}>{n}</span>
                                                        }
                                                        <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, [g.id]: { idx: ni, val: n } }))}>&#9998;</button>
                                                        <button className="rs-del-btn" onClick={() => removeNick(g, ni)}>&#10005;</button>
                                                    </div>
                                                ))}
                                        </div>
                                        <div className="rs-row">
                                            <TextInput value={nickInputs[g.id] ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, [g.id]: v }))}
                                                placeholder="Add a custom nick for this server..."
                                                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") addNick(g); }} />
                                            <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => addNick(g)} className="rs-btn-sm">Add</Button>
                                        </div>
                                    </>
                                )}
                                {mode === "global" && (
                                    <div className="rs-hint">Using global pool (<b style={{ color: C.nick }}>{globalNicks.length} nicks</b>). Switch to Custom or Both to add server-specific nicks.</div>
                                )}

                                <div style={{ marginTop: 8, borderTop: `1px solid ${C.pronoun}22`, paddingTop: 7 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: C.pronoun }}>Pronouns</span>
                                        <div style={{ flex: 1, height: 1, background: `${C.pronoun}22` }} />
                                        <span className="rs-count" style={{ background: `${C.pronoun}18`, color: C.pronoun }}>
                                            {effectivePrList.length}
                                        </span>
                                        <button
                                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6, border: `1px solid ${NM_COLOR[g.guildPronounsMode ?? "custom"]}44`, background: `${NM_COLOR[g.guildPronounsMode ?? "custom"]}18`, color: NM_COLOR[g.guildPronounsMode ?? "custom"], cursor: "pointer", fontSize: 10, fontWeight: 800, flexShrink: 0, transition: "all .15s" }}
                                            title="Cycle pronoun‑source mode: Custom → Global → Both"
                                            onClick={() => { const cur: NickMode = g.guildPronounsMode ?? "custom"; g.guildPronounsMode = NM_NEXT[cur]; g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; saveData(); forceUpdate(); }}>
                                            {NM_LABEL[g.guildPronounsMode ?? "custom"]}
                                        </button>
                                        <button
                                            style={{
                                                display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6,
                                                border: `1px solid ${isPronounsActive ? C.pronoun + "44" : "rgba(80,60,110,.35)"}`,
                                                background: isPronounsActive ? `${C.pronoun}20` : "rgba(15,5,35,.55)",
                                                color: isPronounsActive ? C.pronoun : "#5a4a7a",
                                                cursor: settings.store.serverPronounsEnabled ? "pointer" : "not-allowed",
                                                fontSize: 10, fontWeight: 800, flexShrink: 0,
                                                opacity: settings.store.serverPronounsEnabled ? 1 : 0.4
                                            }}
                                            onClick={() => { if (settings.store.serverPronounsEnabled) toggleGuildPronounsActive(g); }}>
                                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isPronounsActive ? C.pronoun : "#3a2a5a", display: "inline-block" }} />
                                            {settings.store.serverPronounsEnabled ? (isPronounsActive ? "Active" : "Inactive") : "Disabled"}
                                        </button>
                                    </div>
                                    {(g.guildPronounsMode ?? "custom") === "custom" && gPrList.length === 0 && effectivePrList.length > 0 && (
                                        <div className="rs-hint" style={{ marginBottom: 4, color: C.pronoun }}>No local entries - using {effectivePrList.length} from the global pronoun pool.</div>
                                    )}
                                    {(g.guildPronounsMode ?? "custom") === "global" && (
                                        <div className="rs-hint" style={{ marginBottom: 4, color: NM_COLOR.global }}>Using global pool only (<b>{globalGuildPronouns.length} entries</b>). Switch to Custom or Both to use local.</div>
                                    )}
                                    {(g.guildPronounsMode ?? "custom") === "both" && (
                                        <div className="rs-hint" style={{ marginBottom: 4, color: NM_COLOR.both }}>Merged: {globalGuildPronouns.length} global + {gPrList.length} local = <b>{effectivePrList.length} total</b>.</div>
                                    )}
                                    {effectivePrList.length === 0 && (
                                        <div className="rs-empty" style={{ marginBottom: 4 }}>No pronouns set - add local entries or fill the global pronoun pool above.</div>
                                    )}
                                    {gPrList.map((pr, pi) => (
                                        <div key={`${g.id}_pr_${pi}`}
                                            draggable
                                            onDragStart={de => { de.dataTransfer.effectAllowed = "move"; de.dataTransfer.setData("text/plain", `PR:${g.id}:${pi}`); }}
                                            onDragOver={de => de.preventDefault()}
                                            onDrop={de => {
                                                de.preventDefault();
                                                const parts = de.dataTransfer.getData("text/plain").split(":");
                                                if (parts[0] === "PR" && parts[1] === g.id) { const from = parseInt(parts[2], 10); if (!isNaN(from) && from !== pi) { g.guildPronouns = reorder(gPrList, from, pi); g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; saveData(); forceUpdate(); } }
                                            }}
                                            className="rs-item rs-item-compact" style={{ marginBottom: 2 }}>
                                            <span className="rs-drag">⠿</span>
                                            {nickEdit[`__pr_${g.id}_${pi}`]
                                                ? <input autoFocus className="rs-item-input" value={(nickEdit[`__pr_${g.id}_${pi}`] as any).val} maxLength={40}
                                                    onChange={e2 => setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: { idx: pi, val: e2.target.value } }))}
                                                    onKeyDown={(e2: React.KeyboardEvent) => {
                                                        if (e2.key === "Enter") { const v = (nickEdit[`__pr_${g.id}_${pi}`] as any).val.trim(); if (v) { g.guildPronouns = [...gPrList]; g.guildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: null })); forceUpdate(); }
                                                        if (e2.key === "Escape") setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: null }));
                                                    }}
                                                    onBlur={() => { const ek = nickEdit[`__pr_${g.id}_${pi}`]; const v = (ek as any)?.val?.trim(); if (v) { g.guildPronouns = [...gPrList]; g.guildPronouns[pi] = v; saveData(); } setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: null })); forceUpdate(); }} />
                                                : <span className="rs-item-text" style={{ color: C.pronoun, fontWeight: 600 }}>{pr}</span>
                                            }
                                            <button className="rs-edit-btn" onClick={() => setNickEdit(p => ({ ...p, [`__pr_${g.id}_${pi}`]: { idx: pi, val: pr } }))}>&#9998;</button>
                                            <button className="rs-del-btn" onClick={() => { g.guildPronouns = gPrList.filter((_, j) => j !== pi); g.guildPronounsSeqIdx = 0; g.guildPronounsLastVal = null; saveData(); forceUpdate(); }}>&#10005;</button>
                                        </div>
                                    ))}
                                    <div className="rs-row" style={{ marginTop: 4 }}>
                                        <TextInput value={nickInputs[`__pr_${g.id}`] ?? ""} onChange={(v: string) => setNickInputs(p => ({ ...p, [`__pr_${g.id}`]: v.slice(0, 40) }))}
                                            placeholder="Add a pronoun for this server (max 40)..."
                                            onKeyDown={(e: React.KeyboardEvent) => {
                                                if (e.key === "Enter") { const v = (nickInputs[`__pr_${g.id}`] ?? "").trim(); if (v && !gPrList.includes(v)) { g.guildPronouns = [...gPrList, v]; saveData(); setNickInputs(p => ({ ...p, [`__pr_${g.id}`]: "" })); forceUpdate(); } }
                                            }} />
                                        <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={() => {
                                            const v = (nickInputs[`__pr_${g.id}`] ?? "").trim();
                                            if (v && !gPrList.includes(v)) { g.guildPronouns = [...gPrList, v]; saveData(); setNickInputs(p => ({ ...p, [`__pr_${g.id}`]: "" })); forceUpdate(); }
                                        }}>Add</Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            <div className="rs-manual-add">
                <div className="rs-manual-add-title">Add server manually</div>
                <div style={{ display: "flex", gap: 6 }}>
                    <TextInput placeholder="Server ID (17-20 digits)" value={manualId} onChange={setManualId} style={{ flex: 1 }} />
                    <TextInput placeholder="Label (optional)" value={manualName} onChange={setManualName} style={{ flex: 1 }} />
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} className="rs-btn-sm" onClick={addManual}>Add</Button>
                </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                <Button color={Button.Colors.GREEN} onClick={enableAll} className="rs-btn-sm">Enable All</Button>
                <Button color={Button.Colors.GREY} onClick={disableAll} className="rs-btn-sm">Disable All</Button>
                <Button color={Button.Colors.RED} onClick={resetAllNicks} className="rs-btn-sm">Reset All Nicks</Button>
            </div>
            <div className="rs-hint" style={{ marginTop: 6 }}>
                Nicks: <b style={{ color: settings.store.nickEnabled ? C.enabled : "#ef9a9a" }}>{settings.store.nickEnabled ? "on" : "off"}</b> · {activeCount} running · {enabledCount} servers enabled
                <br />Pronouns: <b style={{ color: settings.store.serverPronounsEnabled ? C.enabled : "#ef9a9a" }}>{settings.store.serverPronounsEnabled ? "on" : "off"}</b> · {guildPronounsTimers.size} running · {settings.store.serverPronounsIntervalSeconds}s interval
            </div>
        </div>
    );

}

function DataTab({ forceUpdate }: { forceUpdate: () => void }) {
    const [importMsg, setImportMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
    const [confirmReset, setConfirmReset] = React.useState(false);
    const isGlobalSync = settings.store.globalSync;

    function doExport() {
        const blob = new Blob([JSON.stringify({
            exportedAt: new Date().toISOString(), createdAt: storeCreatedAt,
            globalNicks, guilds, bioEntries, pronounsList, statusEntries, statusPresets, clanIds,
            statusSeqIdx, clanSeqIdx, bioSeqIdx, prSeqIdx,
            globalNickEntries, globalNickSeqIdx, globalGuildPronouns,
        }, null, 2)], { type: "application/json" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `rotator-suite-${new Date().toISOString().slice(0, 10)}.json` });
        a.click(); URL.revokeObjectURL(a.href);
    }

    function doImport() {
        const inp = Object.assign(document.createElement("input"), { type: "file", accept: ".json" });
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            try {
                const p = JSON.parse(await file.text());
                if (Array.isArray(p.globalNicks)) globalNicks = p.globalNicks;
                if (Array.isArray(p.guilds)) guilds = p.guilds.map((g: any) => ({ ...g, nickMode: g.nickMode ?? (g.useGlobal ? "global" : "custom"), lastNickVal: null, nickVoiceEnabled: g.nickVoiceEnabled ?? g.enabled, pronounsVoiceEnabled: g.pronounsVoiceEnabled ?? g.guildPronounsEnabled }));
                if (Array.isArray(p.bioEntries)) bioEntries = p.bioEntries;
                if (typeof p.pronounsList === "string") pronounsList = p.pronounsList;
                if (Array.isArray(p.statusEntries)) statusEntries = p.statusEntries;
                else if (typeof p.statuses === "string") statusEntries = parseLegacyStatuses(p.statuses);
                if (Array.isArray(p.statusPresets)) statusPresets = p.statusPresets;
                if (Array.isArray(p.clanIds)) clanIds = p.clanIds;
                statusSeqIdx = 0; clanSeqIdx = 0; bioSeqIdx = 0; prSeqIdx = 0;
                statusLastVal = null; clanLastVal = null; bioLastVal = null; prLastVal = null;
                if (Array.isArray(p.globalNickEntries)) globalNickEntries = p.globalNickEntries;
                globalNickSeqIdx = 0; globalNickLastVal = null;
                if (Array.isArray(p.globalGuildPronouns)) globalGuildPronouns = p.globalGuildPronouns;
                await saveData(); startAllRotators();
                const d = p.exportedAt ? new Date(p.exportedAt).toLocaleString() : "unknown";
                setImportMsg({ ok: true, text: `Imported successfully (exported ${d})` });
                forceUpdate(); setTimeout(() => setImportMsg(null), 5000);
            } catch {
                setImportMsg({ ok: false, text: "Import failed - invalid or corrupt JSON" });
                setTimeout(() => setImportMsg(null), 5000);
            }
        };
        inp.click();
    }

    function doResetAll() {
        stopAllRotators();
        globalNicks = []; guilds = []; bioEntries = [];
        pronounsList = ""; statusEntries = []; statusPresets = []; clanIds = [];
        statusSeqIdx = 0; clanSeqIdx = 0; bioSeqIdx = 0; prSeqIdx = 0;
        statusLastVal = null; clanLastVal = null; bioLastVal = null; prLastVal = null;
        globalNickEntries = []; globalNickSeqIdx = 0; globalNickLastVal = null;
        globalGuildPronouns = [];
        storeCreatedAt = new Date().toISOString();
        cachedClanGuilds = []; lastClanFetch = 0;
        syncGuildsFromDiscord();
        saveData(); startAllRotators(); forceUpdate(); setConfirmReset(false);
    }

    const activeLabels = [
        settings.store.statusEnabled && "Status",
        settings.store.clanEnabled && "Clan",
        settings.store.profileBioEnabled && "Bio",
        settings.store.profilePronounsEnabled && "Pronouns",
        settings.store.globalNickEnabled && "Display Name",
        settings.store.nickEnabled && guilds.some(g => g.enabled) && "Server Nicks",
        guilds.some(g => g.guildPronounsEnabled && (g.guildPronouns?.length ?? 0) > 0) && "Server Pronouns",
    ].filter(Boolean) as string[];

    return (
        <div>
            <div className="rs-data-card rs-master-box">
                <div className="rs-data-title">Master Sync</div>
                <div style={{ marginBottom: 7, fontSize: 11, color: "#9e9e9e", lineHeight: 1.5 }}>
                    <b style={{ color: "#f0eaff" }}>ON:</b> all rotators fire together every N seconds. Clan always runs independently.
                    <br /><b style={{ color: "#f0eaff" }}>OFF:</b> each rotator uses its own timer. Changes apply immediately.
                </div>
                <PanelToggle label="Master Sync" description={isGlobalSync ? `All rotators fire every ${settings.store.globalSyncSeconds}s` : "Each rotator runs on its own independent timer"} value={isGlobalSync} color={C.data}
                    onChange={v => { settings.store.globalSync = v; if (pluginActive) startAllRotators(); forceUpdate(); }} />
                <PanelInterval label="Master Sync Interval" description="Unified interval in seconds (only used when Master Sync is ON)"
                    storeKey="globalSyncSeconds" disabled={!isGlobalSync}
                    onApply={() => { if (pluginActive && isGlobalSync) startAllRotators(); }} />
                {isGlobalSync && settings.store.globalNickEnabled && parseFloat(settings.store.globalSyncSeconds) < 429 && (
                    <div className="rs-warn-box" style={{ marginTop: 5 }}>
                        ⚠️ Master Sync interval ({settings.store.globalSyncSeconds}s) is below 429s while Display Name rotation is enabled. Display name changes are automatically throttled to 1 per 429s to avoid rate limits — but going below 429s here is not recommended and may cause repeated 429 errors on /users/@me.
                    </div>
                )}
                <div className="rs-divider" style={{ margin: "8px 0" }} />
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: "#ab47bc", marginBottom: 5 }}>Random Behavior</div>
                <PanelToggle label="No-Duplicate Random" description="Never pick the same entry twice in a row (applies to all rotators)" value={settings.store.noDuplicateRandom}
                    onChange={v => { settings.store.noDuplicateRandom = v; }} />
                <div className="rs-divider" style={{ margin: "8px 0" }} />
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".7px", color: "#9e9e9e", marginBottom: 5 }}>Misc</div>
                <PanelToggle label="Show User Area Button" description="Show the Rotator Suite button in the bottom-left user area" value={settings.store.showButton}
                    onChange={v => { settings.store.showButton = v; forceUpdate(); }} />
                <PanelToggle label="Console Logs" description="Print all rotator activity and errors to the browser console (F12)" value={settings.store.enableLogs}
                    onChange={v => { settings.store.enableLogs = v; }} />
                {activeLabels.length > 0 && (
                    <div style={{ fontSize: 11, color: "#9e9e9e", marginTop: 8 }}>
                        Active: <b style={{ color: C.enabled }}>{activeLabels.join(" · ")}</b>
                    </div>
                )}
                <div style={{ marginTop: 9, display: "flex", gap: 8, alignItems: "center" }}>
                    <Button color={Button.Colors.BRAND} onClick={() => { startAllRotators(); forceUpdate(); }} className="rs-btn-sm">
                        Restart All Rotators
                    </Button>
                    <span className="rs-hint">Use after changing interval values in other tabs.</span>
                </div>
            </div>

            <div className="rs-data-card">
                <div className="rs-data-title">Import / Export</div>
                <div className="rs-data-desc">Export everything to JSON. Import to fully restore any config.</div>
                {storeCreatedAt && <div className="rs-hint" style={{ marginBottom: 8 }}>Data created: <b>{new Date(storeCreatedAt).toLocaleString()}</b></div>}
                {importMsg && (
                    <div className="rs-import-status" style={{
                        background: importMsg.ok ? "rgba(67,160,71,.1)" : "rgba(239,83,80,.1)",
                        borderColor: importMsg.ok ? "rgba(67,160,71,.3)" : "rgba(239,83,80,.3)",
                        color: importMsg.ok ? "#81c784" : "#ef9a9a",
                    }}>{importMsg.text}</div>
                )}
                <div style={{ display: "flex", gap: 7 }}>
                    <Button color={Button.Colors.BRAND} onClick={doExport} className="rs-btn-sm">Export JSON</Button>
                    <Button color={Button.Colors.GREY} onClick={doImport} className="rs-btn-sm">Import JSON</Button>
                </div>
            </div>

            <div className="rs-data-card" style={{ borderColor: "rgba(239,83,80,.28)" }}>
                <div className="rs-data-title" style={{ color: "#ef9a9a" }}>Reset All Data</div>
                <div className="rs-data-desc">Permanently deletes ALL entries: nicks, bio, statuses, clans, pronouns. Servers are re-synced from Discord. Cannot be undone.</div>
                {confirmReset
                    ? <ConfirmBox msg="Permanently delete ALL data? This cannot be undone." onConfirm={doResetAll} onCancel={() => setConfirmReset(false)} />
                    : <button className="rs-clearall" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setConfirmReset(true)}>Reset All</button>
                }
            </div>

            <div className="rs-data-card">
                <div className="rs-data-title">Overview</div>
                <div className="rs-summary-grid">
                    <span>Global nicks (server): <b>{globalNicks.length}</b></span>
                    <span>Nick servers: <b>{guilds.length}</b></span>
                    <span>Bio entries: <b>{bioEntries.length}</b></span>
                    <span>Global pronouns: <b>{parseList(pronounsList).length}</b></span>
                    <span>Display names: <b>{globalNickEntries.length}</b></span>
                    <span>Status entries: <b>{statusEntries.length}</b></span>
                    <span>Clan IDs: <b>{settings.store.clanAutoDetect ? "auto" : clanIds.length}</b></span>
                    <span>Servers w/ guild pronouns: <b>{guilds.filter(g => (g.guildPronouns?.length ?? 0) > 0).length}</b></span>
                </div>
            </div>
        </div>
    );
}

function RotatorSuiteModal({ modalProps }: { modalProps: ModalProps }) {
    const forceUpdate = useForceUpdater();
    const [tab, setTab] = React.useState<TabId>("status");
    const [notActive] = React.useState(!pluginActive);

    React.useEffect(() => {
        const id = setInterval(forceUpdate, 1000);
        return () => clearInterval(id);
    }, []);

    const tabs: { id: TabId; label: string; color: string }[] = [
        { id: "status",  label: "Status",          color: C.status },
        { id: "clan",    label: "Clan",             color: C.clan   },
        { id: "profile", label: "Profile",          color: C.bio    },
        { id: "servers", label: "Server Profiles",  color: C.nick   },
        { id: "data",    label: "Data",             color: C.data   },
    ];

    const isGlobalSync = settings.store.globalSync;
    const totalActive = nickTimers.size + guildPronounsTimers.size + (statusTimer ? 1 : 0) + (clanTimer ? 1 : 0) + (bioTimer ? 1 : 0) + (pronounsTimer ? 1 : 0) + (globalNickTimer ? 1 : 0) + (globalSyncTimer ? 1 : 0);

    return (
        <ModalRoot {...modalProps} className="rs-modal">
            <ModalHeader>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <div className="rs-dot" style={{ width: 8, height: 8, background: totalActive > 0 ? "#9c67ff" : "#2a1a4a" }} />
                    <Forms.FormTitle tag="h2" style={{ margin: 0, flex: 1, background: "linear-gradient(90deg,#9c67ff,#b24df7,#7c4dff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                        Rotator Suite
                    </Forms.FormTitle>
                    {isGlobalSync && (
                        <div style={{ fontSize: 10, padding: "2px 9px", borderRadius: 10, background: "rgba(255,167,38,.15)", color: C.data, fontWeight: 800, border: `1px solid rgba(255,167,38,.35)` }}>
                            SYNC · {settings.store.globalSyncSeconds}s
                        </div>
                    )}
                    <span className="rs-count-badge">{totalActive} timer{totalActive !== 1 ? "s" : ""}</span>
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "11px 15px", overflowY: "auto", maxHeight: "65vh" }}>
                {notActive && (
                    <div style={{ background: "rgba(239,83,80,.1)", border: "1px solid rgba(239,83,80,.4)", borderRadius: 8, padding: "8px 13px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>⚠️</span>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#ef9a9a" }}>Plugin is disabled</div>
                            <div style={{ fontSize: 11, color: "#9e9e9e", marginTop: 2 }}>
                                Rotator Suite is not currently running. Enable it in <b style={{ color: "#f0eaff" }}>Settings → Plugins → Rotator Suite</b>. The panel may display stale or empty data until the plugin is active.
                            </div>
                        </div>
                    </div>
                )}
                <div className="rs-tab-bar">
                    {tabs.map(t => (
                        <button key={t.id} className="rs-tab"
                            style={tab === t.id ? { color: t.color, borderBottomColor: t.color } : {}}
                            onClick={() => setTab(t.id)}>{t.label}</button>
                    ))}
                </div>
                {tab === "status"  && <StatusTab  forceUpdate={forceUpdate} />}
                {tab === "clan"    && <ClanTab    forceUpdate={forceUpdate} />}
                {tab === "profile" && <ProfileTab forceUpdate={forceUpdate} />}
                {tab === "servers" && <NicksTab   forceUpdate={forceUpdate} />}
                {tab === "data"    && <DataTab    forceUpdate={forceUpdate} />}
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
                    <div className="rs-footer-info">
                        {isGlobalSync
                            ? <>
                                <span>Sync: <b style={{ color: C.data }}>{settings.store.globalSyncSeconds}s</b></span>
                                <span>Clan: <b style={{ color: settings.store.clanEnabled ? C.clan : `${C.clan}80` }}>{settings.store.clanEnabled ? settings.store.clanIntervalSeconds + "s" : "off"}</b></span>
                              </>
                            : <>
                                <span>Status: <b style={{ color: settings.store.statusEnabled ? C.status : `${C.status}80` }}>{settings.store.statusEnabled ? settings.store.statusIntervalSeconds + "s" : "off"}</b></span>
                                <span>Clan: <b style={{ color: settings.store.clanEnabled ? C.clan : `${C.clan}80` }}>{settings.store.clanEnabled ? settings.store.clanIntervalSeconds + "s" : "off"}</b></span>
                                <span>DisplayName: <b style={{ color: settings.store.globalNickEnabled ? C.nick : `${C.nick}80` }}>{settings.store.globalNickEnabled ? settings.store.globalNickIntervalSeconds + "s" : "off"}</b></span>
                                <span>DisplayPronoun: <b style={{ color: settings.store.profilePronounsEnabled ? C.pronoun : `${C.pronoun}80` }}>{settings.store.profilePronounsEnabled ? settings.store.pronounsIntervalSeconds + "s" : "off"}</b></span>
                                <span>Bio: <b style={{ color: settings.store.profileBioEnabled ? C.bio : `${C.bio}80` }}>{settings.store.profileBioEnabled ? settings.store.bioIntervalSeconds + "s" : "off"}</b></span>
                                <span>Nicks: <b style={{ color: settings.store.nickEnabled ? C.nick : `${C.nick}80` }}>{settings.store.nickEnabled ? settings.store.nickIntervalSeconds + "s" : "off"}</b></span>
                                <span>Pronouns: <b style={{ color: settings.store.serverPronounsEnabled ? C.pronoun : `${C.pronoun}80` }}>{settings.store.serverPronounsEnabled ? settings.store.serverPronounsIntervalSeconds + "s" : "off"}</b></span>
                            </>
                        }
                    </div>
                    <Button color={Button.Colors.TRANSPARENT} onClick={modalProps.onClose}>Close</Button>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function RSUserAreaButton() {
    const [active, setActive] = React.useState(false);
    React.useEffect(() => {
        const id = setInterval(() => {
            const timers = nickTimers.size + guildPronounsTimers.size + (statusTimer ? 1 : 0) + (clanTimer ? 1 : 0) + (bioTimer ? 1 : 0) + (pronounsTimer ? 1 : 0) + (globalNickTimer ? 1 : 0) + (globalSyncTimer ? 1 : 0);
            setActive(timers > 0);
        }, 800);
        return () => clearInterval(id);
    }, []);

    if (!settings.store.showButton) return null;
    return (
        <UserAreaButton
            tooltipText={active ? "Rotator Suite - running" : "Rotator Suite"}
            icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                    {active && <circle cx="18" cy="6" r="4" fill="#9c67ff" stroke="none" />}
                </svg>
            }
            onClick={() => openModal(props => <RotatorSuiteModal modalProps={props} />)}
        />
    );
}

export default definePlugin({
    name: "Rotator Suite",
    description: "All-in-one Discord identity rotator. Cycles status (presence + presets), clan, bio, global pronouns, global display name, server nicknames, and per-server pronouns - each with its own independent timer. Profile has 3 independent cycles (bio/pronouns/display name). Server Profiles has 2 (nicknames/pronouns). Master Sync, DataStore-persisted, drag-to-reorder, JSON import/export.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,
    dependencies: ["UserAreaAPI"],

    settingsAboutComponent: () => (
        <div style={{ marginTop: 10 }}>
            <Button color={Button.Colors.BRAND} onClick={() => openModal(props => <RotatorSuiteModal modalProps={props} />)}>
                Open Rotator Suite Panel
            </Button>
            <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(239,83,80,.08)", border: "1px solid rgba(239,83,80,.25)" }}>
                <span style={{ fontSize: 12, color: "#ef9a9a", fontWeight: 700 }}>⚠️ Note: </span>
                <span style={{ fontSize: 12, color: "#9e9e9e" }}>The panel may show stale or empty data if the plugin was just enabled. Reload Discord or toggle the plugin off/on if something looks wrong.</span>
            </div>
        </div>
    ),

    async start() {
        injectCSS();
        cachedToken = null; cachedGuildStore = null; cachedClanGuilds = []; lastClanFetch = 0;
        statusLastVal = null; clanLastVal = null; bioLastVal = null; prLastVal = null;
        pluginActive = true;

        const defaults: StoreData = {
            createdAt: new Date().toISOString(), globalNicks: [], guilds: [], bioEntries: [],
            pronounsList: "", statusEntries: [], statusPresets: [],
            clanIds: [], statusSeqIdx: 0, clanSeqIdx: 0, bioSeqIdx: 0, prSeqIdx: 0,
            globalNickEntries: [], globalNickSeqIdx: 0,
            globalGuildPronouns: [],
        };

        const stored: StoreData = (await DataStore.get(SK)) ?? defaults;
        storeCreatedAt = stored.createdAt ?? defaults.createdAt;
        globalNicks  = stored.globalNicks  ?? [];
        guilds       = (stored.guilds ?? []).map((g: any) => ({
            ...g,
            nickMode: g.nickMode ?? (g.useGlobal ? "global" : "custom") as NickMode,
            lastNickVal: null,
            guildPronouns: g.guildPronouns ?? [],
            guildPronounsEnabled: g.guildPronounsEnabled ?? false,
            guildPronounsSeqIdx: g.guildPronounsSeqIdx ?? 0,
            guildPronounsLastVal: g.guildPronounsLastVal ?? null,
            guildPronounsMode: g.guildPronounsMode ?? "custom" as NickMode,
            voiceActivated: g.voiceActivated ?? false,
            nickVoiceEnabled: g.nickVoiceEnabled ?? g.enabled,
            pronounsVoiceEnabled: g.pronounsVoiceEnabled ?? g.guildPronounsEnabled,
        }));
        bioEntries   = stored.bioEntries   ?? [];
        pronounsList = stored.pronounsList ?? "";
        if (Array.isArray((stored as any).statusEntries)) {
            statusEntries = (stored as any).statusEntries;
        } else if (typeof (stored as any).statuses === "string") {
            statusEntries = parseLegacyStatuses((stored as any).statuses);
        }
        statusPresets = Array.isArray((stored as any).statusPresets) ? (stored as any).statusPresets : [];
        clanIds      = stored.clanIds      ?? [];
        statusSeqIdx = stored.statusSeqIdx ?? 0;
        clanSeqIdx   = stored.clanSeqIdx   ?? 0;
        bioSeqIdx    = stored.bioSeqIdx    ?? 0;
        prSeqIdx     = stored.prSeqIdx     ?? 0;
        statusLastVal = (stored as any).statusLastVal ?? null;
        clanLastVal   = (stored as any).clanLastVal   ?? null;
        bioLastVal    = (stored as any).bioLastVal    ?? null;
        prLastVal     = (stored as any).prLastVal     ?? null;
        globalNickEntries = (stored as any).globalNickEntries ?? [];
        globalNickSeqIdx  = (stored as any).globalNickSeqIdx  ?? 0;
        globalNickLastVal = (stored as any).globalNickLastVal ?? null;
        globalGuildPronouns = (stored as any).globalGuildPronouns ?? [];

        syncGuildsFromDiscord();
        await saveData();

        Vencord.Api.UserArea.addUserAreaButton("rotator-suite", () => <RSUserAreaButton />);

        if (settings.store.autoStart) {
            startAllRotators();
        }

        onCloseHandler = () => { applyCloseStatus(); applyCloseClan(); };
        window.addEventListener("beforeunload", onCloseHandler);
    },

    stop() {
        pluginActive = false;
        lastGlobalNickApply = 0;
        cachedToken = null; cachedGuildStore = null; cachedVoiceStateStore = null; cachedChannelStore = null;
        stopAllRotators();
        if (onCloseHandler) { window.removeEventListener("beforeunload", onCloseHandler); onCloseHandler = null; }
        Vencord.Api.UserArea.removeUserAreaButton("rotator-suite");
        document.getElementById("rs-css")?.remove();
    },
});
