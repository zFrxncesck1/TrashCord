export interface FetchQueueOpts {
    maxConcurrent: number;
    minGapMs: number;
    backoffMs: number;
    fetcher: (userId: string) => Promise<void>;
}

export class FetchQueue {
    private opts: FetchQueueOpts;
    private pending: string[] = [];
    private inflight = new Set<string>();
    private failedAt = new Map<string, number>();
    private lastStartAt = 0;
    private tickScheduled = false;

    constructor(opts: FetchQueueOpts) {
        this.opts = opts;
    }

    enqueue(userId: string): void {
        if (this.inflight.has(userId)) return;
        if (this.pending.includes(userId)) return;

        const failedAt = this.failedAt.get(userId);
        if (failedAt !== undefined && Date.now() - failedAt < this.opts.backoffMs) return;

        this.pending.push(userId);
        this.scheduleTick();
    }

    private scheduleTick(): void {
        if (this.tickScheduled) return;
        this.tickScheduled = true;
        queueMicrotask(() => {
            this.tickScheduled = false;
            this.tick();
        });
    }

    private tick(): void {
        while (
            this.pending.length > 0 &&
            this.inflight.size < this.opts.maxConcurrent
        ) {
            const now = Date.now();
            const sinceLast = now - this.lastStartAt;
            if (sinceLast < this.opts.minGapMs) {
                setTimeout(() => this.tick(), this.opts.minGapMs - sinceLast);
                return;
            }
            const userId = this.pending.shift()!;
            this.inflight.add(userId);
            this.lastStartAt = Date.now();
            this.opts.fetcher(userId)
                .then(() => {
                    this.failedAt.delete(userId);
                })
                .catch(() => {
                    this.failedAt.set(userId, Date.now());
                })
                .finally(() => {
                    this.inflight.delete(userId);
                    this.scheduleTick();
                });
        }
    }
}
