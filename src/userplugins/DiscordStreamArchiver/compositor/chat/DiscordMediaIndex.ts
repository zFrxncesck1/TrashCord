// Finds Discord's own loaded <img>/<video> elements by URL, so getFrame can
// reuse them as drawImage sources when the user is viewing the recording
// channel. This is a pure optimization — when the channel isn't in the
// current viewport, find() returns null and the caller falls back to the
// worker-decoded bitmap cache.
//
// Why lazy: Discord virtualizes chat so the DOM holds only the currently-
// visible messages. A per-call querySelector scoped by a URL-substring
// selector is cheap (the DOM subtree is bounded) and avoids the complexity
// of a MutationObserver keeping a separate index in sync across channel
// switches, scrolls, and virtualization churn.

export class DiscordMediaIndex {
    find(url: string): HTMLImageElement | HTMLVideoElement | null {
        const key = extractKey(url);
        if (!key) return null;
        // Quote/backslash-escape for safe inclusion inside [src*="..."].
        // Other CSS attribute-string contents (slashes, dots, query chars)
        // are literal and need no escaping.
        const esc = key.replace(/[\\"]/g, "\\$&");
        const selector = `img[src*="${esc}"],video[src*="${esc}"]`;
        let el: Element | null = null;
        try { el = document.querySelector(selector); }
        catch { return null; }
        if (!el) return null;
        // CORS gate: drawImage on a non-CORS-clean element taints the
        // destination canvas. The taint propagates from chatCanvas to the
        // compositor canvas, and Chromium ends a tainted canvas's
        // captureStream video track — which corrupts the recording (audio
        // continues, video stops). Discord doesn't set crossOrigin on its
        // own DOM <img>/<video> elements (it has no canvas-safety reason
        // to), so we can almost never use this fast path safely. When the
        // attribute IS present and clean, use it; otherwise return null and
        // let the caller fall back to the worker-decoded ImageBitmap, which
        // is origin-clean because the worker fetches with mode:'cors' and
        // decodes locally from the ArrayBuffer.
        const cors = (el as HTMLImageElement | HTMLVideoElement).crossOrigin;
        if (cors !== "anonymous" && cors !== "use-credentials") return null;
        if (el instanceof HTMLImageElement) {
            return el.complete && el.naturalWidth > 0 ? el : null;
        }
        if (el instanceof HTMLVideoElement) {
            return el.readyState >= 2 && el.videoWidth > 0 ? el : null;
        }
        return null;
    }

    dispose(): void {
        // No retained state in lazy mode.
    }
}

// Extract the distinctive substring of a URL that identifies the same media
// regardless of the query-string variations Discord's client appends when it
// renders at different sizes. We match by these keys rather than full URLs
// because e.g. we preload `.../emojis/ID.gif?size=48` but Discord's own <img>
// for that emote may use `?size=96` or an animated=true/false tweak.
function extractKey(url: string): string | null {
    const emoji = url.match(/\/emojis\/(\d+)/);
    if (emoji) return `/emojis/${emoji[1]}`;
    const sticker = url.match(/\/stickers\/(\d+)/);
    if (sticker) return `/stickers/${sticker[1]}`;
    // Attachments have a signed URL; the filename is the stable part.
    const attachment = url.match(/\/attachments\/\d+\/\d+\/([^?]+)/);
    if (attachment) return `/${attachment[1]}`;
    // Tenor/external proxy: path after /external/ ends in the media filename.
    const external = url.match(/\/external\/[^/]+\/[^/]+\/[^/]+\/([^?]+)$/);
    if (external) return `/${external[1]}`;
    return null;
}
