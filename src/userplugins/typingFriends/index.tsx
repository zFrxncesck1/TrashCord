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

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Constants, FluxDispatcher, GuildStore, RelationshipStore, } from "@webpack/common";

const TYPING_REL = 69;

const TYPING_USERS = new Map<string, string>();
const ORIGINAL_TYPES = new Map<string, number>();
const TIMERS = new Map<string, number>();

interface TypingEvent {
    userId: string;
    channelId: string;
}

function cleanupTyping(userId: string): void {
    const relationships = RelationshipStore.getMutableRelationships();
    const original = ORIGINAL_TYPES.get(userId);

    if (original != null) {
        relationships.set(userId, original);
        ORIGINAL_TYPES.delete(userId);
        RelationshipStore.emitChange();
    }

    TYPING_USERS.delete(String(userId));
    TIMERS.delete(userId);
}

function onTypingStart(e: TypingEvent) {
    if (!RelationshipStore.isFriend(e.userId)) return;

    const relationships = RelationshipStore.getMutableRelationships();

    if (!ORIGINAL_TYPES.has(e.userId)) {
        ORIGINAL_TYPES.set(e.userId, RelationshipStore.getRelationshipType(e.userId));
    }

    const channel = ChannelStore.getChannel(e.channelId);
    if (!channel) return;

    if (!channel.guild_id) {
        TYPING_USERS.set(String(e.userId), "DMs");

        relationships.set(e.userId, TYPING_REL as any);
        RelationshipStore.emitChange();

        const timer = TIMERS.get(e.userId);
        if (timer) clearTimeout(timer);
        TIMERS.set(
            e.userId,
            window.setTimeout(() => cleanupTyping(e.userId), settings.store.typingTimeout)
        );

        return;
    }

    const gid = channel.guild_id;
    const guild = GuildStore.getGuild(gid);
    if (guild) TYPING_USERS.set(String(e.userId), guild.name);

    relationships.set(e.userId, TYPING_REL as any);
    RelationshipStore.emitChange();

    const timer = TIMERS.get(e.userId);
    if (timer) clearTimeout(timer);

    TIMERS.set(
        e.userId,
        window.setTimeout(() => cleanupTyping(e.userId), settings.store.typingTimeout)
    );
}

function onTypingStop(e: TypingEvent) {
    const timer = TIMERS.get(e.userId);
    if (!timer) return;

    clearTimeout(timer);
    TIMERS.delete(e.userId);

    cleanupTyping(e.userId);
}

function syncShowFriendsSection() {
    (window as any).__friendsTypingShowSection = settings.store.showFriendsSection;
}

const settings = definePluginSettings({
    main: {
        type: OptionType.COMPONENT,
        component: () => { syncShowFriendsSection(); return null; }
    },
    showFriendsSection: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show a Typing section in the Friends list",
    },
    typingTimeout: {
        type: OptionType.NUMBER,
        default: 9000,
        description: "Time (ms) before typing indicator clears",
    },
});

export default definePlugin({
    name: "TypingFriends",
    description: "Shows which friends are typing across servers.",
    authors: [Devs.Xylen],
    settings: settings,

    patches: [
        {
            find: "online:t.toString()",
            replacement: {
                match: /case\s+([A-Za-z0-9_$]+\.[A-Za-z0-9_$]+)\.ONLINE:\s*return\b/,
                replace: 'case $1.TYPING:return "Typing — " + arguments[1];case $1.ONLINE:return '
            }
        },
        {
            find: "SECTION_ONLINE:",
            replacement: {
                match: /(SECTION_ONLINE:\s*\{[\s\S]*?\}\s*,)/,
                replace: '$1SECTION_TYPING:{lightSrc:n(939333),darkSrc:n(492055),width:421,height:218,renderContent:()=> (0,r.jsx)(o.SGT,{note:"No one is typing right now."})},'
            }
        },
        {
            find: "FriendsEmptyState: Invalid empty state",
            replacement: {
                match: /return\s+([A-Za-z0-9_$.]+)\.SECTION_ALL;\s*case\s+([A-Za-z0-9_$.]+)\./,
                replace: "return $1.SECTION_ALL;case $2.TYPING:return $1.SECTION_TYPING;case $2."
            }
        },
        {
            find: "#{intl::FRIENDS_SECTION_ONLINE}),className:",
            replacement: {
                match: /,{id:(\i\.\i)\.PENDING,show:.+?className:(\i\.\i)(?=\},\{id:)/,
                replace: ',{id:$1.TYPING,show:window.__friendsTypingShowSection,className:$2,content:"Typing"}$&'
            }
        },
        {
            find: '"FriendsStore"',
            replacement: {
                match:
                    /(?<=case (\i\.\i)\.SUGGESTIONS:return \d+===(\i)\.type)/,
                replace: ";case $1.TYPING:return (window.__friendsTypingShowSection && $2.type===69)"
            }
        },
        {
            find: "this.handleOpenPrivateChannel",
            replacement: {
                match: /subText:\s*\(0,\s*([A-Za-z0-9_$]+)\.jsx\)\(\s*([A-Za-z0-9_$]+\.[A-Za-z0-9_$]+)\s*,\s*\{([\s\S]*?)\}\s*\)/,
                replace:
                    'subText:(window.__typingUsers?.has(e.id)?(0,$1.jsx)("div",{children:"Typing in "+window.__typingUsers.get(e.id)}):(0,$1.jsx)($2,{$3}))'
            }
        },
    ],

    start() {
        syncShowFriendsSection();

        (window as any).__typingUsers = TYPING_USERS;
        Constants.FriendsSections.TYPING = "TYPING";

        FluxDispatcher.subscribe("TYPING_START", onTypingStart);
        FluxDispatcher.subscribe("TYPING_STOP", onTypingStop);
    },

    stop() {
        delete (window as any).__typingUsers;
        delete (window as any).__friendsTypingShowSection;

        FluxDispatcher.unsubscribe("TYPING_START", onTypingStart);
        FluxDispatcher.unsubscribe("TYPING_STOP", onTypingStop);

        const relationships = RelationshipStore.getMutableRelationships();
        for (const [id, original] of ORIGINAL_TYPES) relationships.set(id, original);

        ORIGINAL_TYPES.clear();
        RelationshipStore.emitChange();
    }
});
