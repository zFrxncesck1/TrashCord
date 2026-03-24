/*
 * Equicord, a Discord client mod
 * Copyright (c) 2026 Equicord Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, Toasts, useState, useEffect } from "@webpack/common";
import { findByProps } from "@webpack";
import { GuildStore } from "@webpack/common";

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
        return () => { runningListeners.delete(setVal); };
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

// flags bitfield:
// bit 12 (4096) = hide opt-in channels (NOT show all channels)
function buildFlags(showAllChannels: boolean): number {
    return showAllChannels ? 0 : (1 << 12);
}

// Build the guild settings payload using the real Discord bulk endpoint format.
// Discovered via network inspection: PATCH /users/@me/guilds/settings
// with body: { "guilds": { "GUILD_ID": { ...fields } } }
// notify_highlights: 1 = disabled, 2 = enabled
function getGuildPayload(guildId: string) {
    const s = settings.store;
    const fields: Record<string, unknown> = {
        message_notifications: s.messageNotifications as MessageNotifications,
        suppress_everyone: s.suppressEveryone,
        suppress_roles: s.suppressRoles,
        notify_highlights: s.suppressHighlights ? 1 : 2,
        mute_scheduled_events: s.muteScheduledEvents,
        mobile_push: s.mobilePush,
        flags: buildFlags(s.showAllChannels),
        muted: s.muteServer,
        mute_config: s.muteServer
            ? { selected_time_window: -1, end_time: null }
            : null,
    };
    return { guilds: { [guildId]: fields } };
}

function getToken(): string {
    return findByProps("getToken")?.getToken?.() ?? "";
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function applyToGuild(guildId: string): Promise<void> {
    const token = getToken();
    if (!token) throw new Error("No token");

    while (true) {
        const res = await fetch(
            "https://discord.com/api/v9/users/@me/guilds/settings",
            {
                method: "PATCH",
                headers: {
                    "Authorization": token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(getGuildPayload(guildId)),
            }
        );

        if (res.ok) return;

        if (res.status === 429) {
            let waitMs = 3000;
            try {
                const body = await res.clone().json();
                if (body.retry_after) waitMs = Math.ceil(body.retry_after * 1000) + 500;
            } catch { /* ignore */ }
            await sleep(waitMs);
            continue;
        }

        throw new Error(`HTTP ${res.status}`);
    }
}

async function applyToAll() {
    if (isRunning) return;
    setRunning(true);

    const ids = Object.keys(GuildStore.getGuilds());
    let ok = 0, fail = 0;

    for (const id of ids) {
        try {
            await applyToGuild(id);
            ok++;
            await sleep(500); // min: 429
        } catch (e) {
            fail++;
        }
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

export default definePlugin({
    name: "AutoServerNotifications",
    description: "Apply custom notification settings to all servers, with optional auto-apply on join.",
    authors: [
        {
            name: "zFrxncesck1",
            id: 456195985404592149n,
        }
    ],
    settings,

    start() {
        for (const id of Object.keys(GuildStore.getGuilds())) {
            knownGuilds.add(id);
        }
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
                .catch(() => { /* silent */ });
        },
    },

    settingsAboutComponent() {
        const running = useIsRunning();

        return (
            <Forms.FormSection>
                <Forms.FormText style={{ marginBottom: 8 }}>
                    {running
                        ? "Applying settings to all servers, please wait..."
                        : "Apply the settings above to all your current servers."
                    }
                </Forms.FormText>
                <Button
                    color={Button.Colors.BRAND}
                    size={Button.Sizes.SMALL}
                    disabled={running}
                    onClick={applyToAll}
                >
                    {running ? "Applying..." : "Apply to all servers"}
                </Button>
            </Forms.FormSection>
        );
    },
});