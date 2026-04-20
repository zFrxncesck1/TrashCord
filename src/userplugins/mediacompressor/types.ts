import { CloudUpload as TCloudUpload } from "@vencord/discord-types";

import { COMPRESS_SYMBOL, ORIGINAL_GET_SIZE_SYMBOL } from "./constants";

export type VideoCodec = "avc" | "hevc" | "vp9" | "vp8" | "av1";
export type AudioCodec = "aac" | "opus" | "mp3" | "vorbis";
export type CompressionStatus = "idle" | "preparing" | "compressing" | "done" | "failed";
export type EncodeConstraints = { width: number; height: number; sampleRate?: number; };
export type CloudUploadItem = ConstructorParameters<typeof TCloudUpload>[0];
export type WebCloudUploadItem = CloudUploadItem & { file: File; };

export interface MediabunnyTrack {
    number: number;
}

export interface MediabunnyVideoTrack extends MediabunnyTrack {
    displayWidth?: number;
    displayHeight?: number;
    frameRate?: number;
}

export interface MediabunnyAudioTrack extends MediabunnyTrack {
    sampleRate?: number;
    numberOfChannels?: number;
}

export interface MediabunnyInput {
    computeDuration(): Promise<number>;
    getPrimaryVideoTrack(): Promise<MediabunnyVideoTrack | null>;
    getAudioTracks(): Promise<MediabunnyAudioTrack[]>;
    [Symbol.dispose]?(): void;
}

export interface MediabunnyOutputFormat {
    mimeType: string;
    fileExtension: string;
    getSupportedVideoCodecs(): VideoCodec[];
    getSupportedAudioCodecs(): AudioCodec[];
}

export interface MediabunnyBufferTarget {
    buffer: ArrayBuffer;
    onwrite?: (start: number, end: number) => void;
}

export interface MediabunnyDiscardedTrack {
    reason?: string;
    track?: MediabunnyTrack;
}

export interface MediabunnyConversion {
    isValid: boolean;
    discardedTracks?: MediabunnyDiscardedTrack[];
    onProgress?: (progress: number) => void;
    execute(): Promise<void>;
    cancel(): Promise<void>;
}

export type MediabunnyVideoConfig = {
    discard: boolean;
    codec: VideoCodec;
    bitrate: number;
    width: number;
    height: number;
    fit: "contain";
    frameRate?: number;
    forceTranscode: true;
};

export type MediabunnyAudioConfig =
    | { discard: true; }
    | {
        codec?: AudioCodec;
        bitrate: number;
        sampleRate?: number;
        numberOfChannels?: number;
        forceTranscode: true;
    };

export type MediabunnyModule = {
    Input: new (options: { formats: readonly unknown[]; source: unknown; }) => MediabunnyInput;
    Output: new (options: { format: MediabunnyOutputFormat; target: MediabunnyBufferTarget; }) => unknown;
    Conversion: {
        init(options: {
            input: MediabunnyInput;
            output: unknown;
            video: (track: MediabunnyVideoTrack) => MediabunnyVideoConfig;
            audio?: (track: MediabunnyAudioTrack, trackIndex: number) => MediabunnyAudioConfig;
            tags: Record<string, never>;
        }): Promise<MediabunnyConversion>;
    };
    BlobSource: new (blob: Blob) => unknown;
    BufferTarget: new () => MediabunnyBufferTarget;
    ALL_FORMATS: readonly unknown[];
    Mp4OutputFormat: new (options?: object) => MediabunnyOutputFormat;
    WebMOutputFormat: new (options?: object) => MediabunnyOutputFormat;
    canEncodeVideo(codec: VideoCodec, constraints?: EncodeConstraints): Promise<boolean>;
    canEncodeAudio(codec: AudioCodec, constraints?: Pick<EncodeConstraints, "sampleRate">): Promise<boolean>;
    getFirstEncodableVideoCodec(codecs: VideoCodec[], constraints?: EncodeConstraints): Promise<VideoCodec | null>;
    getFirstEncodableAudioCodec(codecs: AudioCodec[], constraints?: Pick<EncodeConstraints, "sampleRate">): Promise<AudioCodec | null>;
};

export type ManagedUpload = TCloudUpload & {
    item: WebCloudUploadItem;
    filename: string;
    mimeType?: string;
    currentSize?: number;
    preCompressionSize?: number;
    postCompressionSize?: number;
    description?: string;
    spoiler?: boolean;
    sensitive?: boolean;
    isVideo?: boolean;
    isImage?: boolean;
    classification?: string;
    durationSecs?: number;
    waveform?: string;
    getSize?(): number;
    [COMPRESS_SYMBOL]?: boolean;
    [ORIGINAL_GET_SIZE_SYMBOL]?: () => number;
};

export interface EncodingPlan {
    width: number;
    height: number;
    frameRate?: number;
    audioBitrate: number;
    videoBitrate: number;
    sampleRate?: number;
    numberOfChannels?: number;
    estimatedBytes: number;
    totalBitrate: number;
    oversizeRatio: number;
    bitsPerPixelFrame: number;
}

export interface CompressionState {
    upload: ManagedUpload;
    listeners: Set<() => void>;
    originalFile: File;
    originalName: string;
    originalMimeType: string;
    compressedFile?: File;
    enabled: boolean;
    status: CompressionStatus;
    progress: number;
    error?: string;
    signature?: string;
    conversion?: { cancel(): Promise<void>; };
    pendingPromise?: Promise<void>;
    token?: symbol;
    lastApplied: "original" | "compressed";
    resolvedVideoCodec?: string;
    resolvedAudioCodec?: string;
    estimatedOutputBytes?: number;
    currentPass?: number;
    previousPassBytes?: number;
    latestPassBytes?: number;
}

export interface CompressionAttemptResult {
    file: File;
    observedBytes: number;
    plan: EncodingPlan;
}
