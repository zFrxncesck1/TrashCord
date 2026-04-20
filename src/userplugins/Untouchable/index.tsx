/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { HeadingSecondary } from "@components/Heading";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    Constants,
    Menu,
    PermissionsBits,
    PermissionStore,
    RestAPI,
    SelectedChannelStore,
    Toasts,
    UserStore,
} from "@webpack/common";

const ChannelActionsRaw: { selectVoiceChannel: (channelId: string) => void } =
    findByPropsLazy("selectVoiceChannel", "disconnect");

const VoiceActions = findByPropsLazy("toggleSelfMute");

let originalSelectVoiceChannel: ((channelId: string) => void) | null = null;
let calledByPlugin = false;

function patchedSelectVoiceChannel(channelId: string) {
    calledByPlugin = false;
    originalSelectVoiceChannel!(channelId);
}

function internalSelectVoiceChannel(channelId: string) {
    calledByPlugin = true;
    ChannelActionsRaw.selectVoiceChannel(channelId);
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    guildId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
    selfVideo: boolean;
    sessionId: string;
    suppress: boolean;
    requestToSpeakTimestamp: string | null;
}

let myUserId: string | null = null;
let manualDisconnect = false;
let retryCount = 0;
let rejoinTimeout: ReturnType<typeof setTimeout> | null = null;
let isRejoining = false;

function SectionSeparator(title: string) {
    return (
        <>
            <hr style={{ width: "100%" }} />
            <HeadingSecondary>{title}</HeadingSecondary>
            <hr style={{ width: "100%" }} />
        </>
    );
}

const settings = definePluginSettings({
    antiDisconnectHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("AntiDisconnect"),
    },
    antiDisconnect: {
        type: OptionType.BOOLEAN,
        description: "Automatically rejoin the voice channel if you get disconnected by someone else.",
        default: false,
    },
    rejoinDelay: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds before attempting to rejoin (0 = instant).",
        default: 250,
    },
    maxRetries: {
        type: OptionType.NUMBER,
        description: "Maximum number of rejoin attempts before giving up (0 = unlimited).",
        default: 0,
    },
    ignoreManualDisconnect: {
        type: OptionType.BOOLEAN,
        description: "Do not rejoin if you manually clicked Disconnect yourself.",
        default: true,
    },
    antiMoveHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("AntiMove"),
    },
    antiMove: {
        type: OptionType.BOOLEAN,
        description: "Prevent others from moving you to a different voice channel.",
        default: false,
    },
    antiMuteDeafenServerHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("Anti Mute & Deafen Server"),
    },
    antiMuteServer: {
        type: OptionType.BOOLEAN,
        description: "Automatically unmute yourself if server-muted by someone else (requires MUTE_MEMBERS permission).",
        default: false,
    },
    antiDeafenServer: {
        type: OptionType.BOOLEAN,
        description: "Automatically undeafen yourself if server-deafened by someone else (requires DEAFEN_MEMBERS permission).",
        default: false,
    },
    notificationsHeader: {
        type: OptionType.COMPONENT,
        component: () => SectionSeparator("Notifications"),
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications for all events.",
        default: true,
    },
});

function toast(message: string, type: number) {
    if (settings.store.showToasts)
        Toasts.show({ message, id: Toasts.genId(), type });
}

function cancelRejoin() {
    if (rejoinTimeout) { clearTimeout(rejoinTimeout); rejoinTimeout = null; }
    retryCount = 0;
    isRejoining = false;
}

function tryRejoin(channelId: string) {
    const max = settings.store.maxRetries;
    if (max > 0 && retryCount >= max) {
        toast(`AntiDisconnect: Gave up after ${max} attempt(s).`, Toasts.Type.FAILURE);
        cancelRejoin();
        return;
    }
    retryCount++;
    isRejoining = true;
    const label = max > 0 ? ` (attempt ${retryCount}/${max})` : "";
    toast(`AntiDisconnect: Rejoining...${label}`, Toasts.Type.MESSAGE);
    internalSelectVoiceChannel(channelId);
}

function scheduleRejoin(channelId: string) {
    const delay = settings.store.rejoinDelay;
    if (rejoinTimeout) clearTimeout(rejoinTimeout);
    if (delay <= 0) {
        if (!SelectedChannelStore.getVoiceChannelId()) tryRejoin(channelId);
        else cancelRejoin();
        return;
    }
    rejoinTimeout = setTimeout(() => {
        rejoinTimeout = null;
        if (!SelectedChannelStore.getVoiceChannelId()) tryRejoin(channelId);
        else cancelRejoin();
    }, delay);
}

async function patchMember(userId: string, guildId: string, body: object) {
    await RestAPI.patch({
        url: Constants.Endpoints.GUILD_MEMBER(guildId, userId),
        body,
    });
}

function toggleSetting(key: "antiDisconnect" | "antiMove" | "antiMuteServer" | "antiDeafenServer") {
    (settings.store[key] as boolean) = !settings.store[key];
    const labels: Record<typeof key, string> = {
        antiDisconnect: "AntiDisconnect",
        antiMove: "AntiMove",
        antiMuteServer: "AntiMuteServer (Perms)",
        antiDeafenServer: "AntiDeafenServer (Perms)",
    };
    const on = settings.store[key] as boolean;
    toast(`${labels[key]} ${on ? "- Enabled" : "- Disabled"}`, on ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE);
}

