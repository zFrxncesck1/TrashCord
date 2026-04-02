import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

function apply(key: string, value: boolean) {
    FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key, value });
}

function applyAll() {
    apply("autoEnable", false);
    apply("enabled", settings.store.streamerEnabled);
    apply("hidePersonalInformation", settings.store.hidePersonalInformation);
    apply("hideInviteLinks", settings.store.hideInviteLinks);
    apply("disableSounds", settings.store.disableSounds);
    apply("disableNotifications", settings.store.disableNotifications);
    apply("hideWindowFromScreenCapture", settings.store.hideWindowFromScreenCapture);
}

function dismissBanner() {
    (document.querySelector("[class*='colorStreamerMode'] button") as HTMLElement | null)?.click();
}

const settings = definePluginSettings({
    streamerEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Streamer Mode",
        default: false,
        onChange: (v: boolean) => apply("enabled", v),
    },
    hidePersonalInformation: {
        type: OptionType.BOOLEAN,
        description: "Hide personal info (email, accounts, notes, DM previews)",
        default: true,
        onChange: (v: boolean) => apply("hidePersonalInformation", v),
    },
    hideInviteLinks: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord server invite links",
        default: true,
        onChange: (v: boolean) => apply("hideInviteLinks", v),
    },
    disableSounds: {
        type: OptionType.BOOLEAN,
        description: "Disable all sound effects",
        default: false,
        onChange: (v: boolean) => apply("disableSounds", v),
    },
    disableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Disable notifications",
        default: false,
        onChange: (v: boolean) => apply("disableNotifications", v),
    },
    hideWindowFromScreenCapture: {
        type: OptionType.BOOLEAN,
        description: "Hide Discord window from screen capture",
        default: false,
        onChange: (v: boolean) => apply("hideWindowFromScreenCapture", v),
    },
});

export default definePlugin({
    name: "StreamerModeControl",
    description: "Control all Streamer Mode options directly from plugin settings",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,

    start: applyAll,

    flux: {
        CONNECTION_OPEN: applyAll,
        STREAMER_MODE_UPDATE({ key, value }: { key: string; value: boolean; }) {
            if (key === "enabled" && value !== settings.store.streamerEnabled) {
                applyAll();
                dismissBanner();
            }
        },
    },
});
