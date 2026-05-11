// Flux payloads we subscribe to. Only fields we actually read.

export interface VoiceStateUpdatePayload {
    type: "VOICE_STATE_UPDATES";
    voiceStates: Array<{
        userId: string;
        channelId: string | null;
        guildId: string | null;
        selfMute: boolean;
        selfDeaf: boolean;
        mute: boolean;
        deaf: boolean;
    }>;
}

export interface StreamCreatePayload {
    type: "STREAM_CREATE";
    streamKey: string; // "guild:channel:user:streamId" or "call:channel:user:streamId"
    rtcServerId: string;
    region: string;
    viewerIds: string[];
}

export interface StreamDeletePayload {
    type: "STREAM_DELETE";
    streamKey: string;
    reason?: string;
}

export interface MessageCreatePayload {
    type: "MESSAGE_CREATE";
    channelId: string;
    guildId?: string;
    message: DiscordMessage;
}

export interface MessageUpdatePayload {
    type: "MESSAGE_UPDATE";
    message: DiscordMessage;
}

export interface MessageDeletePayload {
    type: "MESSAGE_DELETE";
    id: string;
    channelId: string;
    guildId?: string;
}

// Discord message (subset we care about)
export interface DiscordMessage {
    id: string;
    channel_id: string;
    author: { id: string; username: string; global_name?: string; avatar?: string };
    content: string;
    timestamp: string; // ISO
    edited_timestamp?: string;
    attachments?: Array<{ url: string; filename: string; content_type?: string; width?: number; height?: number }>;
}

// --------------------- internal ---------------------

export interface TileSpec {
    userId: string;
    displayName: string;
    bannerColor: string;    // CSS hex like "#36393f" (fallback dark)
    avatarUrl: string;
    muted: boolean;
    deafened: boolean;
    streaming: boolean;
    videoEl: HTMLVideoElement | null;  // present iff streaming
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ChatAttachment {
    url: string;
    filename: string;
    isImage: boolean;
    width?: number;
    height?: number;
}

export interface ChatEmbed {
    type?: string;            // "rich" | "image" | "video" | "link" | "gifv" | ...
    title?: string;
    description?: string;
    url?: string;
    color?: number;           // decimal; convert to #rrggbb at render time
    author?: { name?: string; iconUrl?: string };
    thumbnail?: { url: string; width?: number; height?: number };
    image?: { url: string; width?: number; height?: number };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string; iconUrl?: string };
    video?: { url: string; width?: number; height?: number };
}

export interface ChatReplyContext {
    authorId: string;
    authorName: string;
    avatarUrl: string;
    contentSnippet: string;   // truncated to ~80 chars
}

export interface ChatSticker {
    id: string;
    name: string;
    formatType: 1 | 2 | 3 | 4; // 1=PNG 2=APNG 3=Lottie 4=GIF
}

export interface ChatReaction {
    emoji: { name: string; id?: string; animated?: boolean };
    count: number;
    me: boolean;
}

export interface ChatMessage {
    id: string;
    authorId: string;
    authorName: string;
    avatarUrl: string;
    roleColor?: string;
    content: string;
    timestampMs: number;     // absolute unix ms
    relativeMs: number;      // ms since recording start
    attachments: ChatAttachment[];
    embeds?: ChatEmbed[];
    stickers?: ChatSticker[];
    reactions?: ChatReaction[];
    replyTo?: ChatReplyContext;
    hasAnimated?: boolean;
    // First-sent text content, populated only after the message has been
    // edited at least once. The chat panel renders this in gray above the
    // current `content` so the recording shows what the message originally
    // said before the edit.
    originalContent?: string;
    // Absolute unix-ms timestamp of the most recent edit. Renders as the
    // "(edit time)" label in gray after the current content.
    editedAtMs?: number;
    op: "create" | "edit" | "delete";
}

export interface MessageReactionAddPayload {
    type: "MESSAGE_REACTION_ADD";
    channelId: string;
    messageId: string;
    userId: string;
    emoji: { id?: string | null; name: string; animated?: boolean };
}

export interface MessageReactionRemovePayload {
    type: "MESSAGE_REACTION_REMOVE";
    channelId: string;
    messageId: string;
    userId: string;
    emoji: { id?: string | null; name: string; animated?: boolean };
}

export interface MessageReactionRemoveAllPayload {
    type: "MESSAGE_REACTION_REMOVE_ALL";
    channelId: string;
    messageId: string;
}

export interface MessageReactionRemoveEmojiPayload {
    type: "MESSAGE_REACTION_REMOVE_EMOJI";
    channelId: string;
    messageId: string;
    emoji: { id?: string | null; name: string; animated?: boolean };
}

export interface SessionMetadata {
    channelId: string;
    channelName: string;
    guildId: string | null;
    guildName: string;
    startTs: number;
    endTs?: number;
    durationMs?: number;
    participantIds: string[];
    streamerIds: string[];
    settingsSnapshot: Record<string, unknown>;
    droppedFrameCount?: number;
    abnormalExit?: boolean;
    videoParts?: string[];  // ["call.webm"] or ["call.webm", "call.part2.webm", ...]
}
