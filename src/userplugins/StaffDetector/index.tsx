/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import {
    ChannelStore,
    FluxDispatcher,
    GuildMemberStore,
    GuildStore,
    PermissionsBits,
    React,
    Toasts,
    UserStore,
    VoiceStateStore,
} from "@webpack/common";

const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const GuildRoleStore = findStoreLazy("GuildRoleStore");
const PermCalc = findByPropsLazy("computePermissions", "canEveryoneRole");

const logger = new Logger("StaffDetector");
const currentChannelStaff = new Set<string>();

interface PendingCheck {
    guildId: string;
    channelId: string;
    isAlready: boolean;
}
const pendingChecks = new Map<string, PendingCheck>();
const fetchedMembers = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_SOUND_URLS = {
    join: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/join.wav",
    leave: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/leave.wav",
};

const CUSTOM_DEFAULT_URLS = {
    join: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/trollface-smile.mp3",
    leave: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/death-note-light-yagami-is-sus.mp3",
};

const C = {
    notif: "#ef5350",
    sounds: "#42a5f5",
    server: "#66bb6a",
    user: "#ffa726",
    perms: "#ab47bc",
};

function SettingsSep({ title, color = "#9c67ff" }: { title: string; color?: string }) {
    return (
        <div style={{ margin: "14px 0 2px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color, whiteSpace: "nowrap" }}>{title}</span>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
        </div>
    );
}

function AudioUploadButton({ label, dataKey }: { label: string; dataKey: "customJoinSoundData" | "customLeaveSoundData"; }) {
    const [filename, setFilename] = React.useState<string>(() => {
        const d = settings.store[dataKey];
        return d ? (settings.store[dataKey + "Name" as "customJoinSoundDataName" | "customLeaveSoundDataName"] || "Uploaded") : "";
    });

    function handleClick() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                (settings.store as any)[dataKey] = reader.result as string;
                (settings.store as any)[dataKey + "Name"] = file.name;
                setFilename(file.name);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }

    function handleClear() {
        (settings.store as any)[dataKey] = "";
        (settings.store as any)[dataKey + "Name"] = "";
        setFilename("");
    }

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <button
                onClick={handleClick}
                style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.sounds}66`, background: `${C.sounds}18`, color: C.sounds, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
                {label}
            </button>
            {filename
                ? <>
                    <span style={{ fontSize: 11, color: "#9e9e9e", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filename}</span>
                    <button onClick={handleClear} style={{ background: "none", border: "none", color: "#757575", cursor: "pointer", fontSize: 13, padding: "0 4px", lineHeight: 1 }}>✕</button>
                </>
                : <span style={{ fontSize: 11, color: "#5a4a6a" }}>No file uploaded</span>
            }
        </div>
    );
}

const settings = definePluginSettings({
    notifHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Notifications" color={C.notif} />,
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "In-app toast alert on staff join/leave.",
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "OS-level desktop notification on staff event.",
    },
    notifyAlreadyInVc: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Alert + play join sound when staff are already present on VC join.",
    },
    enableLogs: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Print StaffDetector events to the DevTools console (Ctrl+Shift+I).",
    },

    soundsHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Sounds" color={C.sounds} />,
    },
    enableSounds: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Play audio alert on staff join/leave.",
    },
    useCustomSounds: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "OFF - built-in WAV. ON - use uploaded file or URL below (uploaded file takes priority over URL).",
    },
    customJoinSoundData: { type: OptionType.STRING, default: "", description: "", hidden: true },
    customJoinSoundDataName: { type: OptionType.STRING, default: "", description: "", hidden: true },
    customJoinSound: {
        type: OptionType.STRING,
        default: "",
        description: "JOIN fallback URL (https://...) - used only if no file is uploaded above. Empty = built-in custom MP3.",
    },
    customJoinUpload: {
        type: OptionType.COMPONENT,
        description: "Upload JOIN sound (replaces previous upload).",
        component: () => <AudioUploadButton label="Upload JOIN Sound" dataKey="customJoinSoundData" />,
    },
    customLeaveSoundData: { type: OptionType.STRING, default: "", description: "", hidden: true },
    customLeaveSoundDataName: { type: OptionType.STRING, default: "", description: "", hidden: true },
    customLeaveSound: {
        type: OptionType.STRING,
        default: "",
        description: "LEAVE fallback URL (https://...) - used only if no file is uploaded above. Empty = built-in custom MP3.",
    },
    customLeaveUpload: {
        type: OptionType.COMPONENT,
        description: "Upload LEAVE sound (replaces previous upload).",
        component: () => <AudioUploadButton label="Upload LEAVE Sound" dataKey="customLeaveSoundData" />,
    },

    serverHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Server Filter" color={C.server} />,
    },
    serverFilterMode: {
        type: OptionType.SELECT,
        options: [
            { label: "All servers", value: "none", default: true },
            { label: "Include only listed servers", value: "include" },
            { label: "Exclude listed servers", value: "exclude" },
        ],
        description: "Which servers trigger StaffDetector alerts.",
    },
    serverIncludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Allowlist - alert ONLY in these guild IDs. Accepts one or more IDs separated by comma, space, or dash.",
    },
    serverExcludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Blocklist - never alert in these guild IDs. Overridden by User Include list. Accepts one or more IDs separated by comma, space, or dash.",
    },

    userHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="User Filter" color={C.user} />,
    },
    userIncludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Track ONLY these user IDs (empty = all with matching perms). Overrides server filter. Accepts one or more IDs separated by comma, space, or dash.",
    },
    userExcludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Ignore these user IDs regardless of permissions. Accepts one or more IDs separated by comma, space, or dash.",
    },

    permsHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Detected Permissions" color={C.perms} />,
    },
    adminPermission: { type: OptionType.BOOLEAN, default: true, description: "Administrator" },
    manageGuildPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Server" },
    manageChannelsPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Channels" },
    manageRolesPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Roles" },
    manageNicknamesPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Nicknames" },
    manageMessagesPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Messages" },
    kickMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Kick Members" },
    banMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Ban Members" },
    moderateMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Timeout / Moderate Members" },
    moveMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Move Members" },
    muteMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Mute Members" },
    deafenMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Deafen Members" },
});

function parseIds(raw: string): string[] {
    if (!raw) return [];
    const out: string[] = [];
    const parts = raw.split(/[\s,;|]+/);
    for (let i = 0; i < parts.length; i++) {
        const s = parts[i].replace(/^-+|-+$/g, "").trim();
        if (/^\d{5,}$/.test(s)) out.push(s);
    }
    return out;
}

function isUserExplicitlyIncluded(userId: string): boolean {
    const inc = parseIds(settings.store.userIncludeIds);
    return inc.length > 0 && inc.includes(userId);
}

function isServerAllowedForUser(guildId: string, userId: string): boolean {
    if (isUserExplicitlyIncluded(userId)) return true;
    const mode = settings.store.serverFilterMode;
    if (mode === "none") return true;
    if (mode === "include") {
        const inc = parseIds(settings.store.serverIncludeIds);
        return !inc.length || inc.includes(guildId);
    }
    if (mode === "exclude") {
        const exc = parseIds(settings.store.serverExcludeIds);
        return !exc.length || !exc.includes(guildId);
    }
    return true;
}

function isUserTracked(userId: string): boolean {
    const user = UserStore.getUser(userId);
    if (user?.bot) return false;
    const inc = parseIds(settings.store.userIncludeIds);
    if (inc.length && !inc.includes(userId)) return false;
    const exc = parseIds(settings.store.userExcludeIds);
    return !exc.length || !exc.includes(userId);
}

const PERM_CHECKS: Array<[keyof typeof settings.store, bigint]> = [
    ["adminPermission", PermissionsBits.ADMINISTRATOR],
    ["manageGuildPermission", PermissionsBits.MANAGE_GUILD],
    ["manageChannelsPermission", PermissionsBits.MANAGE_CHANNELS],
    ["manageRolesPermission", PermissionsBits.MANAGE_ROLES],
    ["manageNicknamesPermission", PermissionsBits.MANAGE_NICKNAMES],
    ["manageMessagesPermission", PermissionsBits.MANAGE_MESSAGES],
    ["kickMembersPermission", PermissionsBits.KICK_MEMBERS],
    ["banMembersPermission", PermissionsBits.BAN_MEMBERS],
    ["moderateMembersPermission", PermissionsBits.MODERATE_MEMBERS],
    ["moveMembersPermission", PermissionsBits.MOVE_MEMBERS],
    ["muteMembersPermission", PermissionsBits.MUTE_MEMBERS],
    ["deafenMembersPermission", PermissionsBits.DEAFEN_MEMBERS],
];

function safeRolePerms(role: any): bigint {
    if (!role) return 0n;
    const p = role.permissions_new ?? role.permissions;
    if (p == null) return 0n;
    try { return typeof p === "bigint" ? p : BigInt(p); } catch { return 0n; }
}

function getRolesMap(guildId: string): Record<string, any> {
    try {
        const snap = GuildRoleStore.getRolesSnapshot?.(guildId);
        if (snap && typeof snap === "object" && !Array.isArray(snap)) return snap;
    } catch { }
    try {
        const byId = GuildRoleStore.getRoles?.(guildId);
        if (byId && typeof byId === "object" && !Array.isArray(byId)) return byId;
    } catch { }
    return GuildStore.getGuild(guildId)?.roles ?? {};
}

function computeMemberPerms(guildId: string, userId: string, memberRoles: string[]): bigint {
    try {
        const result = PermCalc?.computePermissions?.({ userId, guildId });
        if (typeof result === "bigint") return result;
    } catch { }

    const rolesMap = getRolesMap(guildId);
    let perms = safeRolePerms(rolesMap[guildId]);

    for (let i = 0; i < memberRoles.length; i++) {
        perms |= safeRolePerms(rolesMap[memberRoles[i]]);
    }

    return perms;
}

function isUserStaff(userId: string, guildId: string): boolean {
    const guild = GuildStore.getGuild(guildId);
    if (!guild) return false;
    if (guild.ownerId === userId) return true;

    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member) return false;

    const perms = computeMemberPerms(guildId, userId, member.roles ?? []);
    if ((perms & PermissionsBits.ADMINISTRATOR) !== 0n) return true;

    for (let i = 0; i < PERM_CHECKS.length; i++) {
        const [key, perm] = PERM_CHECKS[i];
        if (settings.store[key] && (perms & perm) !== 0n) return true;
    }

    return false;
}

function requestMemberIfNeeded(guildId: string, userId: string): boolean {
    const guild = GuildStore.getGuild(guildId);
    if (guild?.ownerId === userId) return true;

    const member = GuildMemberStore.getMember(guildId, userId);
    if (member != null && Array.isArray(member.roles) && member.roles.length > 0) return true;

    const key = `${guildId}:${userId}`;
    if (!fetchedMembers.has(key)) {
        fetchedMembers.add(key);
        FluxDispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], userIds: [userId] });
    }
    return false;
}

function getUsername(userId: string): string {
    return UserStore.getUser(userId)?.username ?? userId;
}

function getAvatarUrl(userId: string): string {
    const user = UserStore.getUser(userId);
    if (!user?.avatar) return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) % 5n)}.png`;
    return `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=128`;
}

