import { dispatchStopWatching, dispatchWatchStream, type SubscribeResult } from "../patches/streamSubscription";
import { getAllTappedStreams, getTappedStream } from "../patches/webAudioTap";
import { logger, parseStreamKey } from "../utils";

// streamKey formats per Discord:
//   guild:<guildId>:<channelId>:<userId>   (guild voice)
//   call:<channelId>:<userId>              (DM/group calls)
// parseStreamKey gives us the normalized userId regardless of format.
function possibleOutputIds(streamKey: string): string[] {
    const parsed = parseStreamKey(streamKey);
    const userId = parsed?.userId ?? "";
    return [
        streamKey,
        `${streamKey}:stream`,
        `${userId}_screen`,
        `${userId}/stream`,
        userId
    ].filter(Boolean);
}

function findTappedStreamForKey(streamKey: string): { id: string; stream: MediaStream } | null {
    for (const id of possibleOutputIds(streamKey)) {
        const hit = getTappedStream(id);
        if (hit && hit.stream.getVideoTracks().length > 0) {
            return { id, stream: hit.stream };
        }
    }
    // Final fallback: scan the whole registry for any stream with a video
    // track whose registry id contains the user id. Useful when Discord uses
    // an id format we haven't anticipated.
    const userId = parseStreamKey(streamKey)?.userId;
    if (userId) {
        for (const [id, tap] of getAllTappedStreams()) {
            if (id.includes(userId) && tap.stream.getVideoTracks().length > 0) {
                return { id, stream: tap.stream };
            }
        }
    }
    return null;
}

export class StreamTap {
    private result: SubscribeResult | null = null;
    private ownedVideoEl: HTMLVideoElement | null = null;
    private ownedStream: MediaStream | null = null;

    constructor(public readonly streamKey: string) {}

    async attach(): Promise<void> {
        // Prefer picking the stream up from the Web Audio tap registry,
        // which already has a reference captured via our streamSourceNode
        // hook. This avoids the subscribeSilently path which relies on
        // Discord's watchStream action being reachable (it isn't in some
        // builds, including current Vesktop).
        const tapped = findTappedStreamForKey(this.streamKey);
        logger.info(
            `stream tap attach key=${this.streamKey} registry=[${Array.from(getAllTappedStreams().keys()).join(",")}] ` +
            `registryHit=${tapped ? tapped.id : "none"}`
        );
        if (tapped) {
            this.ownedStream = tapped.stream;
            const videoEl = document.createElement("video");
            videoEl.autoplay = true;
            videoEl.muted = true;
            videoEl.playsInline = true;
            // Must stay in the composited viewport so Chromium actually runs
            // the decoder for this element. visibility:hidden keeps it in
            // layout but invisible; pointer-events:none and z-index:-9999
            // ensure it doesn't interact with or cover Discord's UI.
            videoEl.style.cssText = "position:fixed;top:0;left:0;width:640px;height:360px;visibility:hidden;pointer-events:none;z-index:-9999;";
            document.body.appendChild(videoEl);
            videoEl.srcObject = tapped.stream;
            videoEl.play().catch(err => logger.warn("streamTap play failed", err));
            this.ownedVideoEl = videoEl;
            logger.info(`stream tap attached via registry: ${this.streamKey} (video tracks=${tapped.stream.getVideoTracks().length})`);
            return;
        }

        // Stream not yet in the tap registry. Dispatch Discord's STREAM_WATCH
        // action so Discord subscribes via RTC; the resulting MediaStream
        // will flow through its Output class and be captured by webAudioTap
        // within a moment. RecordingSession.reconcileScreenshares (invoked
        // by the tap-change listener) will link it to the tile then.
        const ok = dispatchWatchStream(this.streamKey);
        if (ok) {
            logger.info(`stream tap: dispatched headless watch for ${this.streamKey}; waiting for webAudioTap to capture`);
        } else {
            logger.warn(`stream tap: could not dispatch watch action for ${this.streamKey}`);
        }
    }

    get videoEl(): HTMLVideoElement | null {
        return this.ownedVideoEl ?? this.result?.videoEl ?? null;
    }

    get videoTrack(): MediaStreamTrack | null {
        if (this.ownedStream) return this.ownedStream.getVideoTracks()[0] ?? null;
        return this.result?.videoTrack ?? null;
    }

    get audioTrack(): MediaStreamTrack | null {
        if (this.ownedStream) return this.ownedStream.getAudioTracks()[0] ?? null;
        return this.result?.audioTrack ?? null;
    }

    get audioStream(): MediaStream | null {
        if (this.ownedStream) {
            const t = this.ownedStream.getAudioTracks();
            return t.length ? new MediaStream(t) : null;
        }
        if (!this.result) return null;
        const tracks = this.result.audioTrack ? [this.result.audioTrack] : [];
        return new MediaStream(tracks);
    }

    dispose(): void {
        if (this.ownedVideoEl) {
            this.ownedVideoEl.srcObject = null;
            this.ownedVideoEl.remove();
            this.ownedVideoEl = null;
        }
        // We don't stop ownedStream's tracks — we don't own them; Discord does.
        this.ownedStream = null;
        this.result?.dispose();
        this.result = null;
        // Decrement our refcount on Discord's side. If this was the last
        // subscriber to the stream, Discord tears down the RTC subscription.
        // If Discord's own Watch Stream viewer is also open, the refcount
        // stays positive and the subscription remains alive.
        dispatchStopWatching(this.streamKey);
    }
}
