import { Logger } from "@utils/Logger";

import {
    CONTAINER_OVERHEAD_BYTES,
    MEDIABUNNY_URL,
    MiB,
    MIN_TOTAL_BITRATE,
    MIN_VIDEO_BITRATE,
    ORIGINAL_BITRATE_SAFETY_FACTOR,
    RETRY_OVERSHOOT_RATIO,
    VIDEO_EXTENSIONS,
} from "./constants";
import { settings } from "./settings";
import type {
    AudioCodec,
    CompressionState,
    EncodeConstraints,
    EncodingPlan,
    ManagedUpload,
    MediabunnyModule,
    MediabunnyOutputFormat,
    VideoCodec,
} from "./types";

export const logger = new Logger("MediaCompressor", "#8bd5ca");

const importFromUrl = new Function("url", "return import(url);") as (url: string) => Promise<MediabunnyModule>;
let mediabunnyPromise: Promise<MediabunnyModule> | null = null;

export function debug(...args: unknown[]) {
    if (settings.store.debugLogging) logger.debug(...args);
}

export function uploadLimitBytes() {
    return settings.store.uploadLimit * MiB;
}

export function formatSize(bytes: number) {
    const value = bytes / MiB;
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} MB`;
}

function getDeltaColor(originalBytes: number, nextBytes: number) {
    if (nextBytes < originalBytes) return "var(--status-positive)";
    if (nextBytes > originalBytes) return "var(--status-danger)";
    return "var(--text-muted)";
}

export function getTintedBackground(color: string) {
    return `color-mix(in srgb, ${color} 20%, transparent)`;
}

export function getSizeChangeDetails(previousBytes: number, nextBytes: number) {
    const color = getDeltaColor(previousBytes, nextBytes);
    const percent = previousBytes <= 0
        ? 0
        : Math.round(Math.abs(nextBytes - previousBytes) / previousBytes * 100);
    const symbol = nextBytes < previousBytes
        ? "↘"
        : nextBytes > previousBytes
            ? "↗"
            : "=";

    return {
        color,
        backgroundColor: getTintedBackground(color),
        text: `${formatSize(nextBytes)}${symbol === "=" ? "" : ` (${symbol} ${percent}%)`}`,
    };
}

export function currentSignature() {
    return JSON.stringify([
        settings.store.uploadLimit,
        settings.store.videoCodec,
        settings.store.audioCodec,
        settings.store.compressionPasses,
    ]);
}

export function getCompressionPassCount() {
    return Math.min(5, Math.max(1, Math.floor(settings.store.compressionPasses || 1)));
}

export function getMediabunny() {
    mediabunnyPromise ??= importFromUrl(MEDIABUNNY_URL);
    return mediabunnyPromise;
}

export function getFileExtension(name: string) {
    const index = name.lastIndexOf(".");
    return index === -1 ? "" : name.slice(index).toLowerCase();
}

export function getOriginalFileSize(file: File) {
    return file.size;
}

export function replaceExtension(name: string, nextExtension: string) {
    const index = name.lastIndexOf(".");
    return `${index === -1 ? name : name.slice(0, index)}${nextExtension}`;
}

export function roundEven(value: number) {
    const rounded = Math.max(2, Math.round(value));
    return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

// Returns the result for the first threshold that value is below, or the fallback.
function lookup<T>(value: number, thresholds: readonly [number, T][], fallback: T): T {
    for (const [threshold, result] of thresholds) {
        if (value < threshold) return result;
    }
    return fallback;
}

export function isCompressibleFile(file: File) {
    return file.type.startsWith("video/") || VIDEO_EXTENSIONS.has(getFileExtension(file.name));
}

export function isCompressibleUpload(upload: ManagedUpload) {
    return Boolean(upload?.item?.file) && (upload.isVideo || isCompressibleFile(upload.item.file));
}

export function buildProgressLabel(state: CompressionState) {
    const targetLabel = formatSize(uploadLimitBytes());

    switch (state.status) {
        case "preparing":
            return `Preparing for ${targetLabel}`;
        case "compressing":
            return `Compressing ${Math.round(state.progress * 100)}% -> ${targetLabel}`;
        case "done":
            return "Compressing ready";
        case "failed":
            return state.error ?? "Compression failed";
        default:
            return state.enabled ? `Queued for ${targetLabel}` : "Compression disabled";
    }
}

function pickMaxDimension(totalBitrate: number) {
    return lookup(totalBitrate, [
        [260_000, 360],
        [600_000, 480],
        [1_300_000, 720],
        [2_800_000, 1080],
    ], 1440);
}

function defaultAudioBitrate(codec: AudioCodec) {
    switch (codec) {
        case "opus":
            return 96_000;
        case "vorbis":
            return 112_000;
        case "mp3":
            return 128_000;
        case "aac":
        default:
            return 128_000;
    }
}

export function minAudioBitrate(codec: AudioCodec) {
    switch (codec) {
        case "opus":
            return 24_000;
        case "vorbis":
            return 32_000;
        case "mp3":
            return 40_000;
        case "aac":
        default:
            return 32_000;
    }
}

function isMp4VideoCodec(codec: VideoCodec) {
    return codec === "avc" || codec === "hevc";
}

function getInitialBitrateSafetyFactor(oversizeRatio: number, requestedPassCount: number) {
    const oversizeSafetyFactor = lookup(oversizeRatio, [
        [1.15, 0.92],
        [1.35, 0.88],
        [1.75, 0.84],
        [2.5, 0.8],
    ], 0.74);
    const passCountSafetyFactor = requestedPassCount <= 1
        ? 0.84
        : requestedPassCount === 2
            ? 0.88
            : 0.92;

    return Math.min(oversizeSafetyFactor, passCountSafetyFactor);
}

export function getInitialTargetBitrate(limitBytes: number, duration: number, oversizeRatio: number, requestedPassCount: number) {
    return Math.max(
        MIN_TOTAL_BITRATE,
        Math.floor((Math.max(limitBytes - CONTAINER_OVERHEAD_BYTES, limitBytes * 0.84) * 8 / duration) * getInitialBitrateSafetyFactor(oversizeRatio, requestedPassCount))
    );
}

export function getCloseEnoughMarginBytes(limitBytes: number) {
    return Math.max(64 * 1024, Math.floor(limitBytes * 0.01));
}

export function getNextDesiredTotalBitrate(options: {
    currentBitrate: number;
    currentBytes: number;
    limitBytes: number;
    bestUnderLimitBitrate?: number;
    smallestOverLimitBitrate?: number;
    requestedPassCount: number;
}) {
    const {
        currentBitrate,
        currentBytes,
        limitBytes,
        bestUnderLimitBitrate,
        smallestOverLimitBitrate,
        requestedPassCount,
    } = options;

    if (bestUnderLimitBitrate != null && smallestOverLimitBitrate != null && bestUnderLimitBitrate < smallestOverLimitBitrate) {
        return Math.floor((bestUnderLimitBitrate + smallestOverLimitBitrate) / 2);
    }

    if (currentBytes > limitBytes) {
        return Math.max(
            MIN_TOTAL_BITRATE,
            Math.floor(currentBitrate * clamp(limitBytes / (Math.max(currentBytes, 1) * RETRY_OVERSHOOT_RATIO), 0.36, 0.78))
        );
    }

    return Math.max(
        MIN_TOTAL_BITRATE,
        Math.floor(currentBitrate * clamp(limitBytes / Math.max(currentBytes, 1), 1.04, requestedPassCount <= 1 ? 1.08 : 1.14))
    );
}

export async function resolveCodecs(mediabunny: MediabunnyModule, constraints: EncodeConstraints): Promise<{
    format: MediabunnyOutputFormat;
    videoCodec: VideoCodec;
    audioCodec: AudioCodec | null;
}> {
    const preferredVideoCodec = settings.store.videoCodec as VideoCodec;
    const preferredAudioCodec = settings.store.audioCodec as AudioCodec;

    const primaryFormat = isMp4VideoCodec(preferredVideoCodec)
        ? new mediabunny.Mp4OutputFormat({})
        : new mediabunny.WebMOutputFormat({});

    let selectedFormat = primaryFormat;
    let selectedVideoCodec: VideoCodec | null = preferredVideoCodec;

    if (!selectedFormat.getSupportedVideoCodecs().includes(selectedVideoCodec)
        || !await mediabunny.canEncodeVideo(selectedVideoCodec, constraints)) {
        selectedVideoCodec = await mediabunny.getFirstEncodableVideoCodec(selectedFormat.getSupportedVideoCodecs(), constraints);
    }

    if (!selectedVideoCodec) {
        selectedFormat = selectedFormat instanceof mediabunny.Mp4OutputFormat
            ? new mediabunny.WebMOutputFormat({})
            : new mediabunny.Mp4OutputFormat({});
        selectedVideoCodec = await mediabunny.getFirstEncodableVideoCodec(selectedFormat.getSupportedVideoCodecs(), constraints);
    }

    if (!selectedVideoCodec) {
        throw new Error("This browser could not encode the selected video with any supported codec.");
    }

    let selectedAudioCodec: AudioCodec | null = preferredAudioCodec;
    if (!selectedFormat.getSupportedAudioCodecs().includes(selectedAudioCodec)
        || !await mediabunny.canEncodeAudio(selectedAudioCodec, constraints.sampleRate ? { sampleRate: constraints.sampleRate } : undefined)) {
        selectedAudioCodec = await mediabunny.getFirstEncodableAudioCodec(selectedFormat.getSupportedAudioCodecs(), constraints.sampleRate ? { sampleRate: constraints.sampleRate } : undefined);
    }

    return {
        format: selectedFormat,
        videoCodec: selectedVideoCodec,
        audioCodec: selectedAudioCodec,
    };
}

export function buildEncodingPlan(options: {
    duration: number;
    displayWidth: number;
    displayHeight: number;
    originalBytes: number;
    targetBytes: number;
    attemptIndex: number;
    passCount: number;
    sourceFrameRate?: number;
    sourceSampleRate?: number;
    sourceChannels?: number;
    audioTrackCount: number;
    desiredTotalBitrate: number;
    audioCodec: AudioCodec | null;
    hasAudio: boolean;
}): EncodingPlan {
    const {
        duration,
        displayWidth,
        displayHeight,
        originalBytes,
        targetBytes,
        attemptIndex,
        passCount,
        sourceFrameRate,
        sourceSampleRate,
        sourceChannels,
        audioTrackCount,
        desiredTotalBitrate,
        audioCodec,
        hasAudio,
    } = options;

    const originalTotalBitrate = Math.max(MIN_TOTAL_BITRATE, Math.floor(originalBytes * 8 / duration));
    const oversizeRatio = Math.max(1, originalBytes / Math.max(targetBytes, 1));
    const qualityRetention = lookup(oversizeRatio, [
        [1.15, 1],
        [1.35, 0.98],
        [1.75, 0.92],
        [2.5, 0.84],
        [4, 0.7],
    ], 0.56);
    const cappedTotalBitrate = Math.min(
        desiredTotalBitrate,
        Math.floor(originalTotalBitrate * Math.min(ORIGINAL_BITRATE_SAFETY_FACTOR, qualityRetention))
    );
    const bitsPerPixelFrame = cappedTotalBitrate / Math.max(displayWidth * displayHeight * Math.max(sourceFrameRate ?? 30, 12), 1);
    const sourceMaxDimension = Math.max(displayWidth, displayHeight);
    const bitrateSuggestedDimension = Math.min(sourceMaxDimension, Math.max(224, pickMaxDimension(cappedTotalBitrate)));
    const preservationBias = lookup(oversizeRatio, [
        [1.15, 1],
        [1.35, 0.98],
        [1.75, 0.95],
        [2.5, 0.92],
        [4, 0.88],
    ], 0.82);
    const passPenalty = attemptIndex === 0
        ? 1
        : 1 - (attemptIndex / Math.max(passCount - 1, 1)) * (oversizeRatio > 4 ? 0.24 : oversizeRatio > 2.5 ? 0.18 : oversizeRatio > 1.75 ? 0.12 : 0.08);
    const preferredMaxDimension = Math.round(sourceMaxDimension * clamp(
        Math.min(preservationBias, passPenalty),
        0.62,
        1
    ));
    const maxDimension = Math.min(sourceMaxDimension, Math.max(bitrateSuggestedDimension, preferredMaxDimension));
    const scale = Math.min(1, maxDimension / Math.max(displayWidth, displayHeight));
    const width = roundEven(displayWidth * scale);
    const height = roundEven(displayHeight * scale);
    const shouldCompressAudio = oversizeRatio > 10;
    const audioCompressionIntensity = shouldCompressAudio
        ? Math.min(1, (oversizeRatio - 10) / 10)
        : 0;
    const maxAudioBudget = Math.max(0, Math.floor(cappedTotalBitrate * (
        !shouldCompressAudio
            ? audioTrackCount > 1 ? 0.34 : 0.26
            : audioTrackCount > 1
                ? 0.34 - 0.14 * audioCompressionIntensity
                : 0.26 - 0.12 * audioCompressionIntensity
    )));

    let audioBitrate = 0;
    let sampleRate: number | undefined;
    let numberOfChannels: number | undefined;

    if (hasAudio && audioCodec) {
        const preferredAudioBitrate = shouldCompressAudio
            ? Math.min(defaultAudioBitrate(audioCodec), Math.floor(cappedTotalBitrate * (
                audioTrackCount > 1
                    ? 0.18 - 0.08 * audioCompressionIntensity
                    : 0.14 - 0.06 * audioCompressionIntensity
            )))
            : defaultAudioBitrate(audioCodec);
        const minAllowedAudioBitrate = Math.min(minAudioBitrate(audioCodec), maxAudioBudget);

        audioBitrate = clamp(
            preferredAudioBitrate,
            minAllowedAudioBitrate,
            Math.max(minAllowedAudioBitrate, maxAudioBudget)
        );

        sampleRate = sourceSampleRate;
        numberOfChannels = sourceChannels;

        if (shouldCompressAudio) {
            if (oversizeRatio > 18 || cappedTotalBitrate < 180_000) {
                sampleRate = sourceSampleRate ? Math.min(sourceSampleRate, 24_000) : 24_000;
                numberOfChannels = sourceChannels ? Math.min(sourceChannels, 1) : 1;
            } else if (oversizeRatio > 14 || cappedTotalBitrate < 260_000) {
                sampleRate = sourceSampleRate ? Math.min(sourceSampleRate, 32_000) : 32_000;
            } else if (oversizeRatio > 10.5 || cappedTotalBitrate < 360_000) {
                sampleRate = sourceSampleRate ? Math.min(sourceSampleRate, 44_100) : 44_100;
            }
        }
    }

    const frameRate = sourceFrameRate == null
        ? undefined
        : oversizeRatio < 1.2
            ? sourceFrameRate
            : oversizeRatio > 4
                ? Math.min(sourceFrameRate, attemptIndex === 0 ? 18 : attemptIndex === 1 ? 15 : 12)
                : oversizeRatio > 2.5
                    ? Math.min(sourceFrameRate, attemptIndex === 0 ? 24 : 20)
                    : oversizeRatio > 1.75
                        ? Math.min(sourceFrameRate, attemptIndex === 0 ? 30 : 24)
                        : Math.min(sourceFrameRate, 30);

    const videoBitrate = Math.max(MIN_VIDEO_BITRATE, cappedTotalBitrate - audioBitrate - 24_000);
    const estimatedBytes = duration * (videoBitrate + audioBitrate) / 8 + CONTAINER_OVERHEAD_BYTES;

    return {
        width,
        height,
        frameRate,
        audioBitrate,
        videoBitrate,
        sampleRate,
        numberOfChannels,
        estimatedBytes,
        totalBitrate: cappedTotalBitrate,
        oversizeRatio,
        bitsPerPixelFrame,
    };
}
