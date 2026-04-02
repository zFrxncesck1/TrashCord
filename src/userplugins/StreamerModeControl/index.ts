/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

function applyToDiscord(key: string, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key, value });
}

function applyAllToDiscord() {
    applyToDiscord("enabled", settings.store.streamerEnabled);
    applyToDiscord("hidePersonalInformation", settings.store.hidePersonalInformation);
    applyToDiscord("hideInviteLinks", settings.store.hideInviteLinks);
    applyToDiscord("disableSounds", settings.store.disableSounds);
    applyToDiscord("disableNotifications", settings.store.disableNotifications);
    applyToDiscord("hideWindowFromScreenCapture", settings.store.hideWindowFromScreenCapture);
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
        default: false,
        onChange: (v: boolean) => applyToDiscord("disableSounds", v),
    },
    disableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Disable notifications",
        default: false,
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
        applyAllToDiscord();
    },

    flux: {
        CONNECTION_OPEN() {
            applyAllToDiscord();
        },
    },
});