function getChannelContext(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "";
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    if (channel.name && guild?.name) return `#${channel.name} - ${guild.name}`;
    return channel.name ? `#${channel.name}` : "";
}

function notify(title: string, body: string, icon?: string): void {
    if (settings.store.showToasts)
        Toasts.show({ message: `${title}  ${body}`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
    if (settings.store.showNotifications)
        showNotification({ title, body, icon, permanent: false, onClick: () => { } });
}

function playSrc(src: string): void {
    const audio = new Audio(src);
    audio.volume = 1;
    audio.play().catch(e => { if (settings.store.enableLogs) logger.error("StaffDetector: playSrc error:", e); });
}

function playStaffSound(isJoin: boolean): void {
    if (!settings.store.enableSounds) return;
    if (settings.store.useCustomSounds) {
        const data = isJoin ? settings.store.customJoinSoundData : settings.store.customLeaveSoundData;
        if (data) { playSrc(data); return; }
        const url = (isJoin ? settings.store.customJoinSound : settings.store.customLeaveSound)?.trim();
        if (url) { playSrc(url); return; }
        playSrc(isJoin ? CUSTOM_DEFAULT_URLS.join : CUSTOM_DEFAULT_URLS.leave);
        return;
    }
    playSrc(isJoin ? DEFAULT_SOUND_URLS.join : DEFAULT_SOUND_URLS.leave);
}

function notifyAlreadyStaff(staffIds: string[], channelId: string): void {
    if (!settings.store.notifyAlreadyInVc || !staffIds.length) return;
    const ctx = getChannelContext(channelId);
    playStaffSound(true);
    if (staffIds.length === 1) {
        const name = getUsername(staffIds[0]);
        if (settings.store.enableLogs) logger.info(`StaffDetector: "${name}" already in VC - ${ctx}`);
        notify("⚠️ StaffDetector:", `"${name}" already here - ${ctx}`, getAvatarUrl(staffIds[0]));
    } else {
        const names = staffIds.map(id => `"${getUsername(id)}"`).join(", ");
        if (settings.store.enableLogs) logger.info(`StaffDetector: ${staffIds.length} staff already in VC - ${ctx}`);
        notify("⚠️ StaffDetector:", `${staffIds.length} staff: ${names} - ${ctx}`, getAvatarUrl(staffIds[0]));
    }
}

function scanChannelStaff(channelId: string): void {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return;

    const myUserId = UserStore.getCurrentUser()?.id;
    if (!myUserId) return;

    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId);
    if (!voiceStates) return;

    const guildId = channel.guild_id;
    currentChannelStaff.clear();
    pendingChecks.clear();

    const staffFound: string[] = [];
    const userIds = Object.keys(voiceStates);

    for (let i = 0; i < userIds.length; i++) {
        const uid = userIds[i];
        if (uid === myUserId) continue;
        if (!isServerAllowedForUser(guildId, uid) || !isUserTracked(uid)) continue;

        if (requestMemberIfNeeded(guildId, uid)) {
            if (isUserStaff(uid, guildId)) {
                currentChannelStaff.add(uid);
                staffFound.push(uid);
            }
        } else {
            pendingChecks.set(uid, { guildId, channelId, isAlready: true });
        }
    }

    if (staffFound.length) notifyAlreadyStaff(staffFound, channelId);

    if (pendingChecks.size > 0) {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
            retryTimer = null;
            const currentChannelId: string | null = SelectedChannelStore.getVoiceChannelId?.() ?? null;
            if (currentChannelId !== channelId) return;

            const lateFound: string[] = [];
            for (const [uid, pending] of pendingChecks) {
                if (!pending.isAlready) continue;
                const member = GuildMemberStore.getMember(pending.guildId, uid);
                if (!member) continue;
                pendingChecks.delete(uid);
                if (isUserStaff(uid, pending.guildId) && !currentChannelStaff.has(uid)) {
                    currentChannelStaff.add(uid);
                    lateFound.push(uid);
                }
            }
            if (lateFound.length) notifyAlreadyStaff(lateFound, channelId);
        }, 3500);
    }
}

