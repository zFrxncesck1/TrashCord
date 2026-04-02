import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

function applyToDiscord(key: string, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key, value });
}

function applyAllToDiscord() {
    applyToDiscord("autoEnable", false);
    applyToDiscord("enabled", settings.store.streamerEnabled);
    applyToDiscord("hidePersonalInformation", settings.store.hidePersonalInformation);
    applyToDiscord("hideInviteLinks", settings.store.hideInviteLinks);
    applyToDiscord("disableSounds", settings.store.disableSounds);
    applyToDiscord("disableNotifications", settings.store.disableNotifications);
    applyToDiscord("hideWindowFromScreenCapture", settings.store.hideWindowFromScreenCapture);
}

function dismissBanner() {
    const banner = document.querySelector("[class*='colorStreamerMode']");
    if (!banner) return;
    const disableBtn = banner.querySelector("button") as HTMLElement | null;
    disableBtn?.click();
}

let observer: MutationObserver | null = null;
let reapplyTimeout: ReturnType<typeof setTimeout> | null = null;

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
        description: "Hide Discord window from screen capture",
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
        observer = new MutationObserver(dismissBanner);
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
        if (reapplyTimeout) clearTimeout(reapplyTimeout);
    },

    flux: {
        CONNECTION_OPEN() {
            applyAllToDiscord();
        },
        STREAMER_MODE_UPDATE({ key, value }: { key: string; value: boolean; }) {
            if (key === "enabled" && value !== settings.store.streamerEnabled) {
                if (reapplyTimeout) clearTimeout(reapplyTimeout);
                reapplyTimeout = setTimeout(() => applyAllToDiscord(), 429);
            }
        },
    },
});
