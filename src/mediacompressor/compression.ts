import { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { DraftType } from "@vencord/discord-types/enums";
import { findLazy } from "@webpack";
import { showToast, Toasts, UploadAttachmentStore } from "@webpack/common";

import { COMPRESS_SYMBOL, ORIGINAL_GET_SIZE_SYMBOL } from "./constants";
import { settings } from "./settings";
import type {
    CloudUploadItem,
    CompressionAttemptResult,
    CompressionState,
    ManagedUpload,
} from "./types";
import {
    buildEncodingPlan,
    currentSignature,
    debug,
    formatSize,
    getCloseEnoughMarginBytes,
    getCompressionPassCount,
    getFileExtension,
    getInitialTargetBitrate,
    getMediabunny,
    getNextDesiredTotalBitrate,
    getSizeChangeDetails,
    isCompressibleFile,
    isCompressibleUpload,
    logger,
    minAudioBitrate,
    replaceExtension,
    resolveCodecs,
    roundEven,
    uploadLimitBytes,
} from "./utils";

const CloudUploadCtor: typeof TCloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

export const uploadStates = new WeakMap<ManagedUpload, CompressionState>();
export const allStates = new Set<CompressionState>();
let lastBlockedSendToastAt = 0;

export function emitState(state: CompressionState) {
    for (const listener of [...state.listeners]) {
        listener();
    }
}

function shouldAutoEnable(upload: ManagedUpload) {
    return settings.store.autoCompressWhenAboveLimit && upload.item.file.size > uploadLimitBytes();
}

function syncUploadSizeAccess(upload: ManagedUpload) {
    upload[ORIGINAL_GET_SIZE_SYMBOL] ??= upload.getSize?.bind(upload);
    upload.getSize = function () {
        return this.item?.file?.size ?? this.currentSize ?? 0;
    };
}

export function ensureState(upload: ManagedUpload) {
    let state = uploadStates.get(upload);
    if (state) return state;

    state = {
        upload,
        listeners: new Set(),
        originalFile: upload.item.file,
        originalName: upload.filename,
        originalMimeType: upload.mimeType || upload.item.file.type,
        enabled: upload[COMPRESS_SYMBOL] ?? shouldAutoEnable(upload),
        status: "idle",
        progress: 0,
        lastApplied: "original",
    };

    syncUploadSizeAccess(upload);

    upload[COMPRESS_SYMBOL] = state.enabled;
    uploadStates.set(upload, state);
    allStates.add(state);
    return state;
}

export function subscribeToUpload(upload: ManagedUpload, listener: () => void) {
    const state = ensureState(upload);
    state.listeners.add(listener);
    return () => {
        state.listeners.delete(listener);
    };
}

function applyFileToUpload(upload: ManagedUpload, file: File, fallbackName: string) {
    syncUploadSizeAccess(upload);
    upload.item.file = file;
    upload.filename = file.name || fallbackName;
    upload.mimeType = file.type;
    upload.currentSize = file.size;
}

function buildUploadItemFrom(state: CompressionState, file: File) {
    return {
        ...state.upload.item,
        file,
    } as CloudUploadItem;
}

function touchUploadItem(upload: ManagedUpload) {
    // Intentional self-assignment to trigger reactive proxy setters or change detection
    upload.item.platform = upload.item.platform;
}

function copyUploadPresentation(source: ManagedUpload, target: ManagedUpload, file: File) {
    target.filename = file.name || source.filename;
    target.description = source.description;
    target.spoiler = source.spoiler;
    target.sensitive = source.sensitive;
    target.mimeType = file.type || source.mimeType;
    target.currentSize = file.size;
    target.preCompressionSize = source.preCompressionSize;
    target.postCompressionSize = source.postCompressionSize;
    target.isVideo = source.isVideo;
    target.isImage = source.isImage;
    target.classification = source.classification;
    target.durationSecs = source.durationSecs;
    target.waveform = source.waveform;
}

export function clearCompressionResult(state: CompressionState) {
    state.compressedFile = undefined;
    state.estimatedOutputBytes = undefined;
    state.currentPass = undefined;
    state.previousPassBytes = undefined;
    state.latestPassBytes = undefined;
}

export function applyOriginalFile(state: CompressionState) {
    applyFileToUpload(state.upload, state.originalFile, state.originalName);
    state.upload.preCompressionSize = state.originalFile.size;
    state.upload.postCompressionSize = state.compressedFile?.size;
    state.upload.isVideo = true;
    state.upload.isImage = false;
    touchUploadItem(state.upload);
    state.lastApplied = "original";
}

export function applyCompressedFile(state: CompressionState) {
    if (!state.compressedFile) return;

    applyFileToUpload(state.upload, state.compressedFile, replaceExtension(state.originalName, getFileExtension(state.compressedFile.name) || ".mp4"));
    state.upload.preCompressionSize = state.originalFile.size;
    state.upload.postCompressionSize = state.compressedFile.size;
    state.upload.isVideo = true;
    state.upload.isImage = false;
    touchUploadItem(state.upload);
    state.lastApplied = "compressed";
}

export function getCompletedSummary(state: CompressionState) {
    if (!state.compressedFile) return null;

    const change = getSizeChangeDetails(state.originalFile.size, state.compressedFile.size);

    return {
        originalSize: formatSize(state.originalFile.size),
        compressedSize: change.text,
        color: change.color,
        backgroundColor: change.backgroundColor,
    };
}

export async function cancelCompression(state: CompressionState) {
    state.token = Symbol("mediaCompressor-cancelled");

    if (state.conversion) {
        await state.conversion.cancel();
    }

    state.conversion = undefined;
    state.pendingPromise = undefined;
}

function createUploadForSend(upload: ManagedUpload) {
    const state = uploadStates.get(upload);
    const file = state?.enabled && state.compressedFile ? state.compressedFile : state?.originalFile ?? upload.item.file;
    const nextUpload = new CloudUploadCtor(buildUploadItemFrom(state ?? ensureState(upload), file), upload.channelId) as ManagedUpload;

    copyUploadPresentation(upload, nextUpload, file);
    syncUploadSizeAccess(nextUpload);
    nextUpload[COMPRESS_SYMBOL] = state?.enabled ?? upload[COMPRESS_SYMBOL];

    return nextUpload;
}

export function syncUploadsForSend(uploads: ManagedUpload[]) {
    for (let i = 0; i < uploads.length; i++) {
        if (!isCompressibleUpload(uploads[i])) continue;
        uploads[i] = createUploadForSend(uploads[i]);
    }
}

async function compressUpload(upload: ManagedUpload) {
    const state = ensureState(upload);
    const signature = currentSignature();

    if (!state.enabled || !isCompressibleUpload(upload)) {
        applyOriginalFile(state);
        emitState(state);
        return;
    }

    if (state.compressedFile && state.signature === signature) {
        applyCompressedFile(state);
        state.status = "done";
        state.progress = 1;
        emitState(state);
        return;
    }

    if (state.status === "compressing" || state.status === "preparing") {
        return;
    }

    await cancelCompression(state);

    state.signature = signature;
    state.error = undefined;
    state.status = "preparing";
    state.progress = 0;
    clearCompressionResult(state);
    state.resolvedAudioCodec = undefined;
    state.resolvedVideoCodec = undefined;

    const token = Symbol("mediaCompressor-job");
    state.token = token;
    emitState(state);

    state.pendingPromise = (async () => {
        const mediabunny = await getMediabunny();
        const createInput = () => new mediabunny.Input({
            formats: mediabunny.ALL_FORMATS,
            source: new mediabunny.BlobSource(state.originalFile),
        });
        const disposeInput = (inputLike: { [Symbol.dispose]?: () => void; }) => {
            inputLike[Symbol.dispose]?.();
        };

        const analysisInput = createInput();

        const duration = await (async () => {
            try {
                return Math.max(await analysisInput.computeDuration(), 1);
            } finally {
                disposeInput(analysisInput);
            }
        })();

        const metadataInput = createInput();

        try {
            const videoTrack = await metadataInput.getPrimaryVideoTrack();
            const audioTracks = await metadataInput.getAudioTracks();
            const audioTrack = audioTracks[0];

            if (!videoTrack) {
                throw new Error("MediaBunny could not detect a video track for this file.");
            }

            const displayWidth = videoTrack.displayWidth || 1280;
            const displayHeight = videoTrack.displayHeight || 720;
            const hardLimitBytes = uploadLimitBytes();
            const oversizeRatio = Math.max(1, state.originalFile.size / Math.max(hardLimitBytes, 1));
            const requestedPassCount = getCompressionPassCount();
            const compressionPassCount = Math.max(requestedPassCount, 2);
            const firstPassTargetBitrate = getInitialTargetBitrate(hardLimitBytes, duration, oversizeRatio, requestedPassCount);
            const closeEnoughMarginBytes = getCloseEnoughMarginBytes(hardLimitBytes);

            const { format, videoCodec, audioCodec } = await resolveCodecs(mediabunny, {
                width: roundEven(displayWidth),
                height: roundEven(displayHeight),
                sampleRate: audioTrack?.sampleRate,
            });

            state.resolvedVideoCodec = videoCodec;
            state.resolvedAudioCodec = audioCodec ?? undefined;
            let observedBytes = 0;
            let latestCandidate: CompressionAttemptResult | undefined;
            let bestUnderLimit: CompressionAttemptResult | undefined;
            let smallestOverLimit: CompressionAttemptResult | undefined;
            let oversizeAttemptCount = 0;
            let nextDesiredTotalBitrate = firstPassTargetBitrate;

            for (let attempt = 0; attempt < compressionPassCount; attempt++) {
                const plan = buildEncodingPlan({
                    duration,
                    displayWidth,
                    displayHeight,
                    originalBytes: state.originalFile.size,
                    targetBytes: hardLimitBytes,
                    attemptIndex: oversizeAttemptCount,
                    passCount: compressionPassCount,
                    sourceFrameRate: typeof videoTrack.frameRate === "number" ? videoTrack.frameRate : undefined,
                    sourceSampleRate: typeof audioTrack?.sampleRate === "number" ? audioTrack.sampleRate : undefined,
                    sourceChannels: typeof audioTrack?.numberOfChannels === "number" ? audioTrack.numberOfChannels : undefined,
                    audioTrackCount: audioTracks.length,
                    desiredTotalBitrate: nextDesiredTotalBitrate,
                    audioCodec,
                    hasAudio: Boolean(audioTracks.length && audioCodec),
                });

                state.estimatedOutputBytes = plan.estimatedBytes;
                state.currentPass = attempt + 1;

                debug("Compression plan", {
                    attempt: attempt + 1,
                    hardLimitBytes,
                    requestedTotalBitrate: nextDesiredTotalBitrate,
                    totalBitrate: plan.totalBitrate,
                    estimatedBytes: plan.estimatedBytes,
                    oversizeAttemptCount,
                    width: plan.width,
                    height: plan.height,
                    frameRate: plan.frameRate,
                    audioBitrate: plan.audioBitrate,
                    videoBitrate: plan.videoBitrate,
                    sampleRate: plan.sampleRate,
                    numberOfChannels: plan.numberOfChannels,
                    audioTrackCount: audioTracks.length,
                    oversizeRatio: plan.oversizeRatio,
                });

                const makeConversion = async (preferSelectedAudioCodec: boolean) => {
                    const conversionInput = createInput();
                    const outputTarget = new mediabunny.BufferTarget();
                    observedBytes = 0;
                    outputTarget.onwrite = (_start: number, end: number) => {
                        observedBytes = Math.max(observedBytes, end);
                    };

                    const output = new mediabunny.Output({
                        format,
                        target: outputTarget,
                    });

                    try {
                        const conversion = await mediabunny.Conversion.init({
                            input: conversionInput,
                            output,
                            video: track => ({
                                discard: track.number > 1,
                                codec: videoCodec,
                                bitrate: plan.videoBitrate,
                                width: plan.width,
                                height: plan.height,
                                fit: "contain",
                                frameRate: plan.frameRate,
                                forceTranscode: true,
                            }),
                            audio: audioTracks.length
                                ? (_track, n) => {
                                    if (n > 1) {
                                        return { discard: true };
                                    }

                                    return {
                                        codec: preferSelectedAudioCodec ? audioCodec ?? undefined : undefined,
                                        bitrate: Math.max(minAudioBitrate(audioCodec ?? "aac"), plan.audioBitrate),
                                        sampleRate: plan.sampleRate,
                                        numberOfChannels: plan.numberOfChannels,
                                        forceTranscode: true,
                                    };
                                }
                                : undefined,
                            tags: {},
                        });

                        return { conversion, outputTarget, input: conversionInput };
                    } catch (error) {
                        disposeInput(conversionInput);
                        throw error;
                    }
                };

                let { conversion, outputTarget, input: conversionInput } = await makeConversion(true);

                const audioCodecDiscarded = conversion.discardedTracks?.some(discarded =>
                    discarded?.reason === "no_encodable_target_codec"
                    && audioTracks.some(audioTrackEntry => audioTrackEntry.number === discarded?.track?.number)
                );

                if ((!conversion.isValid || audioCodecDiscarded) && audioTracks.length) {
                    debug("Retrying conversion init with automatic audio codec selection", {
                        discardedTracks: conversion.discardedTracks,
                    });
                    disposeInput(conversionInput);
                    ({ conversion, outputTarget, input: conversionInput } = await makeConversion(false));
                }

                try {
                    if (!conversion.isValid) {
                        throw new Error(`Conversion was rejected by MediaBunny: ${conversion.discardedTracks?.map(track => track.reason).join(", ") || "unknown reason"}`);
                    }

                    state.conversion = conversion;
                    state.status = "compressing";
                    emitState(state);

                    conversion.onProgress = (progress: number) => {
                        if (state.token !== token) return;
                        state.progress = (attempt + progress) / compressionPassCount;
                        emitState(state);
                    };

                    await conversion.execute();

                    if (state.token !== token) return;

                    const outputBlob = new Blob([outputTarget.buffer], { type: format.mimeType });
                    const candidateFile = new File(
                        [outputBlob],
                        replaceExtension(state.originalName, format.fileExtension),
                        { type: format.mimeType, lastModified: Date.now() }
                    );

                    debug("Compression attempt result", {
                        attempt: attempt + 1,
                        outputBytes: candidateFile.size,
                        outputSize: formatSize(candidateFile.size),
                        observedBytes,
                        hardLimitBytes,
                        hardLimitSize: formatSize(hardLimitBytes),
                        underHardLimit: candidateFile.size <= hardLimitBytes,
                        deltaFromLimitBytes: candidateFile.size - hardLimitBytes,
                    });

                    const candidate: CompressionAttemptResult = {
                        file: candidateFile,
                        observedBytes,
                        plan,
                    };

                    const previousPassBytes = latestCandidate?.file.size ?? state.originalFile.size;

                    state.previousPassBytes = previousPassBytes;
                    state.latestPassBytes = candidateFile.size;

                    latestCandidate = candidate;
                    emitState(state);

                    if (candidateFile.size <= hardLimitBytes) {
                        if (!bestUnderLimit || candidateFile.size > bestUnderLimit.file.size) {
                            bestUnderLimit = candidate;
                        }

                        debug("Stored successful compression pass", {
                            attempt: attempt + 1,
                            outputBytes: candidateFile.size,
                            outputSize: formatSize(candidateFile.size),
                            hardLimitBytes,
                        });
                    } else if (!smallestOverLimit || candidateFile.size < smallestOverLimit.file.size) {
                        smallestOverLimit = candidate;
                    }

                    const isUnderLimit = candidateFile.size <= hardLimitBytes;
                    const isCloseEnough = isUnderLimit && hardLimitBytes - candidateFile.size <= closeEnoughMarginBytes;
                    const hasAttemptsRemaining = attempt < compressionPassCount - 1;

                    if (!hasAttemptsRemaining || isCloseEnough) break;

                    const nextBitrate = getNextDesiredTotalBitrate({
                        currentBitrate: plan.totalBitrate,
                        currentBytes: candidateFile.size,
                        limitBytes: hardLimitBytes,
                        bestUnderLimitBitrate: bestUnderLimit?.plan.totalBitrate,
                        smallestOverLimitBitrate: smallestOverLimit?.plan.totalBitrate,
                        requestedPassCount,
                    });

                    if (Math.abs(nextBitrate - plan.totalBitrate) < 12_000) break;

                    if (!isUnderLimit) oversizeAttemptCount++;

                    nextDesiredTotalBitrate = nextBitrate;
                    debug("Retrying compression with lower bitrate", {
                        attempt: attempt + 1,
                        previousBytes: candidateFile.size,
                        hardLimitBytes,
                        nextDesiredTotalBitrate,
                        bestUnderLimitBytes: bestUnderLimit?.file.size,
                        smallestOverLimitBytes: smallestOverLimit?.file.size,
                    });
                } catch (error) {
                    if (state.token !== token) throw error;

                    debug("Compression pass failed", {
                        attempt: attempt + 1,
                        error: error instanceof Error ? error.message : String(error),
                        hasReusableCandidate: Boolean(bestUnderLimit),
                        bestUnderLimitBytes: bestUnderLimit?.file.size,
                        latestCandidateBytes: latestCandidate?.file.size,
                    });

                    if (bestUnderLimit) break;

                    throw error;
                } finally {
                    if (state.conversion === conversion) {
                        state.conversion = undefined;
                    }
                    disposeInput(conversionInput);
                }
            }

            if (state.token !== token) return;

            const selectedResult = bestUnderLimit ?? latestCandidate;

            debug("Compression selection", {
                selectedFromSuccessfulPass: Boolean(bestUnderLimit),
                latestCandidateBytes: latestCandidate?.file.size,
                latestCandidateSize: latestCandidate ? formatSize(latestCandidate.file.size) : null,
                bestUnderLimitBytes: bestUnderLimit?.file.size,
                bestUnderLimitSize: bestUnderLimit ? formatSize(bestUnderLimit.file.size) : null,
                smallestOverLimitBytes: smallestOverLimit?.file.size,
                smallestOverLimitSize: smallestOverLimit ? formatSize(smallestOverLimit.file.size) : null,
                selectedBytes: selectedResult?.file.size,
                selectedSize: selectedResult ? formatSize(selectedResult.file.size) : null,
                hardLimitBytes,
                hardLimitSize: formatSize(hardLimitBytes),
            });

            if (!selectedResult) {
                throw new Error("Compression did not produce an output file.");
            }

            const { file: compressedFile, observedBytes: finalObservedBytes, plan: activePlan } = selectedResult;

            if (compressedFile.size > hardLimitBytes) {
                debug("Compression rejected for exceeding limit", {
                    selectedBytes: compressedFile.size,
                    selectedSize: formatSize(compressedFile.size),
                    latestCandidateBytes: latestCandidate?.file.size,
                    bestUnderLimitBytes: bestUnderLimit?.file.size,
                    smallestOverLimitBytes: smallestOverLimit?.file.size,
                    hardLimitBytes,
                    hardLimitSize: formatSize(hardLimitBytes),
                    overByBytes: compressedFile.size - hardLimitBytes,
                });
                throw new Error(`Compressed file is still above ${formatSize(hardLimitBytes)}.`);
            }

            state.compressedFile = compressedFile;
            state.progress = 1;
            state.status = "done";
            state.error = undefined;

            if (state.enabled) {
                applyCompressedFile(state);
            }

            debug("Compression finished", {
                originalBytes: state.originalFile.size,
                originalSize: formatSize(state.originalFile.size),
                compressedBytes: compressedFile.size,
                compressedSize: formatSize(compressedFile.size),
                observedBytes: finalObservedBytes,
                hardLimitBytes,
                hardLimitSize: formatSize(hardLimitBytes),
                videoCodec,
                audioCodec,
                videoBitrate: activePlan.videoBitrate,
                audioBitrate: activePlan.audioBitrate,
                audioTrackCount: audioTracks.length,
                format: format.mimeType,
            });
        } finally {
            disposeInput(metadataInput);
        }
    })().catch(error => {
        if (state.token !== token) return;

        state.status = "failed";
        state.error = error instanceof Error ? error.message : String(error);
        state.progress = 0;
        state.conversion = undefined;
        applyOriginalFile(state);
        logger.error("Compression failed", error);
        emitState(state);
    }).finally(() => {
        if (state.token === token) {
            state.conversion = undefined;
            state.pendingPromise = undefined;
            emitState(state);
        }
    });

    return state.pendingPromise;
}

export function queueCompression(upload: ManagedUpload) {
    if (!isCompressibleUpload(upload)) return;

    const state = ensureState(upload);

    if (state.enabled) {
        void compressUpload(upload);
    } else {
        applyOriginalFile(state);
        emitState(state);
    }
}

export function setCompressionEnabled(upload: ManagedUpload, enabled: boolean) {
    const state = ensureState(upload);

    state.enabled = enabled;
    upload[COMPRESS_SYMBOL] = enabled;

    if (!enabled) {
        void cancelCompression(state).finally(() => {
            if (state.enabled) {
                emitState(state);
                void compressUpload(upload);
                return;
            }

            state.status = "idle";
            state.progress = 0;
            state.error = undefined;
            clearCompressionResult(state);
            applyOriginalFile(state);
            emitState(state);
        });
        return;
    }

    state.error = undefined;
    emitState(state);
    void compressUpload(upload);
}

export function prepareUploadsForDiscord(uploads: ManagedUpload[]) {
    uploads.forEach(upload => {
        if (!isCompressibleUpload(upload)) return;

        const state = ensureState(upload);
        if (state.enabled && upload.item.file.size > uploadLimitBytes()) {
            debug("Oversized compressible upload entered draft", {
                name: upload.filename,
                size: upload.item.file.size,
            });
        }
        queueCompression(upload);
    });
}

export function splitPromptToUploadFiles(files: File[]) {
    const allowed: File[] = [];
    const blocked: File[] = [];

    for (const file of files) {
        if (file.size <= uploadLimitBytes()) {
            allowed.push(file);
            continue;
        }

        if (isCompressibleFile(file)) {
            allowed.push(file);
            continue;
        }

        blocked.push(file);
    }

    debug("promptToUpload split", {
        allowed: allowed.map(file => ({ name: file.name, size: file.size, compressible: isCompressibleFile(file) })),
        blocked: blocked.map(file => ({ name: file.name, size: file.size, compressible: isCompressibleFile(file) })),
    });

    return { allowed, blocked };
}

export function getPendingStates(uploads: ManagedUpload[]) {
    return uploads
        .map(upload => uploadStates.get(upload))
        .filter((state): state is CompressionState => Boolean(state?.enabled && state.pendingPromise));
}

export function getFailedStates(uploads: ManagedUpload[]) {
    return uploads
        .map(upload => uploadStates.get(upload))
        .filter((state): state is CompressionState => Boolean(state?.enabled && state.status === "failed"));
}

export function getUploadsForChannel(channelId: string) {
    return UploadAttachmentStore.getUploads(channelId, DraftType.ChannelMessage) as ManagedUpload[];
}

export function maybeShowBlockedSendToast(message: string) {
    if (Date.now() - lastBlockedSendToastAt < 1500) return;
    lastBlockedSendToastAt = Date.now();
    showToast(message, Toasts.Type.FAILURE);
}
