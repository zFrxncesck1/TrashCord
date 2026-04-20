/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    Button,
    FluxDispatcher,
    Forms,
    GuildStore,
    React,
    Text,
    TextInput,
    Toasts,
    UserStore,
    showToast,
} from "@webpack/common";

interface Attachment { url: string; proxy_url?: string; }
interface Mention    { id: string; }
interface Message {
    id: string;
    channel_id: string;
    author: { id: string };
    content: string;
    attachments: Attachment[];
    mentions: Mention[];
    mention_everyone: boolean;
}
interface SearchHit { id: string; channel_id: string; author?: { id: string }; attachments?: Attachment[]; content?: string; }

const RestAPI              = findByPropsLazy("post", "del", "patch");
const SearchActions        = findByPropsLazy("searchMessages", "fetchMessages");
const PrivateChannelsStore = findByPropsLazy("getSortedPrivateChannels");

const DEF_BLACKLIST = "cdn.discordapp.com,u.to,steamcommunity.com";
const DEF_WHITELIST = "discord.com,discord.gg,media.discordapp.net,tenor.com,giphy.com,store.steampowered.com,google.com,youtube.com,spotify.com,open.spotify.com";

const settings = definePluginSettings({
    maxMessages: {
        type: OptionType.NUMBER,
        description: "Max suspicious messages in the time window before rate-limit trigger",
    tags: ["Chat", "Privacy", "Utility"],
    enabledByDefault: false,
        default: 10,
    },
    windowMs: {
        type: OptionType.NUMBER,
        description: "Rolling window size (ms) for rate-limit trigger",
        default: 8000,
    },
    minMentions: {
        type: OptionType.NUMBER,
        description: "Min @mentions (excluding self, including @everyone/@here) to flag as spam",
        default: 10,
    },
    requireMentions: {
        type: OptionType.BOOLEAN,
        description: "Skip messages with zero effective mentions — requires mention+attachment/link in the SAME message",
        default: true,
    },
    requireAttachmentsOrLinks: {
        type: OptionType.BOOLEAN,
        description: "Require image attachment OR blacklisted link in the same message as the mentions to flag",
        default: true,
    },
    channelCooldownHours: {
        type: OptionType.NUMBER,
        description: "Hours to ignore a channel after purge mode ends (0 = disabled)",
        default: 8,
    },
    autoDelete: {
        type: OptionType.BOOLEAN,
        description: "Auto-delete detected spam via API",
        default: true,
    },
    hideFromUI: {
        type: OptionType.BOOLEAN,
        description: "Instantly hide spam messages from the chat UI",
        default: true,
    },
    spamImageHashes: {
        type: OptionType.STRING,
        description: "Comma-separated CDN image hash fragments for purge — ⚠️ Discord changes hashes on re-upload",
        default: "b859ab74,2a97e2fb,10aa26b3,ea80b33a",
    },
    blacklistDomains: {
        type: OptionType.STRING,
        description: "Domains always treated as spam links (used in live detection + purge scan)",
        default: DEF_BLACKLIST,
    },
    whitelistDomains: {
        type: OptionType.STRING,
        description: "Domains never treated as spam links (whitelist overrides blacklist)",
        default: DEF_WHITELIST,
    },
    deleteCooldownMs: {
        type: OptionType.NUMBER,
        description: "Delay between bulk-delete API calls (ms) — raise on slow PCs",
        default: 1200,
    },
    maxPagesPerChannel: {
        type: OptionType.NUMBER,
        description: "Max pages (x100 msgs) per channel during purge — more = thorough but slower",
        default: 10,
    },
});

const tsRings      = new Map<string, Float64Array>();
const tsHeads      = new Map<string, number>();
const tsCounts     = new Map<string, number>();
let   ringHead     = 0;
let   ringCount    = 0;
let   cachedUid    = "";
const blocked      = new Set<string>();
const channelBuf   = new Map<string, string[]>();
const channelPurge = new Map<string, number>();
const channelCool  = new Map<string, number>();
const CHAN_BUF_MAX = 30;
const PURGE_WINDOW = 60_000;

