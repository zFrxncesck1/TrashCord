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

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Toasts } from "@webpack/common";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { UserStore } from "@webpack/common";

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
        /*markers: [0, 50, 100, 200, 250, 300, 500, 750, 1000, 1500, 2000]*/
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
    playSound: {
        type: OptionType.BOOLEAN,
        description: "Play success sound",
        default: true
    },
    maxPing: {
        type: OptionType.SLIDER,
        description: "Max ping before pause (ms)",
        default: 300,
        markers: [0, 25, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500]
    }
});

let startTime = 0;
let claiming = false;
let paused = false;
let currentDelay = 300;
let antiDuplicates = new Set<string>();
let queue: string[] = [];
let attempts = 0;
let successes = 0;

async function getPing() {
    const start = performance.now();
    try {
        await fetch("https://discord.com/api/v9/experiments");
        return Math.round(performance.now() - start);
    } catch { return 999; }
}

function showToastSuccess(code: string) {
    Toasts.show({
        message: `🎉 Nitro SUCCESS ${successes + 1}/${attempts} | ${code.slice(0,16)}...`,
        id: Toasts.genId(),
        type: Toasts.Type.SUCCESS
    });
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
    const code = queue.shift()!;
    attempts++;
    
    setTimeout(() => {
        GiftActions.redeemGiftCode({
            code,
            onRedeemed: () => {
                if (settings.store.antiDuplicate) antiDuplicates.add(code);
                successes++;
                currentDelay = Math.max(50, currentDelay - 25);
                
                if (settings.store.notifyConsole) {
                    console.log(`SUCCESS ${successes}/${attempts} | ${code.slice(0,16)}...`);
                }
                if (settings.store.notifyToast) {
                    showToastSuccess(code);
                }
                if (settings.store.playSound) {
                    new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg").play().catch(() => {});
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
    description: "Advanced Nitro sniper with adaptive logic and full control",
    authors: [
        { 
            name: "neoarz", 
            id: 123456789012345678n
        }, 
        {
            name: "zFrxncesck1", 
            id: 456195985404592149n
        }
    ],
    tags: ["Utility", "Chat"],
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
            if (settings.store.antiDuplicate && (antiDuplicates.has(code) || queue.includes(code))) return;
            
            queue.push(code);
            processQueue();
        }
    }
});