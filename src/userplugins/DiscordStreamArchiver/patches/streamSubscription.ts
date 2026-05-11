// Headless stream subscription. Dispatches Discord's STREAM_WATCH Flux
// action for a given streamKey, which causes the RTC layer to subscribe
// to the remote stream without opening the stream viewer modal. Once the
// subscription is live, Discord's Output class processes the stream and
// our webAudioTap hook captures its MediaStream into the tap registry;
// RecordingSession.reconcileScreenshares then links it to the matching
// participant's tile.
//
// The action function lives in Discord's streaming-actions module. It's
// unnamed at the module level (minified to a single letter) but uniquely
// identifiable by two things inside its body: it dispatches
// `{type:"STREAM_WATCH"}` and references a `streamKey:` field on the
// dispatched payload. findByCodeLazy on both strings pins it down.

import { findByCodeLazy } from "@webpack";

import { logger, parseStreamKey } from "../utils";

type WatchStreamAction = (
    streamInfo: { streamType: "guild" | "call"; guildId?: string; channelId: string; ownerId: string },
    opts?: { noFocus?: boolean; forceFocus?: boolean; forceMultiple?: boolean }
) => void;

type StopWatchingAction = (streamKey: string) => void;

const watchStreamLazy = findByCodeLazy('type:"STREAM_WATCH"', "streamKey:") as WatchStreamAction;
const stopWatchingLazy = findByCodeLazy('type:"STREAM_DELETE"', "streamKey:") as unknown as StopWatchingAction;

// Refcount per-streamKey so we don't tear down Discord's subscription if
// the user has Discord's own Watch Stream viewer open at the same time as
// our silent subscription.
const silentRefCounts = new Map<string, number>();
const anyRefCounts = new Map<string, number>();

export function initStreamSubscriptionPatches(): void {
    // Action is resolved lazily on first call; this hook is kept for API
    // compatibility with index.tsx start().
    logger.info("stream subscription patches ready");
}

// Kick off Discord's stream subscription for the given streamKey. Non-async
// because the STREAM_WATCH dispatch is fire-and-forget — the resulting
// MediaStream arrives on a later tick and is captured by webAudioTap.
// Returns true if the action was invoked, false on invalid key or missing
// action. Safe to call multiple times for the same key (Discord refcounts
// internally).
export function dispatchWatchStream(streamKey: string): boolean {
    const parsed = parseStreamKey(streamKey);
    if (!parsed) {
        logger.warn(`dispatchWatchStream: invalid streamKey ${streamKey}`);
        return false;
    }
    // Discord's streamKey constructor (module 652896's `_z` export, called
    // inside the watch action as `u._z(e)`) destructures
    // `{streamType, guildId, channelId, ownerId}` — the field is streamType,
    // not type. Without it: "Unknown stream type undefined".
    const info: { streamType: "guild" | "call"; guildId?: string; channelId: string; ownerId: string } = {
        streamType: parsed.type,
        channelId: parsed.channelId,
        ownerId: parsed.userId
    };
    if (parsed.guildId) info.guildId = parsed.guildId;
    try {
        watchStreamLazy(info, { noFocus: true });
        silentRefCounts.set(streamKey, (silentRefCounts.get(streamKey) ?? 0) + 1);
        anyRefCounts.set(streamKey, (anyRefCounts.get(streamKey) ?? 0) + 1);
        logger.info(`dispatched STREAM_WATCH for ${streamKey}`);
        return true;
    } catch (err) {
        logger.warn(`dispatchWatchStream failed for ${streamKey}`, err);
        return false;
    }
}

export function dispatchStopWatching(streamKey: string): void {
    const silent = Math.max(0, (silentRefCounts.get(streamKey) ?? 1) - 1);
    const total = Math.max(0, (anyRefCounts.get(streamKey) ?? 1) - 1);
    silentRefCounts.set(streamKey, silent);
    anyRefCounts.set(streamKey, total);
    if (total > 0) return; // Discord's own viewer is still open; leave sub alive
    try {
        stopWatchingLazy(streamKey);
        silentRefCounts.delete(streamKey);
        anyRefCounts.delete(streamKey);
    } catch (err) {
        logger.warn(`dispatchStopWatching failed for ${streamKey}`, err);
    }
}

export function userTriggeredWatchNoticed(streamKey: string): void {
    anyRefCounts.set(streamKey, (anyRefCounts.get(streamKey) ?? 0) + 1);
}

export function userTriggeredWatchClosed(streamKey: string): void {
    anyRefCounts.set(streamKey, Math.max(0, (anyRefCounts.get(streamKey) ?? 1) - 1));
}

// Legacy API kept so existing callers in StreamTap.ts compile. The
// MediaStream isn't returned here — callers should look in the webAudioTap
// registry (see RecordingSession.reconcileScreenshares). subscribeSilently
// now just dispatches the watch action and resolves with placeholder tracks
// for the rare path where someone still calls it.
export interface SubscribeResult {
    streamKey: string;
    videoEl: HTMLVideoElement;
    videoTrack: MediaStreamTrack;
    audioTrack: MediaStreamTrack | null;
    dispose: () => void;
}

export async function subscribeSilently(streamKey: string): Promise<SubscribeResult> {
    const ok = dispatchWatchStream(streamKey);
    if (!ok) throw new Error(`subscribeSilently: watchStream action unavailable for ${streamKey}`);
    // Returning empty placeholders — StreamTap handles the real linking via
    // the webAudioTap registry now.
    const videoEl = document.createElement("video");
    return {
        streamKey,
        videoEl,
        videoTrack: null as unknown as MediaStreamTrack,
        audioTrack: null,
        dispose: () => dispatchStopWatching(streamKey)
    };
}
