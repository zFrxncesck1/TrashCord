/*
Optimized NitroSniper customized for zFrxncesck1
Fully configurable, optimized, persistent stats, adaptive logic
*/

/*
Made with ❤️ by neoarz
I am not responsible for any damage caused by this plugin; use at your own risk
Vencord does not endorse/support this plugin (Works with Equicord as well)
https://github.com/neoarz/NitroSniper
*/

// Old Sound: https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Toasts } from "@webpack/common";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { UserStore, ChannelStore, GuildStore } from "@webpack/common";
import { showNotification } from "@api/Notifications";

const GiftActions = findByPropsLazy("redeemGiftCode");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable NitroSniper",
        default: true
    },
    scope: {
        type: OptionType.SELECT,
        description: "Where to snipe codes",
        options: [
            { label: "Servers & DMs", value: "both", default: true },
            { label: "Servers only", value: "guilds" },
            { label: "DMs only", value: "dms" }
        ]
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Redeem delay (ms)",
        default: 300,
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore your own messages",
        default: true
    },
    antiDuplicate: {
        type: OptionType.BOOLEAN,
        description: "Avoid duplicate codes",
        default: true
    },
    notifyConsole: {
        type: OptionType.BOOLEAN,
        description: "Console notifications",
        default: false
    },
    notifyToast: {
        type: OptionType.BOOLEAN,
        description: "Discord toast notifications",
        default: true
    },
    notifyNative: {
        type: OptionType.BOOLEAN,
        description: "Native notifications (synced with toast)",
        default: true
    },
    playSound: {
        type: OptionType.BOOLEAN,
        description: "Play success sound",
        default: true
    },
    maxPing: {
        type: OptionType.SLIDER,
        description: "Max ping before pause (ms)",
        default: 300,
        markers: [0, 25, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500],
        stickToMarkers: false
    }
});

interface QueueEntry {
    code: string;
    channelId: string;
    guildId?: string;
}

let startTime = 0;
let claiming = false;
let paused = false;
let currentDelay = 300;
let antiDuplicates = new Set<string>();
let queue: QueueEntry[] = [];
let attempts = 0;
let successes = 0;

function getLocation(channelId: string, guildId?: string): string {
    if (!guildId) return "DM";
    const guild = GuildStore.getGuild(guildId);
    const channel = ChannelStore.getChannel(channelId);
    const guildName = guild?.name ?? "Unknown Server";
    const channelName = channel?.name ? `#${channel.name}` : "";
    return channelName ? `${guildName} / ${channelName}` : guildName;
}

async function getPing() {
    const start = performance.now();
    try {
        await fetch("https://discord.com/api/v9/experiments");
        return Math.round(performance.now() - start);
    } catch { return 999; }
}

function notifySuccess(code: string, location: string) {
    const msg = `🎉 Nitro SUCCESS ${successes}/${attempts} | ${code.slice(0, 16)}... | ${location}`;

    if (settings.store.notifyToast) {
        Toasts.show({
            message: msg,
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS
        });
    }

    if (settings.store.notifyNative) {
        showNotification({
            title: "NitroSniper — Success!",
            body: `Code: ${code.slice(0, 16)}...\n${location}`,
        });
    }
}

async function processQueue() {
    if (!settings.store.enabled || claiming || !queue.length || paused) return;

    const ping = await getPing();
    if (ping > settings.store.maxPing) {
        paused = true;
        setTimeout(() => paused = false, 3000);
        return;
    }

    claiming = true;
    const entry = queue.shift()!;
    const { code, channelId, guildId } = entry;
    attempts++;

    setTimeout(() => {
        GiftActions.redeemGiftCode({
            code,
            onRedeemed: () => {
                if (settings.store.antiDuplicate) antiDuplicates.add(code);
                successes++;
                currentDelay = Math.max(50, currentDelay - 25);

                if (settings.store.notifyConsole) {
                    console.log(`SUCCESS ${successes}/${attempts} | ${code.slice(0, 16)}...`);
                }

                notifySuccess(code, getLocation(channelId, guildId));

                if (settings.store.playSound) {
                    new Audio("https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/omg-poco_ykiLtXO.mp3").play().catch(() => {});
                }

                claiming = false;
                processQueue();
            },
            onError: () => {
                if (settings.store.antiDuplicate) antiDuplicates.add(code);
                currentDelay = Math.min(800, currentDelay + 50);
                claiming = false;
                processQueue();
            }
        });
    }, settings.store.delay);
}

export default definePlugin({
    name: "NitroSniperOptimized",
    description: "Advanced Nitro sniper with adaptive logic and full control. ⚠️ WARNING: excessive use may trigger Discord captchas. Use at your own risk.",
    authors: [
        { name: "neoarz", id: 123456789012345678n },
        { name: "zFrxncesck1", id: 456195985404592149n }
    ],
    tags: ["Utility", "Fun", "Chat", "Nitro"],
    enabledByDefault: false,
    settings,

    start() {
        startTime = Date.now();
        queue.length = 0;
        antiDuplicates.clear();
        attempts = successes = 0;
        claiming = paused = false;
        currentDelay = settings.store.delay;
    },

    flux: {
        MESSAGE_CREATE({ message }) {
            if (!settings.store.enabled || !message.content) return;

            const isDM = !message.guild_id;
            const scope = settings.store.scope;
            if (scope === "guilds" && isDM) return;
            if (scope === "dms" && !isDM) return;

            if (settings.store.ignoreSelf && message.author?.id === UserStore.getCurrentUser()?.id) return;

            const match = message.content.match(/(?:discord\.gift\/|discord\.com\/gifts?\/)([a-zA-Z0-9]{16,24})/);
            if (!match || new Date(message.timestamp).getTime() < startTime) return;

            const code = match[1];
            if (settings.store.antiDuplicate && (antiDuplicates.has(code) || queue.some(e => e.code === code))) return;

            queue.push({ code, channelId: message.channel_id, guildId: message.guild_id });
            processQueue();
        }
    }
});
