/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

function dispatch(key: string, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key, value });
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

    flux: {
        STREAMER_MODE_UPDATE({ key, value }: { key: string; value: boolean; }) {
            const map: Record<string, keyof typeof settings.store> = {
                enabled: "streamerEnabled",
                autoEnable: "autoEnable",
                hidePersonalInformation: "hidePersonalInformation",
                hideInviteLinks: "hideInviteLinks",
                disableSounds: "disableSounds",
                disableNotifications: "disableNotifications",
                hideWindowFromScreenCapture: "hideWindowFromScreenCapture",
            };
            if (map[key]) settings.store[map[key]] = value;
        },
    },
});
