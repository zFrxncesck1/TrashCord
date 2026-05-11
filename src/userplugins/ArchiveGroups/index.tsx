/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Clickable, Menu, React, UserStore } from "@webpack/common";

import { openArchiveModal } from "./ArchiveModal";

const AckUtils = findByPropsLazy("ack", "ackChannel");

export const settings = definePluginSettings({
    archivedServers: {
        type: OptionType.CUSTOM,
        default: [] as string[],
        description: "",
    },
});

export function isArchived(guildId: string): boolean {
    return settings.store.archivedServers.includes(guildId);
}

export function archiveServer(guildId: string) {
    if (!isArchived(guildId)) {
        settings.store.archivedServers = [...settings.store.archivedServers, guildId];
    }
}

export function unarchiveServer(guildId: string) {
    settings.store.archivedServers = settings.store.archivedServers.filter(id => id !== guildId);
}

const ArchiveButton = () => {
    const { archivedServers } = settings.use(["archivedServers"]);

    return (
        <div className="vc-archive-groups-button-container">
            <Clickable
                className="vc-archive-groups-button"
                onClick={() => {
                    openArchiveModal();
                }}
            >
                <svg
                    aria-hidden="true"
                    role="img"
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <path
                        fill="currentColor"
                        d="M3 5.5C3 4.67 3.67 4 4.5 4h15c.83 0 1.5.67 1.5 1.5v3c0 .83-.67 1.5-1.5 1.5h-15A1.5 1.5 0 0 1 3 8.5v-3ZM4 11h16v7.5c0 .83-.67 1.5-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V11Zm6.5 2a.5.5 0 0 0-.5.5v2c0 .28.22.5.5.5h3a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-3Z"
                    />
                </svg>
            </Clickable>
        </div>
    );
};

export default definePlugin({
    name: "ArchiveGroups",
    description: "Archive servers to hide them from your list, mute their notifications, and auto-read mentions.",
    authors: [{ name: "Equicord", id: 0n }],
    tags: ["Servers", "Utility", "Notification"],
    enabledByDefault: false,
    managedStyle,
    settings,
    dependencies: ["ServerListAPI", "ContextMenuAPI"],

    contextMenus: {
        "guild-context": (children, { guild }) => {
            const group = findGroupChildrenByChildId("privacy", children);
            if (!group) return;

            const isGuildArchived = isArchived(guild.id);

            group?.push(
                <Menu.MenuItem
                    id="vc-archive-group"
                    label={isGuildArchived ? "Unarchive Server" : "Archive Server"}
                    action={() => {
                        if (isGuildArchived) {
                            unarchiveServer(guild.id);
                        } else {
                            archiveServer(guild.id);
                        }
                    }}
                />
            );
        },
    },

    patches: [
        {
            find: '("guildsnav")',
            replacement: [
                {
                    match: /(\i)(\.map\(.{0,30}\}\),\i)/,
                    replace: "$self.useFilteredGuilds($1)$2"
                },
                {
                    match: /let{disableAppDownload.{0,10}isPlatformEmbedded/,
                    replace: "$self.useStore();$&",
                }
            ]
        },
        {
            find: "getMentionCount:",
            replacement: [
                {
                    match: /getMentionCount:(\i)=>(.+?),/,
                    replace: "getMentionCount:$1=>($self.isChannelInArchivedGuild($1)?0:$2),"
                },
                {
                    match: /hasUnread:(\i)=>(.+?),/,
                    replace: "hasUnread:$1=>($self.isChannelInArchivedGuild($1)?false:$2),"
                }
            ]
        }
    ],

    isArchived(guildId: string): boolean {
        return settings.store.archivedServers.includes(guildId);
    },

    useStore() {
        settings.use(["archivedServers"]);
    },

    useFilteredGuilds(guilds: any[]): any[] {
        const { archivedServers } = settings.store;

        if (!guilds || !Array.isArray(guilds)) return guilds;

        return guilds.flatMap(guild => {
            if (!guild) return [];

            if (guild.type === "guild" && archivedServers.includes(guild.id?.toString())) {
                return [];
            }
            if (guild.type === "folder" && archivedServers.includes("folder-" + guild.id?.toString())) {
                return [];
            }

            const newGuild = Object.assign({}, guild);
            if (newGuild.children && Array.isArray(newGuild.children)) {
                newGuild.children = guild.children.filter(
                    (child: any) => {
                        if (!child) return true;
                        if (child.type === "folder" && archivedServers.includes("folder-" + child.id?.toString())) return false;
                        if (archivedServers.includes(child.id?.toString())) return false;
                        return true;
                    }
                );
            }

            return [newGuild];
        });
    },

    isChannelInArchivedGuild(channelId: string) {
        // We need to look up the guildId for this channel, and then check isArchived.
        try {
            const { ChannelStore } = require("@webpack/common");
            const channel = ChannelStore.getChannel(channelId);
            if (channel?.guild_id && this.isArchived(channel.guild_id)) {
                return true;
            }
        } catch { }
        return false;
    },

    flux: {
        MESSAGE_CREATE(data: any) {
            const message = data?.message;
            if (!message || !message.guild_id) return;

            if (isArchived(message.guild_id)) {
                // Check if user is mentioned
                const userId = UserStore.getCurrentUser()?.id;
                const isMentioned = message.mentions?.some((m: any) => m.id === userId) ||
                    message.mention_roles?.length > 0; // Simplified role check

                if (isMentioned) {
                    // For archived servers, we want to auto read any message since we don't want notifications.
                    // The request was: "when someone tags me it auto read so i dont get the tag marker"
                    // We can just ack the channel instantly if the message is in an archived server
                    setTimeout(() => {
                        try {
                            AckUtils.ack(message.channel_id);
                        } catch (err) {
                            console.error("Failed to ACK archived group message", err);
                        }
                    }, 1000);
                }
            }
        }
    },

    start() {
        addServerListElement(ServerListRenderPosition.Above, ArchiveButton);
    },

    stop() {
        removeServerListElement(ServerListRenderPosition.Above, ArchiveButton);
    },
});
