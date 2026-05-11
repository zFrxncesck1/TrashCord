import type { GradientConfig, StoreEntry } from "./types";

export interface GradientStoreOpts {
    ttlMs: number;
    onMiss: (userId: string) => void;
}

type Listener = () => void;

export class GradientStore {
    private opts: GradientStoreOpts;
    private entries = new Map<string, StoreEntry>();
    private listeners = new Set<Listener>();

    constructor(opts: GradientStoreOpts) {
        this.opts = opts;
    }

    get(userId: string): GradientConfig | null {
        const entry = this.entries.get(userId);
        if (!entry) {
            this.opts.onMiss(userId);
            return null;
        }
        const age = Date.now() - entry.fetchedAt;
        if (age >= this.opts.ttlMs) {
            this.opts.onMiss(userId);
        }
        return entry.cfg;
    }

    set(userId: string, cfg: GradientConfig): void {
        this.entries.set(userId, { cfg, fetchedAt: Date.now() });
        this.emit();
    }

    setNull(userId: string): void {
        this.entries.set(userId, { cfg: null, fetchedAt: Date.now() });
        this.emit();
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const l of this.listeners) l();
    }
}
