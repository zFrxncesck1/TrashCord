import definePlugin, { OptionType, PluginSettingDef } from "@utils/types";
import Patches from "./patches";
import { definePluginSettings } from "@api/Settings";
import { Forms } from "@webpack/common";

export const ParsedPatches = Object.entries(Patches).map(([patchName, { description, default: defaultValue, patches }]) => {
    return {
        name: patchName,
        setting: {
            type: OptionType.BOOLEAN,
            description,
            default: !!(defaultValue ?? true),
            restartNeeded: true
        } as PluginSettingDef,
        patches: (Array.isArray(patches) ? patches : [patches]).map(p => ({
            ...p,
            predicate: () => ((p?.predicate ?? (() => true))() && settings.store[patchName]) || settings.store.enableAllPatches
        })),
    };
});

const settings = definePluginSettings(Object.fromEntries([
    ...ParsedPatches.map(p => [p.name, p.setting]),
    ["enableAllPatches", {
        type: OptionType.BOOLEAN,
        description: "Enable all patches (intended for testing)",
        default: false,
        restartNeeded: true
    }]
]));

export default definePlugin({
    name: "JunkCleanup",
    description: "Another plugin that cleans up common annoyances in Discord",
    authors: [{ name: "Sqaaakoi", id: 0n }],
    tags: ["Appearance", "Utility", "Junk", "Bloat", "Debloat", "Shop", "Gift", "Nitro", "Ad", "Advertisement", "Adblock"],
    enabledByDefault: false,
    settings,
    patches: ParsedPatches.flatMap(p => p.patches),
    settingsAboutComponent: () => {
        return <div>
            <Forms.FormTitle>Total patch count: {ParsedPatches.length}</Forms.FormTitle>
            <Forms.FormTitle style={{ marginBottom: 0 }}>
                <a href="https://github.com/Sqaaakoi/vc-junkCleanup" target="_blank" rel="noreferrer">
                    View repository on GitHub
                </a>
            </Forms.FormTitle>
        </div>;
    }
});