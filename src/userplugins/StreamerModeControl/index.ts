/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

type SMKey =
    | "streamerEnabled"
    | "autoEnable"
    | "hidePersonalInformation"
    | "hideInviteLinks"
    | "disableSounds"
    | "disableNotifications"
    | "hideWindowFromScreenCapture";

const KEY_MAP: Record<SMKey, string> = {
    streamerEnabled: "enabled",
    autoEnable: "autoEnable",
    hidePersonalInformation: "hidePersonalInformation",
    hideInviteLinks: "hideInviteLinks",
    disableSounds: "disableSounds",
    disableNotifications: "disableNotifications",
    hideWindowFromScreenCapture: "hideWindowFromScreenCapture",
};

function sm(settingKey: SMKey, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key: KEY_MAP[settingKey], value });
}

const settings = definePluginSettings({
    streamerEnabled: {
        type: OptionType.BOOLEAN,
        description: "Attiva la Modalità Streamer",
        default: false,
        onChange: (v: boolean) => sm("streamerEnabled", v),
    },
    autoEnable: {
        type: OptionType.BOOLEAN,
        description: "Attiva automaticamente se OBS o XSplit sono in esecuzione",
        default: false,
        onChange: (v: boolean) => sm("autoEnable", v),
    },
    hidePersonalInformation: {
        type: OptionType.BOOLEAN,
        description: "Nascondi le informazioni personali (e-mail, account, note, anteprime MD)",
        default: true,
        onChange: (v: boolean) => sm("hidePersonalInformation", v),
    },
    hideInviteLinks: {
        type: OptionType.BOOLEAN,
        description: "Nascondi i link di invito ai server Discord",
        default: true,
        onChange: (v: boolean) => sm("hideInviteLinks", v),
    },
    disableSounds: {
        type: OptionType.BOOLEAN,
        description: "Disattiva tutti gli effetti sonori",
        default: true,
        onChange: (v: boolean) => sm("disableSounds", v),
    },
    disableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Disattiva le notifiche",
        default: true,
        onChange: (v: boolean) => sm("disableNotifications", v),
    },
    hideWindowFromScreenCapture: {
        type: OptionType.BOOLEAN,
        description: "Nascondi la finestra di Discord dallo Strumento di cattura",
        default: false,
        onChange: (v: boolean) => sm("hideWindowFromScreenCapture", v),
    },
});

export default definePlugin({
    name: "StreamerModeControl",
    description: "Controlla tutte le opzioni della Modalità Streamer dai settings del plugin, sincronizzate con Discord",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,

    start() {
        try {
            const store = findByProps("hidePersonalInformation", "hideInviteLinks", "disableSounds") as Record<string, unknown> | null;
            if (!store) return;
            const map: [SMKey, string][] = Object.entries(KEY_MAP) as [SMKey, string][];
            for (const [settingKey, storeKey] of map) {
                const val = store[storeKey];
                if (typeof val === "boolean") {
                    settings.store[settingKey] = val;
                }
            }
        } catch { }
    },

    flux: {
        STREAMER_MODE_UPDATE({ key, value }: { key: string; value: boolean; }) {
            const entry = (Object.entries(KEY_MAP) as [SMKey, string][]).find(([, sk]) => sk === key);
            if (entry) settings.store[entry[0]] = value;
        },
    },
});
