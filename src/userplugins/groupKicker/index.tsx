/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { Devs } from "@utils/constants";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";
import { Channel } from "discord-types/general";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable GroupKicker",
        default: true,
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notifications on actions",
        default: true,
    },
    confirmBeforeKick: {
        type: OptionType.BOOLEAN,
        description: "Confirm before kicking all members",
        default: true,
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (verbose logs)",
        default: false,
    },
});

function log(message: string, level: "info" | "warn" | "error" = "info") {
    const prefix = `[GroupKicker ${new Date().toLocaleTimeString()}]`;
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

async function kickUser(channelId: string, userId: string): Promise<boolean> {
    try {
        await RestAPI.del({ url: `/channels/${channelId}/recipients/${userId}` });
        debugLog(`Kicked ${userId}`);
        return true;
    } catch (error) {
        log(`Failed to kick ${userId}: ${error}`, "error");
        return false;
    }
}

async function kickAllMembers(channelId: string) {
    if (!settings.store.enabled) return;

    const channel = ChannelStore.getChannel(channelId);
    const currentUserId = UserStore.getCurrentUser()?.id;

    if (!channel || channel.type !== 3 || !currentUserId) return;
    if (channel.ownerId !== currentUserId) {
        notify("❌ GroupKicker", "Only the group owner can kick all members.");
        return;
    }

    const recipients = channel.recipients ?? [];
    if (recipients.length === 0) {
        notify("ℹ️ GroupKicker", "No members to kick.");
        return;
    }

    if (settings.store.confirmBeforeKick && !confirm(
        `⚠️ Kick all ${recipients.length} members from this group?\n\nThis cannot be undone.`
    )) return;

    notify("🔄 GroupKicker", `Kicking ${recipients.length} member(s)...`);

    let success = 0, failed = 0;

    for (const id of recipients) {
        if (id === currentUserId) continue;
        (await kickUser(channelId, id)) ? success++ : failed++;
        await new Promise(r => setTimeout(r, 100));
    }

    notify(
        failed > 0 ? "⚠️ GroupKicker" : "✅ GroupKicker",
        failed > 0 ? `${success} kicked, ${failed} failed.` : `${success} member(s) kicked.`
    );
}

const GroupContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel || channel.type !== 3) return;

    const currentUserId = UserStore.getCurrentUser()?.id;
    if (channel.ownerId !== currentUserId) return;

    const memberCount = channel.recipients?.length ?? 0;
    if (memberCount === 0) return;

    const group = findGroupChildrenByChildId("leave-channel", children);
    if (!group) return;

    group.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="vc-kick-all-members"
            label={`🦶 Kick all members (${memberCount})`}
            color="danger"
            action={() => kickAllMembers(channel.id)}
        />
    );
};

export default definePlugin({
    name: "GroupKicker",
    description: "Allows group owner to kick all members with one click",
    authors: [{ name: "Bash", id: 1327483363518582784n }, Devs.x2b],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "gdm-context": GroupContextMenuPatch,
    },

    start() {
        log("Plugin started");
        notify("🦶 GroupKicker enabled", "Right-click a group to kick all members.");
    },

    stop() {
        log("Plugin stopped");
        notify("🦶 GroupKicker disabled", "Plugin stopped.");
    },
});