import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    outputDirectory: {
        type: OptionType.STRING,
        default: "",
        description: "Absolute base folder for recordings. Leave empty to use the OS default: ~/Videos/DiscordArchive on Windows + Linux, ~/Movies/DiscordArchive on macOS."
    },
    autoRecordOnJoin: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Master switch. When off, joining even a whitelisted channel does NOT auto-record."
    },
    autoRecordChannels: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated channel IDs. Managed via right-click menu; editing here is fine."
    },
    autoRecordUsers: {
        type: OptionType.STRING,
        default: "",
        description: "Comma-separated user IDs. Auto-record when any of these users is in the VC with you (autoRecordOnJoin must be on)."
    },
    absenceTimeoutSeconds: {
        type: OptionType.NUMBER,
        default: 300,
        description: "Seconds to keep recording after the last whitelisted user leaves the channel. Only applies when the recording was started because a whitelisted user was present (autoRecordUsers match). Channel-whitelist sessions ignore this — whitelisting a channel always records until you leave. Set to 0 to disable the timer."
    },
    videoResolution: {
        type: OptionType.SELECT,
        default: "1920x1080",
        description: "Dimensions of the video/grid area (the live stream portion). When 'Bake chat into video' is on, the chat panel is added to the RIGHT of this area, so the final file width = videoResolution.width × (1 + chatPanelWidthPct/100). Streams render at their native aspect inside the grid area with black letterbox bars if needed.",
        options: [
            { label: "720p (1280x720)", value: "1280x720" },
            { label: "1080p (1920x1080)", value: "1920x1080", default: true },
            { label: "1440p (2560x1440)", value: "2560x1440" }
        ]
    },
    videoFramerate: {
        type: OptionType.SELECT,
        default: 30,
        description: "Output framerate.",
        options: [
            { label: "15 fps", value: 15 },
            { label: "24 fps", value: 24 },
            { label: "30 fps", value: 30, default: true },
            { label: "60 fps", value: 60 }
        ]
    },
    videoBitrate: {
        type: OptionType.NUMBER,
        default: 6_000_000,
        description: "VP9 target bitrate in bits per second. Default 6 Mbps."
    },
    videoCodec: {
        type: OptionType.SELECT,
        default: "vp9",
        description: "Codec. Falls back to VP8 if unsupported by the browser.",
        options: [
            { label: "VP9", value: "vp9", default: true },
            { label: "VP8", value: "vp8" },
            { label: "AV1", value: "av1" }
        ]
    },
    bakeChatIntoVideo: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Include the chat panel on the right side of the recorded video. Chat is still saved to .jsonl/.csv regardless."
    },
    chatPanelWidthPct: {
        type: OptionType.NUMBER,
        default: 30,
        description: "Chat panel width as a percent of the video area width (added on top, not taken from the video). With 30% and 1920×1080 video, the final canvas is 2496×1080 when chat is baked in. Chat is still saved to chat.jsonl/csv regardless."
    },
    narrateWhileMuted: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Include your own mic even when Discord-muted. Off = mic recorded only when unmuted (matches Discord semantics)."
    },
    audioSource: {
        type: OptionType.SELECT,
        default: "auto",
        description: "How to capture voice audio. 'auto' picks web-audio on Vesktop/web (per-user tracks, clean) and loopback on Discord Desktop (system audio mix; will also capture other apps playing audio at the same time). 'none' records a silent video.",
        options: [
            { label: "Auto (recommended)", value: "auto", default: true },
            { label: "Web Audio tap (Vesktop / web only)", value: "web-audio" },
            { label: "System audio loopback (works on Discord Desktop; contaminated)", value: "loopback" },
            { label: "None (silent video)", value: "none" }
        ]
    },
    chatSourceMode: {
        type: OptionType.SELECT,
        default: "linked-text",
        description: "Which channel's chat to log.",
        options: [
            { label: "Voice channel's own chat (default)", value: "linked-text", default: true },
            { label: "None", value: "none" }
        ]
    },
    continueRecordingAfterStreamEnds: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "When a session was started via 'Record this stream', keep recording after the anchor stream ends."
    },
    outputFormat: {
        type: OptionType.SELECT,
        default: "webm",
        description: "Final file format. Non-webm formats run ffmpeg after the recording stops. MKV is a near-instant lossless container swap. MP4 re-encodes the video to H.264/AAC for maximum player compatibility and takes significantly longer — roughly 5-30% of recording duration on a modern CPU.",
        options: [
            { label: "WebM — no conversion, fastest", value: "webm", default: true },
            { label: "MKV — lossless remux (requires ffmpeg)", value: "mkv" },
            { label: "MP4 — H.264/AAC re-encode, universal playback (requires ffmpeg, slow)", value: "mp4" }
        ]
    },
    ffmpegPath: {
        type: OptionType.STRING,
        default: "",
        description: "Absolute path to ffmpeg. Leave empty to search PATH — but note that winget installs place ffmpeg in a location Discord may not see (because Discord inherits PATH at launch, not when winget updates it). Easiest to just paste the full path here. On Windows, run `where.exe ffmpeg` in a fresh terminal — typical result: C:\\Users\\<you>\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe. Install: Windows → winget install ffmpeg / choco install ffmpeg; macOS → brew install ffmpeg; Linux → apt/dnf/pacman install ffmpeg."
    },
    keepWebmAfterRemux: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Keep the original .webm file after ffmpeg produces the converted version. Safer in case the conversion result has issues."
    },
    maxRecordingHours: {
        type: OptionType.NUMBER,
        default: 8,
        description: "Hard stop after this many hours. Set to 0 for no limit."
    },
    notifyOnStart: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show toast when a recording starts."
    },
    notifyOnStop: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show toast when a recording stops."
    },
    streamerOverlayBorder: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Draw a glowing border around streaming tiles in the composite."
    }
});
