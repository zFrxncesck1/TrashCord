/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const DISCORD_KEYS = [
    "enabled",
    "autoEnable",
    "hidePersonalInformation",
    "hideInviteLinks",
    "disableSounds",
    "disableNotifications",
    "hideWindowFromScreenCapture",
] as const;

const SETTING_TO_DISCORD: Record<string, string> = {
    streamerEnabled: "enabled",
    autoEnable: "autoEnable",
    hidePersonalInformation: "hidePersonalInformation",
    hideInviteLinks: "hideInviteLinks",
    disableSounds: "disableSounds",
    disableNotifications: "disableNotifications",
    hideWindowFromScreenCapture: "hideWindowFromScreenCapture",
};

const DISCORD_TO_SETTING: Record<string, string> = Object.fromEntries(
    Object.entries(SETTING_TO_DISCORD).map(([k, v]) => [v, k])
);

function dispatch(discordKey: string, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key: discordKey, value });
}

function getStreamerModeStore(): Record<string, unknown> | null {
    try {
        const graph = (FluxDispatcher as any)._actionHandlers?._dependencyGraph;
        const nodes: Map<string, any> | Record<string, any> = graph?.nodes;
        if (!nodes) return null;
        const iter = typeof (nodes as any).values === "function"
            ? (nodes as Map<string, any>).values()
            : Object.values(nodes);
        for (const node of iter) {
            const store = node?.store ?? node;
            if (typeof store?.getName === "function" && store.getName() === "StreamerModeStore") {
                return store as Record<string, unknown>;
            }
        }
    } catch { }
    return null;
}

const settings = definePluginSettings({
    streamerEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Streamer Mode",
        default: false,
        onChange: (v: boolean) => dispatch("enabled", v),
    },
    autoEnable: {
        type: OptionType.BOOLEAN,
        description: "Auto-enable when OBS or XSplit is running",
        default: false,
        onChange: (v: boolean) => dispatch("autoEnable", v),
    },
    hidePersonalInformation: {
        type: OptionType.BOOLEAN,
        description: "Hide personal info (email, accounts, notes, DM previews)",
        default: true,
        onChange: (v: boolean) => dispatch("hidePersonalInformation", v),
    },
    hideInviteLinks: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord server invite links",
        default: true,
        onChange: (v: boolean) => dispatch("hideInviteLinks", v),
    },
    disableSounds: {
        type: OptionType.BOOLEAN,
        description: "Disable all sound effects",
        default: true,
        onChange: (v: boolean) => dispatch("disableSounds", v),
    },
    disableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Disable notifications",
        default: true,
        onChange: (v: boolean) => dispatch("disableNotifications", v),
    },
    hideWindowFromScreenCapture: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord window from screen capture tools",
        default: false,
        onChange: (v: boolean) => dispatch("hideWindowFromScreenCapture", v),
    },
});

export default definePlugin({
    name: "StreamerModeControl",
    description: "Control all Streamer Mode options directly from plugin settings",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,

    start() {
        const store = getStreamerModeStore();
        if (!store) return;
        for (const discordKey of DISCORD_KEYS) {
            const val = store[discordKey] ?? (store as any).getState?.()?.[discordKey];
            const settingKey = DISCORD_TO_SETTING[discordKey];
            if (settingKey && typeof val === "boolean") {
                (settings.store as any)[settingKey] = val;
            }
        }
    },

    flux: {
        STREAMER_MODE_UPDATE({ key, value }: { key: string; value: boolean; }) {
            const settingKey = DISCORD_TO_SETTING[key];
            if (settingKey) (settings.store as any)[settingKey] = value;
        },
    },
});
