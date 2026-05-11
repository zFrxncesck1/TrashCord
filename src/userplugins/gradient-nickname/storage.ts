import * as DataStore from "@api/DataStore";
import type { ColorStop, GradientConfig } from "./types";

const KEY = "GradientNickname_config";
const PREFS_KEY = "GradientNickname_prefs";

export interface Prefs {
    enabled: boolean;
    mutedUsers: string[];
    mutedGuilds: string[];
}

const DEFAULT_PREFS: Prefs = { enabled: true, mutedUsers: [], mutedGuilds: [] };

export async function loadPrefs(): Promise<Prefs> {
    const raw = await DataStore.get<any>(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return {
        enabled: raw.enabled ?? true,
        mutedUsers: Array.isArray(raw.mutedUsers) ? raw.mutedUsers.map(String) : [],
        mutedGuilds: Array.isArray(raw.mutedGuilds) ? raw.mutedGuilds.map(String) : [],
    };
}

export async function savePrefs(p: Prefs): Promise<void> {
    await DataStore.set(PREFS_KEY, p);
}

export async function loadConfig(): Promise<GradientConfig | null> {
    const raw = await DataStore.get<any>(KEY);
    if (!raw) return null;
    // Migrate legacy stops: string[] → ColorStop[]
    if (Array.isArray(raw.stops)) {
        raw.stops = raw.stops.map((s: any): ColorStop =>
            typeof s === "string" ? { color: s } : s
        );
    } else {
        raw.stops = [];
    }
    return raw as GradientConfig;
}

export async function saveConfig(cfg: GradientConfig): Promise<void> {
    await DataStore.set(KEY, cfg);
}

export async function clearConfig(): Promise<void> {
    await DataStore.del(KEY);
}

const listeners = new Set<(cfg: GradientConfig | null) => void>();

export function subscribe(listener: (cfg: GradientConfig | null) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function emit(cfg: GradientConfig | null): void {
    for (const l of listeners) l(cfg);
}
