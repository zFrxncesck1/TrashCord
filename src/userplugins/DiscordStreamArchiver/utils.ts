import { Logger } from "@utils/Logger";

export const logger = new Logger("DiscordStreamArchiver");

export function sanitizeFilename(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "unnamed";
    const cleaned = trimmed
        .replace(/[\/\\<>:"|?*]+/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned) return "unnamed";
    return cleaned.slice(0, 80);
}

export function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let val = bytes / 1024;
    let i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(1)} ${units[i]}`;
}

export class LruCache<K, V> {
    private map = new Map<K, V>();
    constructor(private readonly max: number) {}
    get(k: K): V | undefined {
        if (!this.map.has(k)) return undefined;
        const v = this.map.get(k)!;
        this.map.delete(k);
        this.map.set(k, v);
        return v;
    }
    set(k: K, v: V): void {
        if (this.map.has(k)) this.map.delete(k);
        this.map.set(k, v);
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value as K;
            this.map.delete(oldest);
        }
    }
}

export function toCsvCell(s: string): string {
    if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export function sessionFolderName(d: Date, channel: string, guild: string): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const y = d.getUTCFullYear();
    const mo = pad(d.getUTCMonth() + 1);
    const da = pad(d.getUTCDate());
    const h = pad(d.getUTCHours());
    const mi = pad(d.getUTCMinutes());
    const s = pad(d.getUTCSeconds());
    return `recording-${y}-${mo}-${da}_${h}-${mi}-${s}_${sanitizeFilename(channel)}_${sanitizeFilename(guild)}`;
}

// Discord stream key shapes observed in the wild:
//   guild:<guildId>:<channelId>:<userId>   (guild voice channels)
//   call:<channelId>:<userId>              (DM/group calls)
// We parse both into a normalized shape so downstream code doesn't have to
// care. Returns null on unrecognized input.
export interface ParsedStreamKey {
    type: "guild" | "call";
    guildId: string | null;
    channelId: string;
    userId: string;
}

export function parseStreamKey(streamKey: string): ParsedStreamKey | null {
    if (!streamKey) return null;
    const parts = streamKey.split(":");
    if (parts[0] === "guild" && parts.length >= 4) {
        return { type: "guild", guildId: parts[1], channelId: parts[2], userId: parts[3] };
    }
    if (parts[0] === "call" && parts.length >= 3) {
        return { type: "call", guildId: null, channelId: parts[1], userId: parts[2] };
    }
    return null;
}