const RtcChannelContext: NavContextMenuPatchCallback = children => {
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuCheckboxItem
                id="anti-disconnect-toggle"
                label="AntiDisconnect"
                checked={settings.store.antiDisconnect}
                action={() => toggleSetting("antiDisconnect")}
            />
            <Menu.MenuCheckboxItem
                id="anti-move-toggle"
                label="AntiMove"
                checked={settings.store.antiMove}
                action={() => toggleSetting("antiMove")}
            />
            <Menu.MenuCheckboxItem
                id="anti-mute-toggle"
                label="AntiMuteServer (Perms)"
                checked={settings.store.antiMuteServer}
                action={() => toggleSetting("antiMuteServer")}
            />
            <Menu.MenuCheckboxItem
                id="anti-deafen-toggle"
                label="AntiDeafenServer (Perms)"
                checked={settings.store.antiDeafenServer}
                action={() => toggleSetting("antiDeafenServer")}
            />
        </Menu.MenuGroup>
    );
};

function resetState() {
    cancelRejoin();
    manualDisconnect = false;
    calledByPlugin = false;
    isRejoining = false;
}

export default definePlugin({
    name: "Untouchable",
    description: "Keeps you in control of your voice presence. Rejoins if disconnected, blocks moves, and auto-unmutes/undeafens if server-moderated.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["Privacy", "Utility", "Fun", "Bypass", "Auto"],
    enabledByDefault: false,

    settings,

    contextMenus: { "rtc-channel": RtcChannelContext },

    flux: {
        CONNECTION_OPEN() {
            myUserId = UserStore.getCurrentUser()?.id ?? null;
            resetState();
        },

        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null }) {
            manualDisconnect = channelId === null;
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[] }) {
            if (!myUserId) return;

            for (const state of voiceStates) {
                const { userId, channelId, oldChannelId, guildId, mute, selfMute, deaf, selfDeaf } = state;
                if (userId !== myUserId) continue;

                const isMove  = !!channelId && !!oldChannelId && channelId !== oldChannelId;
                const isJoin  = !!channelId && !oldChannelId;
                const isLeave = !channelId  && !!oldChannelId;

                if (isMove) {
                    if (settings.store.antiMove && !isRejoining) {
                        toast("AntiMove: Moved back to your channel.", Toasts.Type.MESSAGE);
                        const target = oldChannelId!;
                        Promise.resolve().then(() => internalSelectVoiceChannel(target));
                        continue;
                    }
                    if (isRejoining) isRejoining = false;
                    else retryCount = 0;
                    if (rejoinTimeout) { clearTimeout(rejoinTimeout); rejoinTimeout = null; }
                }

                if (isJoin) {
                    manualDisconnect = false;
                    if (isRejoining) isRejoining = false;
                    else retryCount = 0;
                    if (rejoinTimeout) { clearTimeout(rejoinTimeout); rejoinTimeout = null; }
                }

                if (isLeave) {
                    if (settings.store.ignoreManualDisconnect && manualDisconnect) {
                        manualDisconnect = false;
                        cancelRejoin();
                        continue;
                    }
                    manualDisconnect = false;
                    if (settings.store.antiDisconnect) scheduleRejoin(oldChannelId!);
                }

                if (!channelId || !guildId) continue;
                const channel = ChannelStore.getChannel(channelId);
                if (!channel) continue;

                if (mute && !selfMute && settings.store.antiMuteServer) {
                    if (PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel)) {
                        setTimeout(async () => {
                            try {
                                await patchMember(myUserId!, guildId, { mute: false });
                                toast("AntiMute: Server mute removed.", Toasts.Type.SUCCESS);
                            } catch {
                                try { VoiceActions.toggleSelfMute(); } catch { /* noop */ }
                            }
                        }, 100);
                    }
                }

                if (deaf && !selfDeaf && settings.store.antiDeafenServer) {
                    if (PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel)) {
                        setTimeout(async () => {
                            try {
                                await patchMember(myUserId!, guildId, { deaf: false });
                                toast("AntiDeafen: Server deafen removed.", Toasts.Type.SUCCESS);
                            } catch {
                                try { VoiceActions.toggleSelfDeaf(); } catch { /* noop */ }
                            }
                        }, 100);
                    }
                }
            }
        },
    },

    start() {
        myUserId = UserStore.getCurrentUser()?.id ?? null;
        originalSelectVoiceChannel = ChannelActionsRaw.selectVoiceChannel.bind(ChannelActionsRaw);
        ChannelActionsRaw.selectVoiceChannel = patchedSelectVoiceChannel;
    },

    stop() {
        if (originalSelectVoiceChannel) {
            ChannelActionsRaw.selectVoiceChannel = originalSelectVoiceChannel;
            originalSelectVoiceChannel = null;
        }
        resetState();
        myUserId = null;
    },
});
