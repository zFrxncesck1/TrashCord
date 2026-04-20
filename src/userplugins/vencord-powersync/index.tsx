/* Fixxed by zFrxncesck1 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

const RunningGameStore = findByPropsLazy("getRunningGames");

const STANDARDS = {
    BALANCED: "381b4222-f694-41f0-9685-ff5bb260df2e",
    HIGH_PERF: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
    POWER_SAVER: "a1841308-3541-4fab-bc81-f71556f20b4a"
};

const settings = definePluginSettings({
    planMode: {
        description: "Select power plan for gaming",
    tags: ["Utility", "Developers"],
    enabledByDefault: false,
        type: OptionType.SELECT,
        options: [
            { label: "High Performance", value: STANDARDS.HIGH_PERF },
            { label: "Balanced", value: STANDARDS.BALANCED },
            { label: "Power Saver", value: STANDARDS.POWER_SAVER },
            { label: "Custom (GUID)", value: "custom" }
        ],
        default: STANDARDS.HIGH_PERF
    },
    customGuid: {
        description: "Your custom GUID (if 'Custom' is selected)",
        type: OptionType.STRING,
        default: ""
    },
    blacklist: {
        description: "Ignored processes — comma-separated, e.g: spotify.exe, code.exe",
        type: OptionType.STRING,
        default: "spotify.exe, chrome.exe"
    },
    onlyOnAC: {
        description: "Only switch plan when plugged into AC power (laptops)",
        type: OptionType.BOOLEAN,
        default: false
    },
    restorePrevious: {
        description: "Restore previous plan when game closes",
        type: OptionType.BOOLEAN,
        default: true
    }
});

const state = {
    isBoosted: false,
    originalPlan: null as string | null,
    activeGames: new Set<string>()
};

function resolveGuid(raw: unknown): string {
    if (typeof raw === "string") return raw;
    if (typeof raw === "object" && raw !== null) return (raw as any).value ?? "";
    return String(raw ?? "");
}

async function updatePowerPlan(isGameRunning: boolean) {
    const native = (VencordNative as any).pluginHelpers?.PowerSync;

    if (!native) {
        console.error("[PowerSync] Native module not found");
        return;
    }

    if (isGameRunning && !state.isBoosted) {
        if (settings.store.onlyOnAC) {
            const onAC = await native.isOnACPower();
            if (!onAC) {
                console.log("[PowerSync] On battery, skipping plan switch");
                return;
            }
        }

        state.originalPlan = await native.getActivePlan();

        const resolvedMode = resolveGuid(settings.store.planMode);
        const target = resolvedMode === "custom"
            ? resolveGuid(settings.store.customGuid)
            : resolvedMode;

        if (resolvedMode === "custom" && !target) {
            console.warn("[PowerSync] Custom mode selected but no GUID provided");
            return;
        }

        const error = await native.setPowerPlan(target);
        if (error === null) {
            state.isBoosted = true;
            console.log("[PowerSync] Switched to plan:", target);
        } else {
            console.error("[PowerSync] Failed to switch plan:", error);
        }
    } else if (!isGameRunning && state.isBoosted) {
        if (settings.store.restorePrevious && state.originalPlan) {
            const error = await native.setPowerPlan(state.originalPlan);
            if (error === null) {
                console.log("[PowerSync] Restored original plan");
            } else {
                console.error("[PowerSync] Failed to restore plan:", error);
            }
        }
        state.isBoosted = false;
        state.originalPlan = null;
    }
}

function isBlacklisted(game: any): boolean {
    const blacklist = settings.store.blacklist
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);

    const displayName = (game.name ?? "").toLowerCase();
    const exeName = (game.exeName ?? "").toLowerCase();

    return blacklist.some(b => displayName.includes(b) || exeName.includes(b));
}

function handleGamesChange(event: any) {
    const added: any[] = event?.added ?? [];
    const removed: any[] = event?.removed ?? [];

    for (const game of added) {
        if (!isBlacklisted(game)) {
            state.activeGames.add(game.id);
            console.log("[PowerSync] Game added:", game.exeName);
        } else {
            console.log("[PowerSync] Game blacklisted, skipping:", game.exeName);
        }
    }

    for (const game of removed) {
        if (!state.activeGames.has(game.id)) {
            console.log("[PowerSync] Game was already running before plugin start, skipping restore:", game.exeName);
            continue;
        }
        state.activeGames.delete(game.id);
        console.log("[PowerSync] Game removed:", game.exeName);
    }

    updatePowerPlan(state.activeGames.size > 0);
}

export default definePlugin({
    name: "PowerSync",
    description: "Automatically switches Windows power plans when a game is detected.",
    authors: [{ name: "unclide", id: "395504896817758210" }],
    settings,

    start() {
        console.log("[PowerSync] Starting...");
        state.activeGames.clear();
        FluxDispatcher.subscribe("RUNNING_GAMES_CHANGE", handleGamesChange);

        setTimeout(() => {
            const currentGames = RunningGameStore?.getRunningGames() ?? [];
            console.log("[PowerSync] Games already running at start:", currentGames.length);
            for (const game of currentGames) {
                if (!isBlacklisted(game)) state.activeGames.add(game.id);
            }
            updatePowerPlan(state.activeGames.size > 0);
        }, 1000);
    },

    stop() {
        FluxDispatcher.unsubscribe("RUNNING_GAMES_CHANGE", handleGamesChange);
        state.activeGames.clear();
        updatePowerPlan(false);
        console.log("[PowerSync] Stopped");
    }
});