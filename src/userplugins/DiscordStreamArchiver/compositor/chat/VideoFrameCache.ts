import { PluginNative } from "@utils/types";
import { logger } from "../../utils";

const Native = VencordNative.pluginHelpers.DiscordStreamArchiver as PluginNative<typeof import("../../native")>;

const MAX_ENTRIES = 30;
const CONTAINER_ID = "dsa-video-cache-container";

interface CachedVideo {
    video: HTMLVideoElement;
    blobUrl: string;
}

// Hidden DOM container for HTMLVideoElement instances used as animated
// media sources (Tenor/Giphy/Twitter gifv embeds ship MP4, not GIF, so
// HTMLImageElement can't decode them).
//
// Why not `transform:scale(0)` like ImageCache? Video playback has a
// separate optimization path from image decoding: Chromium stops updating
// the video texture when the element's compositor layer has zero area,
// even after `play()` succeeded — which left drawImage sampling frame 0
// forever. Images don't care because the image decoder ticks on paint
// regardless of compositor scale.
//
// Why not `opacity:0`? M120+ added SkipPaintingForFullyTransparent, which
// pauses paint (and cascading decoder updates) at EXACTLY opacity:0.
// `opacity:0.001` sits below human perception but above the optimization's
// threshold, so the video keeps being painted and drawImage samples the
// current frame. The 1x1 container with overflow:hidden clips whatever
// tiny speck the 0.001 would have made visible.
function getContainer(): HTMLElement {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) return existing;
    const el = document.createElement("div");
    el.id = CONTAINER_ID;
    el.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;pointer-events:none;z-index:-9999;opacity:0.001;";
    document.body.appendChild(el);
    return el;
}

export class VideoFrameCache {
    private cache = new Map<string, CachedVideo>();
    private inflight = new Map<string, Promise<HTMLVideoElement | null>>();
    private container = getContainer();

    constructor(private readonly onLoaded: () => void) {}

    // Return the video element as a drawable source if it has produced at
    // least one frame (videoWidth > 0 means metadata + first frame decoded).
    getFrame(url: string): CanvasImageSource | null {
        const entry = this.cache.get(url);
        if (!entry) return null;
        const v = entry.video;
        if (v.videoWidth === 0 || v.videoHeight === 0) return null;
        return v;
    }

    preload(url: string): void {
        if (!url) return;
        if (this.cache.has(url)) return;
        if (this.inflight.has(url)) return;
        const p = this.doLoad(url);
        this.inflight.set(url, p);
        p.finally(() => this.inflight.delete(url));
    }

    private async doLoad(url: string): Promise<HTMLVideoElement | null> {
        const video = document.createElement("video");
        // muted is required for autoplay without a user gesture in modern
        // Chromium — and we never want audio from these anyway.
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.style.cssText = "position:absolute;top:0;left:0;";
        this.container.appendChild(video);

        let blobUrl: string | null = null;
        try {
            // Fetch bytes through the main process. Tenor's Discord proxy
            // doesn't send Access-Control-Allow-Origin for .mp4 responses,
            // so a direct <video src=tenor-mp4-url> either fails the CORS
            // check (with crossOrigin="anonymous") or taints the canvas
            // (without it) — the taint ends the captureStream video track
            // and corrupts the recording. Main-process fetch has no CORS
            // policy; we wrap the bytes in a same-origin Blob URL, which
            // the <video> element loads cleanly with no canvas taint risk
            // regardless of the original server's CORS policy.
            const { bytes, mime } = await Native.fetchAsBytes(url);
            blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime || "video/mp4" }));
            await new Promise<void>((resolve, reject) => {
                video.onloadeddata = () => resolve();
                video.onerror = () => reject(new Error(`video load failed: ${url} (code=${video.error?.code ?? "?"} msg=${video.error?.message ?? "?"})`));
                video.src = blobUrl!;
            });
            // Kick playback explicitly — autoplay should have started it,
            // but some frames take a beat and we want to be sure.
            video.play().catch(err => logger.warn(`video.play failed for ${url}`, err));
            this.setAndEvict(url, { video, blobUrl });
            this.onLoaded();
            return video;
        } catch (err) {
            logger.warn(`VideoFrameCache.doLoad failed for ${url}`, err);
            try { video.remove(); } catch { /* ignore */ }
            if (blobUrl) try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
            return null;
        }
    }

    private setAndEvict(url: string, entry: CachedVideo): void {
        this.cache.set(url, entry);
        while (this.cache.size > MAX_ENTRIES) {
            const oldestKey = this.cache.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            const oldest = this.cache.get(oldestKey);
            this.cache.delete(oldestKey);
            if (oldest) disposeEntry(oldest);
        }
    }

    dispose(): void {
        for (const entry of this.cache.values()) disposeEntry(entry);
        this.cache.clear();
    }
}

function disposeEntry(entry: CachedVideo): void {
    try { entry.video.pause(); } catch { /* ignore */ }
    try { entry.video.src = ""; } catch { /* ignore */ }
    try { entry.video.remove(); } catch { /* ignore */ }
    try { URL.revokeObjectURL(entry.blobUrl); } catch { /* ignore */ }
}
