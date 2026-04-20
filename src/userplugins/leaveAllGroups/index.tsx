/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, Menu, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";
import { Channel } from "discord-types/general";

const PrivateChannelSortStore = findStoreLazy("PrivateChannelSortStore") as { getPrivateChannelIds: () => string[]; };

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable LeaveAllGroups",
        default: true,
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications on actions",
        default: true,
    },
    confirmBeforeLeave: {
        type: OptionType.BOOLEAN,
        description: "Confirm before leaving all groups",
        default: false,
    },
    delayBetweenLeaves: {
        type: OptionType.NUMBER,
        description: "Delay in ms between each group leave (to avoid rate limiting)",
        default: 200,
        min: 50,
        max: 1000,
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (verbose logs)",
        default: false,
    },
});

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const prefix = `[LeaveAllGroups ${new Date().toLocaleTimeString()}]`;
    if (level === "warn") console.warn(prefix, message);
    else if (level === "error") console.error(prefix, message);
    else console.log(prefix, message);
}

function debugLog(message: string) {
    if (settings.store.debugMode) log(`🔍 ${message}`);
}

function notify(title: string, body: string) {
    if (settings.store.showNotifications) showNotification({ title, body, icon: undefined });
}

async function leaveGroup(channelId: string): Promise<boolean> {
    try {
        await RestAPI.del({ url: `/channels/${channelId}` });
        debugLog(`Left group ${channelId}`);
        return true;
    } catch (error) {
        log(`Failed to leave group ${channelId}: ${error}`, "error");
        return false;
    }
}

function getAllGroups(): Channel[] {
    return PrivateChannelSortStore.getPrivateChannelIds()
        .map(id => ChannelStore.getChannel(id))
        .filter(c => c?.type === 3) as Channel[];
}

async function leaveAllGroups() {
    if (!settings.store.enabled) return;

    const groups = getAllGroups();

    if (groups.length === 0) {
        notify("ℹ️ LeaveAllGroups", "No groups to leave.");
        showToast(Toasts.Type.MESSAGE, "No groups to leave.");
        return;
    }

    if (settings.store.confirmBeforeLeave && !confirm(
        `⚠️ Leave all ${groups.length} groups?\n\nThis cannot be undone.`
    )) return;

    notify("🔄 LeaveAllGroups", `Leaving ${groups.length} group(s)...`);
    showToast(Toasts.Type.MESSAGE, `Leaving ${groups.length} group(s)...`);

    let success = 0, failed = 0;

    for (const group of groups) {
        (await leaveGroup(group.id)) ? success++ : failed++;
        if (settings.store.delayBetweenLeaves > 0)
            await new Promise(r => setTimeout(r, settings.store.delayBetweenLeaves));
    }

    notify(
        failed > 0 ? "⚠️ LeaveAllGroups" : "✅ LeaveAllGroups",
        failed > 0 ? `${success} left, ${failed} failed.` : `${success} group(s) left.`
    );

    if (failed > 0) showToast(Toasts.Type.FAILURE, `${success} left, ${failed} failed.`);
    else showToast(Toasts.Type.SUCCESS, `${success} group(s) left successfully.`);
}

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!settings.store.enabled || channel?.type !== 3) return;
    const group = findGroupChildrenByChildId("leave-channel", children);
    group?.push(
        <Menu.MenuItem id="vc-leave-all-groups" label="🚪 Leave all groups" action={leaveAllGroups} color="danger" />
    );
};

const ServerContextMenuPatch: NavContextMenuPatchCallback = (children) => {
    if (!settings.store.enabled) return;
    const group = findGroupChildrenByChildId("privacy", children);
    group?.push(
        <Menu.MenuItem id="vc-leave-all-groups-server" label="🚪 Leave all groups" action={leaveAllGroups} color="danger" />
    );
};

const UserContextMenuPatch: NavContextMenuPatchCallback = (children) => {
    if (!settings.store.enabled) return;
    const group = findGroupChildrenByChildId("block", children) ?? findGroupChildrenByChildId("remove-friend", children);
    group?.push(
        <Menu.MenuItem id="vc-leave-all-groups-user" label="🚪 Leave all groups" action={leaveAllGroups} color="danger" />
    );
};

export default definePlugin({
    name: "LeaveAllGroups",
    description: "Leave all Discord group DMs in one click with configurable rate limiting",
    authors: [Devs.x2b],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch,
        "guild-context": ServerContextMenuPatch,
        "user-context": UserContextMenuPatch,
    },

    start() { log("Plugin started"); },
    stop() { log("Plugin stopped"); },
});