function getUid(): string {
    if (!cachedUid) cachedUid = UserStore.getCurrentUser()?.id ?? "";
    return cachedUid;
}

function isPurging(cid: string): boolean {
    const t = channelPurge.get(cid);
    if (!t) return false;
    if (Date.now() < t) return true;
    channelPurge.delete(cid);
    return false;
}

function isCooled(cid: string): boolean {
    const t = channelCool.get(cid);
    if (!t) return false;
    if (Date.now() < t) return true;
    channelCool.delete(cid);
    return false;
}

function startPurge(cid: string): void {
    channelPurge.set(cid, Date.now() + PURGE_WINDOW);
    const h = settings.store.channelCooldownHours;
    if (h) channelCool.set(cid, Date.now() + PURGE_WINDOW + h * 3_600_000);
}

function bufferMsg(cid: string, id: string): void {
    let buf = channelBuf.get(cid);
    if (!buf) { buf = []; channelBuf.set(cid, buf); }
    buf.push(id);
    if (buf.length > CHAN_BUF_MAX) buf.shift();
}

function flushBuf(cid: string): string[] {
    const buf = channelBuf.get(cid) ?? [];
    channelBuf.delete(cid);
    return buf;
}

function pushTsChan(cid: string, now: number): void {
    if (!tsRings.has(cid)) {
        tsRings.set(cid, new Float64Array(64));
        tsHeads.set(cid, 0);
        tsCounts.set(cid, 0);
    }
    const ring = tsRings.get(cid)!;
    const head = tsHeads.get(cid)!;
    ring[head] = now;
    tsHeads.set(cid, (head + 1) & 63);
    tsCounts.set(cid, Math.min((tsCounts.get(cid) ?? 0) + 1, 64));
}

function countRecentChan(cid: string, now: number, windowMs: number): number {
    const ring  = tsRings.get(cid);
    const head  = tsHeads.get(cid) ?? 0;
    const count = tsCounts.get(cid) ?? 0;
    if (!ring) return 0;
    let n = 0;
    for (let i = 0; i < count; i++)
        if (now - ring[(head - 1 - i + 64) & 63] < windowMs) n++;
    return n;
}

function effectiveMentions(msg: Message): number {
    const uid   = getUid();
    const users = msg.mentions.filter(m => m.id !== uid).length;
    const broad = (msg.mention_everyone || /@everyone|@here/.test(msg.content)) ? 1 : 0;
    return users + broad;
}

function makeDomainRe(raw: string): RegExp {
    const parts = raw.split(",").map(s => s.trim().replace(/\./g, "\\.")).filter(Boolean);
    if (!parts.length) return /(?!)/;
    return new RegExp(`https?:\\/\\/[^\\s<>]*(?:${parts.join("|")})[^\\s<>]*`, "i");
}

let cachedBlRe: RegExp | null = null;
let cachedWlRe: RegExp | null = null;
let cachedBlStr = "";
let cachedWlStr = "";

function getBlRe(): RegExp {
    if (cachedBlStr !== settings.store.blacklistDomains) {
        cachedBlStr = settings.store.blacklistDomains;
        cachedBlRe  = makeDomainRe(cachedBlStr);
    }
    return cachedBlRe!;
}

function getWlRe(): RegExp {
    if (cachedWlStr !== settings.store.whitelistDomains) {
        cachedWlStr = settings.store.whitelistDomains;
        cachedWlRe  = makeDomainRe(cachedWlStr);
    }
    return cachedWlRe!;
}

function contentHasBlacklistedLink(content: string): boolean {
    if (!content) return false;
    const urls = content.match(/https?:\/\/[^\s<>]+/gi) ?? [];
    return urls.some(u => getBlRe().test(u) && !getWlRe().test(u));
}

function contentHasAnyNonWhitelistedLink(content: string): boolean {
    if (!content) return false;
    const urls = content.match(/https?:\/\/[^\s<>]+/gi) ?? [];
    return urls.some(u => !getWlRe().test(u));
}