function processPendingMember(userId: string, guildId: string): void {
    const pending = pendingChecks.get(userId);
    if (!pending || pending.guildId !== guildId) return;
    pendingChecks.delete(userId);

    if (!isServerAllowedForUser(guildId, userId) || !isUserTracked(userId) || !isUserStaff(userId, guildId)) return;

    const currentChannelId: string | null = SelectedChannelStore.getVoiceChannelId?.() ?? null;
    if (!currentChannelId || currentChannelId !== pending.channelId) return;

    if (currentChannelStaff.has(userId)) return;
    currentChannelStaff.add(userId);

    if (pending.isAlready) {
        notifyAlreadyStaff([userId], pending.channelId);
    } else {
        const name = getUsername(userId);
        const ctx = getChannelContext(pending.channelId);
        if (settings.store.enableLogs) logger.info(`StaffDetector: "${name}" joined - ${ctx}`);
        playStaffSound(true);
        notify("🚨 StaffDetector:", `"${name}" joined - ${ctx}`, getAvatarUrl(userId));
    }
}

export default definePlugin({
    name: "StaffDetector",
    description: "Alerts (toast/notification + sound) when staff join or leave your VC.",
    authors: [
        { name: "Irritably", id: 928787166916640838n },
        { name: "zFrxncesck1", id: 456195985404592149n },
    ],
    settings,

    start() {
        const vcId: string | null = SelectedChannelStore.getVoiceChannelId?.() ?? null;
        if (vcId) scanChannelStaff(vcId);
    },

    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
            currentChannelStaff.clear();
            pendingChecks.clear();
            if (!channelId) return;
            const channel = ChannelStore.getChannel(channelId);
            if (!channel?.guild_id) return;
            if (settings.store.enableLogs) logger.debug(`StaffDetector: joined VC ${channelId}`);
            scanChannelStaff(channelId);
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: Array<{ userId: string; channelId?: string; oldChannelId?: string; }>; }) {
            const currentChannelId: string | null = SelectedChannelStore.getVoiceChannelId?.() ?? null;
            if (!currentChannelId) return;

            const channel = ChannelStore.getChannel(currentChannelId);
            if (!channel?.guild_id) return;

            const myUserId = UserStore.getCurrentUser()?.id;
            if (!myUserId) return;

            for (let i = 0; i < voiceStates.length; i++) {
                const { userId, channelId, oldChannelId } = voiceStates[i];
                if (userId === myUserId) continue;
                if (!isServerAllowedForUser(channel.guild_id, userId)) continue;

                const entered = channelId === currentChannelId && oldChannelId !== currentChannelId;

                if (entered) {
                    if (!isUserTracked(userId)) continue;
                    if (requestMemberIfNeeded(channel.guild_id, userId)) {
                        if (!isUserStaff(userId, channel.guild_id)) continue;
                        currentChannelStaff.add(userId);
                        const name = getUsername(userId);
                        const ctx = getChannelContext(currentChannelId);
                        if (settings.store.enableLogs) logger.info(`StaffDetector: "${name}" joined - ${ctx}`);
                        playStaffSound(true);
                        notify("🚨 StaffDetector:", `"${name}" joined - ${ctx}`, getAvatarUrl(userId));
                    } else {
                        pendingChecks.set(userId, { guildId: channel.guild_id, channelId: currentChannelId, isAlready: false });
                    }
                    continue;
                }

                const left = oldChannelId === currentChannelId && channelId !== currentChannelId;
                if (left) {
                    pendingChecks.delete(userId);
                    if (currentChannelStaff.has(userId)) {
                        currentChannelStaff.delete(userId);
                        const name = getUsername(userId);
                        const ctx = getChannelContext(currentChannelId);
                        const remaining = currentChannelStaff.size;
                        const suffix = remaining > 0 ? ` - ${remaining} staff remaining` : " - No staff remaining";
                        if (settings.store.enableLogs) logger.info(`StaffDetector: "${name}" left - ${ctx} (${remaining} remaining)`);
                        playStaffSound(false);
                        notify("✅ StaffDetector:", `"${name}" left - ${ctx}${suffix}`, getAvatarUrl(userId));
                    }
                }
            }
        },

        GUILD_MEMBERS_CHUNK({ guildId, members }: { guildId: string; members: Array<{ user: { id: string; }; }>; }) {
            if (!members?.length) return;
            for (let i = 0; i < members.length; i++) {
                const uid = members[i]?.user?.id;
                if (uid) processPendingMember(uid, guildId);
            }
        },

        GUILD_MEMBER_UPDATE({ guildId, user }: { guildId: string; user: { id: string; }; }) {
            if (user?.id) processPendingMember(user.id, guildId);
        },
    },

    stop() {
        if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
        currentChannelStaff.clear();
        pendingChecks.clear();
        fetchedMembers.clear();
    },
});
