import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findByProps } from "@webpack";

function getAllGuildIds(): string[] {
    try {
        const GuildStore = findByProps("getGuilds");
        const guilds = GuildStore?.getGuilds?.() ?? {};
        return Object.keys(guilds);
    } catch {
        return [];
    }
}

const settings = definePluginSettings({
    autoDetect: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically fetch all your servers and cycle through their clan tags. When enabled, the Clans field below is ignored."
    },
    autoDetectRefreshSeconds: {
        type: OptionType.NUMBER,
        default: 60,
        description: "How often (in seconds) to re-fetch your server list when Auto-Detect is enabled. Useful if you join new servers during a session. Minimum is 10 seconds."
    },
    clans: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated server IDs to cycle through. Only used when Auto-Detect is disabled. Example: 1440451544087662767,947086569112731718"
    },
    intervalSeconds: {
        type: OptionType.NUMBER,
        default: 5,
        description: "Seconds between each clan switch. Minimum 1. Changes apply immediately without restarting."
    },
    randomize: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Pick the next clan randomly. When disabled, cycles sequentially and repeats."
    },
    enableLogs: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Print each switch and errors to the browser console (F12 → Console)."
    }
});

let active = false;
let index = 0;
let cachedGuildIds: string[] = [];
let lastFetch = 0;

function getClanList(): string[] {
    if (!settings.store.autoDetect) {
        return settings.store.clans
            .split(",")
            .map((c: string) => c.trim())
            .filter(Boolean);
    }

    const refreshMs = Math.max(10, settings.store.autoDetectRefreshSeconds || 60) * 1000;
    const now = Date.now();

    if (cachedGuildIds.length === 0 || now - lastFetch >= refreshMs) {
        cachedGuildIds = getAllGuildIds();
        lastFetch = now;
        if (settings.store.enableLogs)
            console.log(`[Clan Switcher] Auto-detect refreshed: ${cachedGuildIds.length} server(s) found.`);
    }

    return cachedGuildIds;
}

function tick() {
    if (!active) return;

    const token: string | null = findByProps("getToken")?.getToken?.() ?? null;
    if (!token) {
        scheduleNext();
        return;
    }

    const clanList = getClanList();

    if (clanList.length === 0) {
        if (settings.store.enableLogs)
            console.warn("[Clan Switcher] No IDs available. Check settings.");
        scheduleNext();
        return;
    }

    let clanId: string;
    if (settings.store.randomize) {
        clanId = clanList[Math.floor(Math.random() * clanList.length)];
    } else {
        clanId = clanList[index % clanList.length];
        index++;
    }

    fetch("https://discord.com/api/v9/users/@me/clan", {
        method: "PUT",
        headers: {
            "authorization": token,
            "content-type": "application/json",
            "x-discord-locale": "en-US",
            "x-discord-timezone": "UTC"
        },
        body: JSON.stringify({
            identity_enabled: true,
            identity_guild_id: clanId
        })
    })
        .then(async res => {
            if (!settings.store.enableLogs) return;
            if (!res.ok) {
                const body = await res.text();
                console.error(`[Clan Switcher] HTTP ${res.status} for ${clanId}: ${body}`);
            } else {
                console.log(`[Clan Switcher] Switched → ${clanId}`);
            }
        })
        .catch(err => {
            if (settings.store.enableLogs)
                console.error("[Clan Switcher] Fetch error:", err);
        })
        .finally(() => scheduleNext());
}

function scheduleNext() {
    if (!active) return;
    const ms = Math.max(1, settings.store.intervalSeconds || 5) * 1000;
    setTimeout(tick, ms);
}

export default definePlugin({
    name: "Clan Switcher",
    description: "Automatically cycles through Discord clan tags at a configurable interval.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["Servers", "Utility"],
    enabledByDefault: false,
    settings,

    start() {
        active = true;
        index = 0;
        cachedGuildIds = [];
        lastFetch = 0;
        scheduleNext();
    },

    stop() {
        active = false;
        index = 0;
        cachedGuildIds = [];
        lastFetch = 0;
    }
});