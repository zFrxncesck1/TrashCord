export type LoadedImage = HTMLImageElement;

const MAX_ENTRIES = 500;
const CONTAINER_ID = "dsa-image-cache-container";

// Shared hidden container for every ImageCache's HTMLImageElement instances.
// `transform:scale(0)` keeps the element painted at compositor level (so the
// image decoder keeps ticking, which matters for DOM-driven fallback of
// animated images when AnimatedEmoteCache can't fetch/decode) while making
// the element visually zero-sized. This is the state that was correlated
// with "animations work" in prior testing.
function getContainer(): HTMLElement {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) return existing;
    const el = document.createElement("div");
    el.id = CONTAINER_ID;
    el.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;z-index:-9999;transform:scale(0);transform-origin:0 0;";
    document.body.appendChild(el);
    return el;
}

// LRU image cache shared by chat panel renderers. One in-flight promise per
// URL deduplicates concurrent requests. When an image finishes loading the
// owning renderer's dirty flag is flipped via `onLoaded`.
export class ImageCache {
    private cache = new Map<string, LoadedImage>();
    private inflight = new Map<string, Promise<LoadedImage | null>>();
    private container = getContainer();

    constructor(private readonly onLoaded: () => void) {}

    get(url: string): LoadedImage | null {
        const v = this.cache.get(url);
        if (v) {
            // Re-insert to mark as most-recently-used (Map preserves insertion order).
            this.cache.delete(url);
            this.cache.set(url, v);
        }
        return v ?? null;
    }

    preload(url: string): void {
        if (!url) return;
        if (this.cache.has(url)) return;
        if (this.inflight.has(url)) return;
        const p = this.doLoad(url);
        this.inflight.set(url, p);
        p.finally(() => this.inflight.delete(url));
    }

    private async doLoad(url: string): Promise<LoadedImage | null> {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.style.cssText = "position:absolute;top:0;left:0;width:auto;height:auto;";
        this.container.appendChild(img);
        try {
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error("image load failed: " + url));
                img.src = url;
            });
            this.setAndEvict(url, img);
            this.onLoaded();
            return img;
        } catch {
            try { img.remove(); } catch { /* ignore */ }
            return null;
        }
    }

    private setAndEvict(url: string, img: LoadedImage): void {
        this.cache.set(url, img);
        while (this.cache.size > MAX_ENTRIES) {
            const oldestKey = this.cache.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            const oldestImg = this.cache.get(oldestKey);
            this.cache.delete(oldestKey);
            if (oldestImg) {
                try { oldestImg.remove(); } catch { /* ignore */ }
            }
        }
    }
}
