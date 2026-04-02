
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByStoreName } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const KEYS = [
    "enabled",
    "autoEnable",
    "hidePersonalInformation",
    "hideInviteLinks",
    "disableSounds",
    "disableNotifications",
    "hideWindowFromScreenCapture",
] as const;

type SMKey = typeof KEYS[number];

function sm(key: SMKey, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key, value });
}

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Streamer Mode",
        default: false,
        onChange: (v: boolean) => sm("enabled", v),
    },
    autoEnable: {
        type: OptionType.BOOLEAN,
        description: "Automatically enable if OBS or XSplit is running",
        default: false,
        onChange: (v: boolean) => sm("autoEnable", v),
    },
    hidePersonalInformation: {
        type: OptionType.BOOLEAN,
        description: "Hide personal information (email, connected accounts, notes, MD previews)",
        default: true,
        onChange: (v: boolean) => sm("hidePersonalInformation", v),
    },
    hideInviteLinks: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord server invite links",
        default: true,
        onChange: (v: boolean) => sm("hideInviteLinks", v),
    },
    disableSounds: {
        type: OptionType.BOOLEAN,
        description: "Disable all sound effects",
        default: true,
        onChange: (v: boolean) => sm("disableSounds", v),
    },
    disableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Disable notifications",
        default: true,
        onChange: (v: boolean) => sm("disableNotifications", v),
    },
    hideWindowFromScreenCapture: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord window from the Capture Tool",
        default: false,
        onChange: (v: boolean) => sm("hideWindowFromScreenCapture", v),
    },
});

export default definePlugin({
    name: "StreamerModeControl",
    description: "Control all Streamer Mode options from plugin settings, synced with Discord",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,

    start() {
        const store = findByStoreName("StreamerModeStore") as Record<string, unknown> | null;
        if (!store) return;
        for (const key of KEYS) {
            const val = store[key];
            if (typeof val === "boolean") {
                settings.store[key] = val;
            }
        }
    },

    flux: {
        STREAMER_MODE_UPDATE({ key, value }: { key: string; value: boolean; }) {
            if ((KEYS as readonly string[]).includes(key)) {
                settings.store[key as SMKey] = value;
            }
        },
    },
});