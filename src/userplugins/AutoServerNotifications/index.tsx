/*
 * Equicord, a Discord client mod
 * Copyright (c) 2026 Equicord Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    findGroupChildrenByChildId,
    NavContextMenuPatchCallback,
} from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { CogWheel } from "@components/Icons";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { Button, Forms, GuildStore, Menu, Toasts, UserStore, useEffect, useState } from "@webpack/common";

type MessageNotifications = 0 | 1 | 2;

const knownGuilds = new Set<string>();
let startupDone = false;

let isRunning = false;
const runningListeners = new Set<(v: boolean) => void>();

function setRunning(v: boolean) {
    isRunning = v;
    runningListeners.forEach(fn => fn(v));
}

function useIsRunning() {
    const [val, setVal] = useState(isRunning);
    useEffect(() => {
        runningListeners.add(setVal);
        return () => void runningListeners.delete(setVal);
    }, []);
    return val;
}

const settings = definePluginSettings({
    applyToNew: {
        type: OptionType.BOOLEAN,
        description: "Auto-apply settings when joining a new server",
        default: true,
    },
    muteServer: {
        type: OptionType.BOOLEAN,
        description: "Mute server (indefinitely)",
        default: true,
    },
    messageNotifications: {
        type: OptionType.SELECT,
        description: "Message notification level",
        options: [
            { label: "All messages", value: 0 },
            { label: "Only @mentions", value: 1, default: true },
            { label: "Nothing", value: 2 },
            { label: "Server default", value: 3 },
        ],
    },
    suppressEveryone: {
        type: OptionType.BOOLEAN,
        description: "Suppress @everyone and @here",
        default: true,
    },
    suppressRoles: {
        type: OptionType.BOOLEAN,
        description: "Suppress all role @mentions",
        default: true,
    },
    suppressHighlights: {
        type: OptionType.BOOLEAN,
        description: "Suppress highlights",
        default: true,
    },
    muteScheduledEvents: {
        type: OptionType.BOOLEAN,
        description: "Mute new events",
        default: true,
    },
    mobilePush: {
        type: OptionType.BOOLEAN,
        description: "Mobile push notifications",
        default: false,
    },
    showAllChannels: {
        type: OptionType.BOOLEAN,
        description: "Show all channels (opt-in)",
        default: true,
    },
});

function buildGuildFields(): Record<string, unknown> {
    const s = settings.store;
    const fields: Record<string, unknown> = {
        suppress_everyone: s.suppressEveryone,
        suppress_roles: s.suppressRoles,
        notify_highlights: s.suppressHighlights ? 1 : 2,
        mute_scheduled_events: s.muteScheduledEvents,
        mobile_push: s.mobilePush,
        flags: s.showAllChannels ? 0 : (1 << 12),
        muted: s.muteServer,
        mute_config: s.muteServer ? { selected_time_window: -1, end_time: null } : null,
    };
    if (s.messageNotifications !== 3) {
        fields.message_notifications = s.messageNotifications as MessageNotifications;
    }
    return fields;
}

function getToken(): string {
    return findByProps("getToken")?.getToken?.() ?? "";
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function patchGuildsSettings(guildsPayload: Record<string, unknown>): Promise<void> {
    const token = getToken();
    if (!token) throw new Error("No token");

    while (true) {
        const res = await fetch("https://discord.com/api/v9/users/@me/guilds/settings", {
            method: "PATCH",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ guilds: guildsPayload }),
        });

        if (res.ok) return;

        if (res.status === 429) {
            let waitMs = 3000;
            try {
                const body = await res.clone().json();
                if (body.retry_after) waitMs = Math.ceil(body.retry_after * 1000) + 500;
            } catch { }
            await sleep(waitMs);
            continue;
        }

        throw new Error(`HTTP ${res.status}`);
    }
}

async function applyToGuild(guildId: string): Promise<void> {
    if (!guildId || guildId === "@me" || guildId === "null") return;
    await patchGuildsSettings({ [guildId]: buildGuildFields() });
}

async function applyToAll(): Promise<void> {
    if (isRunning) return;
    setRunning(true);

    const ids = Object.keys(GuildStore.getGuilds());
    const fields = buildGuildFields();
    const CHUNK = 100;
    let ok = 0, fail = 0;

    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const payload: Record<string, unknown> = {};
        for (const id of chunk) payload[id] = fields;

        try {
            await patchGuildsSettings(payload);
            ok += chunk.length;
        } catch {
            fail += chunk.length;
        }

        if (i + CHUNK < ids.length) await sleep(500);
    }

    setRunning(false);
    Toasts.show({
        message: fail === 0
            ? `Applied to ${ok} servers.`
            : `Applied to ${ok} servers, ${fail} failed.`,
        type: fail === 0 ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        id: Toasts.genId(),
    });
}

const makeContextMenuPatch: (withIcon: boolean) => NavContextMenuPatchCallback =
    (withIcon) => (children, { guild }: any) => {
        if (!guild) return;

        const menuItem = (
            <Menu.MenuItem
                id="asn-apply"
                label="Apply AutoNotification Settings"
                icon={withIcon ? CogWheel : void 0}
                action={() => {
                    applyToGuild(guild.id)
                        .then(() => Toasts.show({
                            message: "Notification settings applied.",
                            type: Toasts.Type.SUCCESS,
                            id: Toasts.genId(),
                        }))
                        .catch(() => Toasts.show({
                            message: "Failed to apply settings.",
                            type: Toasts.Type.FAILURE,
                            id: Toasts.genId(),
                        }));
                }}
            />
        );

        const group = findGroupChildrenByChildId("privacy", children);
        if (group) {
            group.push(menuItem);
        } else {
            children.push(menuItem);
        }
    };

export default definePlugin({
    name: "AutoServerNotifications",
    description: "Apply custom notification settings to all servers, with auto-apply on join and a right-click context menu.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["mute", "notifications", "server", "auto"],
    settings,

    patches: [
        {
            find: ",acceptInvite(",
            replacement: {
                match: /INVITE_ACCEPT_SUCCESS.+?,(\i)=\i\?\.guild_id.+?;/,
                replace: (m: string, guildId: string) => `${m}$self.applyToGuild(${guildId});`,
            },
        },
        {
            find: "{joinGuild:",
            replacement: {
                match: /guildId:(\i),lurker:(\i).{0,20}}\)\);/,
                replace: (m: string, guildId: string, lurker: string) =>
                    `${m}if(!${lurker})$self.applyToGuild(${guildId});`,
            },
        },
    ],

    contextMenus: {
        "guild-context": makeContextMenuPatch(false),
        "guild-header-popout": makeContextMenuPatch(true),
    },

    applyToGuild,

    start() {
        for (const id of Object.keys(GuildStore.getGuilds())) knownGuilds.add(id);
        setTimeout(() => { startupDone = true; }, 5000);
    },

    stop() {
        knownGuilds.clear();
        startupDone = false;
    },

    flux: {
        GUILD_CREATE(event: { guild: { id: string; }; }) {
            if (!settings.store.applyToNew) return;
            if (!startupDone || knownGuilds.has(event.guild.id)) {
                knownGuilds.add(event.guild.id);
                return;
            }
            knownGuilds.add(event.guild.id);
            sleep(3000)
                .then(() => applyToGuild(event.guild.id))
                .then(() => Toasts.show({
                    message: "Notification settings applied to new server.",
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId(),
                }))
                .catch(() => { });
        },

        GUILD_JOIN_REQUEST_UPDATE({ guildId, request, status }: any) {
            if (status === "APPROVED" && request.user_id === UserStore.getCurrentUser().id) {
                sleep(3000).then(() => applyToGuild(guildId)).catch(() => { });
            }
        },
    },

    settingsAboutComponent() {
        const running = useIsRunning();
        return (
            <Forms.FormSection>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    {running
                        ? "Applying settings to all servers, please wait…"
                        : "Apply the settings above to all your current servers at once."
                    }
                </Forms.FormText>
                <Button
                    color={Button.Colors.BRAND}
                    size={Button.Sizes.SMALL}
                    disabled={running}
                    onClick={applyToAll}
                >
                    {running ? "Applying…" : "Apply to all servers"}
                </Button>
            </Forms.FormSection>
        );
    },
});