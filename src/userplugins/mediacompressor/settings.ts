import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    autoCompressWhenAboveLimit: {
        description: "Automatically enable compression for videos above the limit",
        type: OptionType.BOOLEAN,
        default: true,
    },
    uploadLimit: {
        description: "Target file size limit in MB for compressed videos",
        type: OptionType.SLIDER,
        markers: [10, 25, 50, 75, 100, 200, 300, 400, 500],
        default: 10,
        stickToMarkers: true,
    },
    videoCodec: {
        description: "Preferred video codec (falls back to a compatible one if unavailable)",
        type: OptionType.SELECT,
        options: [
            { label: "H.264 / AVC (Recommended, best compatibility)", value: "avc", default: true },
            { label: "H.265 / HEVC (Higher compression, less compatible)", value: "hevc" },
            { label: "AV1 (Best efficiency, limited support)", value: "av1" },
            { label: "VP9", value: "vp9" },
            { label: "VP8", value: "vp8" },
        ] as const,
    },
    audioCodec: {
        description: "Preferred audio codec for compressed videos",
        type: OptionType.SELECT,
        options: [
            { label: "Opus (Recommended)", value: "opus", default: true },
            { label: "AAC", value: "aac" },
            { label: "MP3", value: "mp3" },
            { label: "Vorbis", value: "vorbis" },
        ] as const,
    },
    compressionPasses: {
        description: "Number of compression passes (more passes = better size accuracy but slower)",
        type: OptionType.SLIDER,
        markers: [1, 2, 3, 4, 5],
        default: 2,
        stickToMarkers: true,
    },
    debugLogging: {
        description: "Enable detailed console logging for troubleshooting",
        type: OptionType.BOOLEAN,
        default: false,
    },
});