function hasSuspiciousContent(msg: Message): boolean {
    return msg.attachments.length > 0 || contentHasAnyNonWhitelistedLink(msg.content);
}

function dispatchDelete(channelId: string, id: string): void {
    FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id });
}

async function deleteMessage(channelId: string, id: string): Promise<void> {
    try { await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` }); } catch { }
}

const idle: (cb: () => void) => void =
    typeof requestIdleCallback !== "undefined" ? requestIdleCallback : cb => setTimeout(cb, 0);

function blockIds(cid: string, ids: string[]): void {
    for (const id of ids) {
        blocked.add(id);
        if (settings.store.hideFromUI) dispatchDelete(cid, id);
    }
    if (settings.store.autoDelete)
        for (const id of ids) idle(() => deleteMessage(cid, id));
}

function onMessage({ message: msg }: { message: Message }): void {
    if (msg.author.id !== getUid()) return;

    // Blacklist exception: always block immediately, no settings respected
    if (contentHasBlacklistedLink(msg.content)) {
        blockIds(msg.channel_id, [msg.id]);
        showToast("⚠️ AntiHackSpam: blacklisted link removed!", Toasts.Type.FAILURE);
        return;
    }

    // Purge mode: block anything suspicious in this channel for PURGE_WINDOW ms
    if (isPurging(msg.channel_id)) {
        if (hasSuspiciousContent(msg)) {
            blockIds(msg.channel_id, [msg.id]);
            showToast("⚠️ AntiHackSpam: purge mode active — message removed!", Toasts.Type.FAILURE);
        }
        return;
    }

    if (isCooled(msg.channel_id)) return;

    const eff     = effectiveMentions(msg);
    const hasLink = contentHasAnyNonWhitelistedLink(msg.content);
    const hasFile = msg.attachments.length > 0;
    const hasSus  = hasLink || hasFile;

    if (settings.store.requireMentions && eff === 0) return;
    if (settings.store.requireAttachmentsOrLinks && !hasSus) return;

    bufferMsg(msg.channel_id, msg.id);
    const now = Date.now();
    pushTsChan(msg.channel_id, now);

    const meetsThreshold = eff >= settings.store.minMentions &&
        (!settings.store.requireAttachmentsOrLinks || hasSus);

    const meetsRateLimit = countRecentChan(msg.channel_id, now, settings.store.windowMs) >= settings.store.maxMessages;

    if (meetsThreshold || meetsRateLimit) {
        const toDelete = flushBuf(msg.channel_id);
        if (!toDelete.includes(msg.id)) toDelete.push(msg.id);
        blockIds(msg.channel_id, toDelete);
        startPurge(msg.channel_id);
        showToast(`⚠️ AntiHackSpam: ${toDelete.length} spam message(s) blocked!`, Toasts.Type.FAILURE);
    }
}

function getSpamHashes(raw: string): Set<string> {
    return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}

function urlHit(url: string, hashes: Set<string>): boolean {
    for (const h of hashes) if (url.includes(h)) return true;
    return false;
}

function hasSpamAttachment(msg: SearchHit, hashes: Set<string>): boolean {
    return (msg.attachments ?? []).some(a => urlHit(a.url, hashes) || urlHit(a.proxy_url ?? "", hashes));
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
let abortPurge    = false;
let purgeRunning  = false;
let purgeDeleted  = 0;
let purgeStatus   = "Ready.";
let purgeListeners: Array<(status: string, deleted: number, done: boolean) => void> = [];

function notifyListeners(status: string, deleted: number, done: boolean): void {
    purgeStatus  = status;
    purgeDeleted = deleted;
    for (const fn of purgeListeners) fn(status, deleted, done);
}

async function purgeSpamMessages(
    hashesRaw: string,
    blacklistRaw: string,
    whitelistRaw: string,
    scanDMs: boolean,
    scanGuilds: boolean,
): Promise<void> {
    if (purgeRunning) return;
    abortPurge   = false;
    purgeRunning = true;
    purgeDeleted = 0;

    const uid    = getUid();
    const hashes = getSpamHashes(hashesRaw);
    const delay  = settings.store.deleteCooldownMs;
    const maxP   = settings.store.maxPagesPerChannel;
    const blRe   = makeDomainRe(blacklistRaw);
    const wlRe   = makeDomainRe(whitelistRaw);

    function hitsBl(content: string): boolean {
        const urls = (content ?? "").match(/https?:\/\/[^\s<>]+/gi) ?? [];
        return urls.some(u => blRe.test(u) && !wlRe.test(u));
    }

    if (!uid) {
        purgeRunning = false;
        notifyListeners("❌ Not logged in", 0, true);
        return;
    }

    let deleted = 0, errors = 0;
    const channelIds = new Set<string>();

    if (scanDMs) {
        try {
            for (const c of (PrivateChannelsStore.getSortedPrivateChannels() ?? []) as { id: string }[])
                channelIds.add(c.id);
        } catch { }
    }

    if (scanGuilds) {
        try {
            for (const g of Object.values(GuildStore.getGuilds()) as { id: string }[]) {
                if (abortPurge) break;
                try {
                    const res = await SearchActions.searchMessages({ guildId: g.id, authorId: uid, limit: 25 });
                    for (const m of (res?.messages?.flat() ?? []) as SearchHit[])
                        channelIds.add(m.channel_id);
                } catch { }
                await sleep(300);
            }
        } catch { }
    }

    notifyListeners(`🔍 Scanning ${channelIds.size} channels…`, 0, false);

    for (const cid of channelIds) {
        if (abortPurge) break;
        try {
            let before: string | undefined;
            for (let page = 0; page < maxP; page++) {
                if (abortPurge) break;
                const q: Record<string, string> = { limit: "100" };
                if (before) q.before = before;

                const res  = await RestAPI.get({ url: `/channels/${cid}/messages`, query: q });
                const msgs = (res?.body ?? []) as SearchHit[];
                if (!msgs.length) break;
                before = msgs[msgs.length - 1].id;

                for (const m of msgs) {
                    if (abortPurge) break;
                    if (m.author?.id !== uid) continue;
                    if (!hasSpamAttachment(m, hashes) && !hitsBl(m.content ?? "")) continue;
                    deleted++;
                    notifyListeners(`🗑️ Deleting message ${deleted}…`, deleted, false);
                    await deleteMessage(m.channel_id, m.id);
                    dispatchDelete(m.channel_id, m.id);
                    await sleep(delay);
                }

                if (msgs.length < 100) break;
                await sleep(200);
            }
        } catch { errors++; }
    }

    purgeRunning = false;
    const finalMsg = abortPurge
        ? `🛑 Stopped — ${deleted} deleted.`
        : `✅ Finished — ${deleted} deleted, ${errors} error(s).`;

    notifyListeners(finalMsg, deleted, true);
    showToast(finalMsg, abortPurge ? Toasts.Type.MESSAGE : Toasts.Type.SUCCESS);
}

function Toggle({ checked, onChange, disabled }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}): JSX.Element {
    return (
        <div
            onClick={() => !disabled && onChange(!checked)}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                userSelect: "none",
            }}
        >
            <div style={{
                width: 40,
                height: 22,
                borderRadius: 11,
                background: checked ? "var(--brand-experiment, #5865f2)" : "var(--background-modifier-accent, #4f545c)",
                position: "relative",
                flexShrink: 0,
                transition: "background 150ms",
            }}>
                <div style={{
                    position: "absolute",
                    top: 3,
                    left: checked ? 21 : 3,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left 150ms",
                }} />
            </div>
            <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: checked ? "var(--brand-experiment, #5865f2)" : "var(--text-normal, #dcddde)",
                minWidth: 28,
            }}>
                {checked ? "ON" : "OFF"}
            </span>
        </div>
    );
}

function PurgeModal({ modalProps }: { modalProps: any; }): JSX.Element {
    const [status,    setStatus]    = React.useState<string>(purgeStatus);
    const [running,   setRunning]   = React.useState(purgeRunning);
    const [done,      setDone]      = React.useState(false);
    const [deleted,   setDeleted]   = React.useState(purgeDeleted);
    const [scanDMs,   setScanDMs]   = React.useState(true);
    const [scanG,     setScanG]     = React.useState(true);
    const [hashes,    setHashes]    = React.useState(settings.store.spamImageHashes);
    const [blacklist, setBlacklist] = React.useState(settings.store.blacklistDomains);
    const [whitelist, setWhitelist] = React.useState(settings.store.whitelistDomains);

    React.useEffect(() => {
        const listener = (s: string, d: number, isDone: boolean) => {
            setStatus(s);
            setDeleted(d);
            setRunning(!isDone);
            if (isDone) setDone(true);
        };
        purgeListeners.push(listener);
        return () => { purgeListeners = purgeListeners.filter(f => f !== listener); };
    }, []);

    function start() {
        if (purgeRunning) return;
        setDone(false);
        setDeleted(0);
        setStatus("Starting…");
        setRunning(true);
        purgeSpamMessages(hashes, blacklist, whitelist, scanDMs, scanG);
    }

    function stop() {
        abortPurge = true;
    }

    const row = (label: string, checked: boolean, set: (v: boolean) => void) => (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ color: "var(--text-normal, #dcddde)", fontSize: 14 }}>{label}</span>
            <Toggle checked={checked} onChange={set} disabled={running} />
        </div>
    );

    const statusColor  = done ? "#3ba55d" : running ? "#00b0f4" : "var(--text-normal, #dcddde)";
    const statusBorder = done ? "1px solid #3ba55d" : running ? "1px solid #00b0f4" : "1px solid var(--background-modifier-accent, #4f545c)";

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader separator>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1, color: "var(--header-primary, #fff)" }}>
                    🧹 Purge Hack Spam Messages
                </Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent style={{ padding: "16px 16px 8px", overflowX: "hidden" }}>
                <Forms.FormSection>
                    <Forms.FormTitle style={{ color: "var(--header-secondary, #b9bbbe)" }}>Image Hashes</Forms.FormTitle>
                    <Forms.FormText style={{ marginBottom: 6, color: "var(--text-normal, #dcddde)" }}>
                        Comma-separated hash fragments matched against CDN attachments.
                        ⚠️ Discord changes hashes on re-upload — older messages may not match.
                    </Forms.FormText>
                    <TextInput value={hashes} onChange={setHashes} placeholder="b859ab74,2a97e2fb,…" disabled={running} />
                </Forms.FormSection>

                <Forms.FormDivider style={{ margin: "12px 0" }} />

                <Forms.FormSection>
                    <Forms.FormTitle style={{ color: "var(--header-secondary, #b9bbbe)" }}>Blacklisted Domains</Forms.FormTitle>
                    <Forms.FormText style={{ marginBottom: 6, color: "var(--text-normal, #dcddde)" }}>
                        Links from these domains are flagged as spam during live detection and deleted in purge scans.
                        ⚙️ More settings enabled = better detection accuracy.
                    </Forms.FormText>
                    <TextInput value={blacklist} onChange={setBlacklist} placeholder="cdn.discordapp.com,u.to,…" disabled={running} />
                </Forms.FormSection>

                <Forms.FormDivider style={{ margin: "12px 0" }} />

                <Forms.FormSection>
                    <Forms.FormTitle style={{ color: "var(--header-secondary, #b9bbbe)" }}>Whitelisted Domains</Forms.FormTitle>
                    <Forms.FormText style={{ marginBottom: 6, color: "var(--text-normal, #dcddde)" }}>
                        These domains are never treated as spam — whitelist always overrides blacklist.
                    </Forms.FormText>
                    <TextInput value={whitelist} onChange={setWhitelist} placeholder="discord.com,tenor.com,…" disabled={running} />
                </Forms.FormSection>

                <Forms.FormDivider style={{ margin: "12px 0" }} />

                <Forms.FormSection>
                    <Forms.FormTitle style={{ color: "var(--header-secondary, #b9bbbe)" }}>Scan Targets</Forms.FormTitle>
                    {row("Scan DMs", scanDMs, setScanDMs)}
                    {row("Scan Servers", scanG, setScanG)}
                </Forms.FormSection>

                <Forms.FormDivider style={{ margin: "12px 0" }} />

                <Forms.FormSection>
                    <Forms.FormTitle style={{ color: "var(--header-secondary, #b9bbbe)" }}>Status</Forms.FormTitle>
                    <div style={{
                        background: "var(--background-secondary-alt, #292b2f)",
                        borderRadius: 6,
                        padding: "10px 14px",
                        fontFamily: "var(--font-code, monospace)",
                        fontSize: 13,
                        fontWeight: done ? 600 : 400,
                        color: statusColor,
                        minHeight: 38,
                        border: statusBorder,
                    }}>
                        {status}
                    </div>
                    {(running || done) && (
                        <span style={{ display: "block", marginTop: 6, fontSize: 13, fontWeight: 600, color: "#3ba55d" }}>
                            Messages deleted: {deleted}
                        </span>
                    )}
                </Forms.FormSection>
            </ModalContent>

            <ModalFooter style={{ display: "flex", gap: 8 }}>
                {running
                    ? <Button color={Button.Colors.RED} onClick={stop}>🛑 Stop</Button>
                    : <Button
                        color={done ? Button.Colors.GREEN : Button.Colors.BRAND}
                        onClick={start}
                        disabled={!hashes.trim() && !blacklist.trim()}
                      >
                        {done ? "✓ Done — Run Again" : "🗑️ Start Purge"}
                      </Button>
                }
                <Button color={Button.Colors.TRANSPARENT} look={Button.Looks.LINK} onClick={modalProps.onClose}>
                    {running ? "Close (scan continues in background)" : "Close"}
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "AntiHackSpam",
    description: "Blocks & deletes spam from hacked account (image floods + mass mentions). Includes bulk-purge tool.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,

    settingsAboutComponent() {
        return (
            <div style={{ marginTop: 8 }}>
                <Forms.FormText style={{ marginBottom: 10, color: "var(--text-normal, #dcddde)" }}>
                    ⚙️ Detection accuracy improves when <b>Require Mentions</b> and <b>Require Attachments or Links</b>
                    are both enabled — spam is only flagged when mentions + image/blacklisted link appear in the <b>same message</b>.
                    Messages with mentions alone (no image or blacklisted link) will never be flagged.
                </Forms.FormText>
                <Button
                    color={Button.Colors.BRAND}
                    onClick={() => openModal(props => <PurgeModal modalProps={props} />)}
                >
                    🧹 Open Purge Tool
                </Button>
            </div>
        );
    },

    patches: [
        {
            find: "renderSingleMessage",
            replacement: {
                match: /(\i\.renderSingleMessage\((\i)\))/,
                replace: "$self.shouldRender($2) ? $1 : null",
            },
        },
    ],

    toolboxActions: {
        "Purge Hack Spam"() {
            openModal(props => <PurgeModal modalProps={props} />);
        },
    },

    shouldRender(msg: Message): boolean {
        if (!msg?.id) return true;
        if (msg.author?.id !== getUid()) return true;
        return !blocked.has(msg.id);
    },

    start() {
        cachedUid = "";
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
        tsRings.clear();
        tsHeads.clear();
        tsCounts.clear();
        ringHead = ringCount = 0;
        cachedUid = "";
        blocked.clear();
        channelBuf.clear();
        channelPurge.clear();
        channelCool.clear();
        abortPurge = true;
        purgeRunning = false;
        purgeListeners = [];
        cachedBlRe = cachedWlRe = null;
        cachedBlStr = cachedWlStr = "";
    },
});