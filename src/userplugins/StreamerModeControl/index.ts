/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const STORE_KEY_MAP: Record<string, string> = {
    streamerEnabled: "enabled",
    hidePersonalInformation: "hidePersonalInformation",
    hideInviteLinks: "hideInviteLinks",
    disableSounds: "disableSounds",
    disableNotifications: "disableNotifications",
    hideWindowFromScreenCapture: "hideWindowFromScreenCapture",
};

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
    Object.entries(STORE_KEY_MAP).map(([k, v]) => [v, k])
);

function applyToDiscord(storeKey: string, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key: storeKey, value });
}

function syncFromStore() {
    const store = findByProps("hidePersonalInformation") as any;
    if (!store) return;
    for (const [settingKey, storeKey] of Object.entries(STORE_KEY_MAP)) {
        const val = store[storeKey];
        if (typeof val === "boolean") {
            (settings.store as any)[settingKey] = val;
        }
    }
}

const settings = definePluginSettings({
    streamerEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Streamer Mode",
        default: false,
        onChange: (v: boolean) => applyToDiscord("enabled", v),
    },
    hidePersonalInformation: {
        type: OptionType.BOOLEAN,
        description: "Hide personal info (email, accounts, notes, DM previews)",
        default: true,
        onChange: (v: boolean) => applyToDiscord("hidePersonalInformation", v),
    },
    hideInviteLinks: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord server invite links",
        default: true,
        onChange: (v: boolean) => applyToDiscord("hideInviteLinks", v),
    },
    disableSounds: {
        type: OptionType.BOOLEAN,
        description: "Disable all sound effects",
        default: true,
        onChange: (v: boolean) => applyToDiscord("disableSounds", v),
    },
    disableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Disable notifications",
        default: true,
        onChange: (v: boolean) => applyToDiscord("disableNotifications", v),
    },
    hideWindowFromScreenCapture: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord window from screen capture tools",
        default: false,
        onChange: (v: boolean) => applyToDiscord("hideWindowFromScreenCapture", v),
    },
});

export default definePlugin({
    name: "StreamerModeControl",
    description: "Control all Streamer Mode options directly from plugin settings",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,

    start() {
        syncFromStore();
    },

    flux: {
        STREAMER_MODE_UPDATE({ key, value }: { key: string; value: boolean; }) {
            const settingKey = REVERSE_MAP[key];
            if (settingKey) (settings.store as any)[settingKey] = value;
        },
        CONNECTION_OPEN() {
            syncFromStore();
        },
    },
});
