/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { PluginInfo } from "@plugins/betterScreenshare.desktop/constants";
import { openScreenshareModal } from "@plugins/betterScreenshare.desktop/modals";
import { ScreenshareAudioPatcher, ScreensharePatcher } from "@plugins/betterScreenshare.desktop/patchers";
import { GoLivePanelWrapper, replacedSubmitFunction } from "@plugins/betterScreenshare.desktop/patches";
import { initScreenshareAudioStore, initScreenshareStore } from "@plugins/betterScreenshare.desktop/stores";
import { Emitter, ScreenshareSettingsIcon } from "@plugins/philsPluginLibrary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Menu } from "@webpack/common";

const Button = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");

function screenshareSettingsButton() {
    return (
        <Button
            tooltipText="Change Screenshare Settings"
            icon={ScreenshareSettingsIcon}
            role="button"
            onClick={openScreenshareModal}
        />
    );
}

const screenshareContextMenuPatch: NavContextMenuPatchCallback = (children) => {
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="better-screenshare-open-settings"
            label="Screenshare Plugin Settings"
            action={openScreenshareModal}
        />
    );
};

export default definePlugin({
    name: "BetterScreenshare",
    description: "This plugin allows you to further customize your screen sharing.",
    authors: [Devs.philhk],
    tags: ["Voice", "Customisation"],
    enabledByDefault: false,
    dependencies: ["PhilsPluginLibrary"],
    patches: [
        {
            find: "GoLiveModal: user cannot be undefined",
            replacement: {
                match: /onSubmit:(\w+)/,
                replace: "onSubmit:$self.replacedSubmitFunction($1)"
            }
        },
        {
            find: "StreamSettings: user cannot be undefined",
            replacement: {
                match: /\(.{0,10}(,{.{0,100}modalContent)/,
                replace: "($self.GoLivePanelWrapper$1"
            }
        },
        {
            find: ".StreamPreviewIntro",
            replacement: {
                match: /children:\[(?=\(0,\i\.jsx\)\(\i\.\i,\{"aria-checked")/,
                replace: "children:[$self.screenshareSettingsButton(),"
            }
        }
    ],
    settings: definePluginSettings({
        hideDefaultSettings: {
            type: OptionType.BOOLEAN,
            description: "Hide Discord screen sharing settings",
            default: true,
        }
    }),
    start(): void {
        initScreenshareStore();
        initScreenshareAudioStore();
        this.screensharePatcher = new ScreensharePatcher().patch();
        this.screenshareAudioPatcher = new ScreenshareAudioPatcher().patch();

        addContextMenuPatch("manage-streams", screenshareContextMenuPatch);
        addContextMenuPatch("stream-options", screenshareContextMenuPatch);
    },
    stop(): void {
        this.screensharePatcher?.unpatch();
        this.screenshareAudioPatcher?.unpatch();
        Emitter.removeAllListeners(PluginInfo.PLUGIN_NAME);

        removeContextMenuPatch("manage-streams", screenshareContextMenuPatch);
        removeContextMenuPatch("stream-options", screenshareContextMenuPatch);
    },
    toolboxActions: {
        "Open Screenshare Settings": openScreenshareModal
    },
    replacedSubmitFunction,
    GoLivePanelWrapper,
    screenshareSettingsButton
});
