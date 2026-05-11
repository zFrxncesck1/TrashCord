import definePlugin, { PluginNative } from "@utils/types";
import {
    ApplicationStreamingStore, ChannelStore, GuildStore, UserStore, VoiceStateStore, MediaEngineStore,
    SelectedChannelStore
} from "@webpack/common";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";

import { settings } from "./settings";
import { setAutoRecordReevaluator } from "./stores/autoRecordControl";
import { sessionStore } from "./stores/sessionStore";
import { listContains } from "./stores/whitelistStore";
import { RecordingSession } from "./session/RecordingSession";
import { shouldArmAbsenceTimer } from "./session/absenceTimer";
import { captureDesktopAudio } from "./session/LoopbackAudio";
import { initStreamSubscriptionPatches } from "./patches/streamSubscription";
import {
    getTappedStream,
    onStreamDataSeen,
    subscribeToTapChanges
} from "./patches/webAudioTap";
import { channelContextPatch } from "./ui/ChannelContextMenu";
import { streamContextPatch, registerStreamMenuHooks } from "./ui/StreamContextMenu";
import { userContextPatch } from "./ui/UserContextMenu";
import { RecordingPanelButton, registerRecordingButtonHooks } from "./ui/RecordingButton";
import * as toast from "./ui/statusToast";
import type {
    VoiceStateUpdatePayload, StreamCreatePayload, StreamDeletePayload,
    MessageCreatePayload, MessageUpdatePayload, MessageDeletePayload,
    MessageReactionAddPayload, MessageReactionRemovePayload,
    MessageReactionRemoveAllPayload, MessageReactionRemoveEmojiPayload,
    ChatMessage, ChatReaction, TileSpec
} from "./types";
import { logger, parseStreamKey } from "./utils";

const Native = VencordNative.pluginHelpers.DiscordStreamArchiver as PluginNative<typeof import("./native")>;

let currentSession: RecordingSession | null = null;
let absenceTimerHandle: ReturnType<typeof setTimeout> | null = null;
const seenMessagesById = new Map<string, ChatMessage>();

function anyWhitelistedUserInChannel(channelId: string): boolean {
    const states = (VoiceStateStore as any).getVoiceStatesForChannel?.(channelId) ?? {};
    for (const uid of Object.keys(states)) {
        if (listContains(settings.store.autoRecordUsers, uid)) return true;
    }
    return false;
}

function reevaluateAbsenceTimer(): void {
    const s = sessionStore.get();
    if (s.state !== "recording") {
        if (absenceTimerHandle !== null) {
            clearTimeout(absenceTimerHandle);
            absenceTimerHandle = null;
        }
        return;
    }
    const armed = shouldArmAbsenceTimer({
        trigger: s.trigger,
        sessionChannelId: s.channelId,
        channelWhitelistContains: id => listContains(settings.store.autoRecordChannels, id),
        anyWhitelistedUserInChannel,
        absenceTimeoutSeconds: settings.store.absenceTimeoutSeconds
    });
    if (armed) {
        if (absenceTimerHandle !== null) return;
        const ms = settings.store.absenceTimeoutSeconds * 1000;
        logger.info(`absence timer armed for ${settings.store.absenceTimeoutSeconds}s`);
        absenceTimerHandle = setTimeout(() => {
            absenceTimerHandle = null;
            logger.info("absence timer fired: stopping session");
            stop();
        }, ms);
    } else if (absenceTimerHandle !== null) {
        clearTimeout(absenceTimerHandle);
        absenceTimerHandle = null;
        logger.info("absence timer cancelled");
    }
}

function getSelfId(): string { return UserStore.getCurrentUser()?.id ?? ""; }

function getSelfVoiceState() {
    const id = getSelfId();
    const channelId = (SelectedChannelStore as any).getVoiceChannelId?.();
    if (!channelId) return null;
    return (VoiceStateStore as any).getVoiceStateForUser?.(id) ?? null;
}

function buildParticipantTile(userId: string, channelId: string): TileSpec | null {
    const user = UserStore.getUser(userId);
    if (!user) return null;
    const states = (VoiceStateStore as any).getVoiceStatesForChannel?.(channelId) ?? {};
    const state = states[userId] ?? {};
    const displayName = (user as any).globalName || user.username;
    const avatarUrl = (user as any).getAvatarURL?.(undefined, 128, false) ?? "";
    const bannerColor = (user as any).bannerColor ?? "#2f3136";
    return {
        userId,
        displayName,
        bannerColor,
        avatarUrl,
        // `suppress: true` in stage channels means the user is in the audience
        // and cannot speak — functionally identical to being mic-muted for our
        // tile UI. Also treated as muted in regular VCs for any edge case
        // where Discord emits it.
        muted: !!state.mute || !!state.selfMute || !!state.suppress,
        deafened: !!state.deaf || !!state.selfDeaf,
        streaming: false,
        videoEl: null
    };
}

// Discord channel types — 2 = GUILD_VOICE, 13 = GUILD_STAGE_VOICE. In stage
// channels the audience (everyone with suppress:true) sits alongside the
// speakers in VoiceStateStore; we only want the speakers in the composite.
const CHANNEL_TYPE_STAGE_VOICE = 13;

function getParticipants(channelId: string): TileSpec[] {
    const states = (VoiceStateStore as any).getVoiceStatesForChannel?.(channelId) ?? {};
    const channel = ChannelStore.getChannel(channelId);
    const isStage = (channel as any)?.type === CHANNEL_TYPE_STAGE_VOICE;
    const out: TileSpec[] = [];
    for (const userId of Object.keys(states)) {
        if (isStage && states[userId]?.suppress) continue; // skip audience members
        const t = buildParticipantTile(userId, channelId);
        if (t) out.push(t);
    }
    return out;
}

function getParticipantAudioStream(userId: string): MediaStream | null {
    // On Vesktop/web, our webpack patch populates the tap registry with
    // per-user MediaStreams as Discord sets up each remote participant's
    // audio pipeline. On Discord Desktop voice audio is native-only, so the
    // registry stays empty and we return null (loopback mode handles that
    // case by mixing the system audio output in as a single track).
    return getTappedStream(userId)?.stream ?? null;
}

type ResolvedAudioMode = "web-audio" | "loopback" | "none";

function resolveAudioMode(): ResolvedAudioMode {
    const mode = settings.store.audioSource as string;
    if (mode === "web-audio" || mode === "loopback" || mode === "none") return mode;
    // "auto": use web-audio on Vesktop/web, loopback on Discord Desktop.
    return IS_DISCORD_DESKTOP ? "loopback" : "web-audio";
}

async function getMicStream(): Promise<MediaStream | null> {
    // In loopback mode the system audio capture already contains everything
    // the user hears, including their own mic if (and only if) they have OS
    // loopback — there's no second stream to grab. And on Discord Desktop,
    // getUserMedia is outright permission-denied. Skip the call entirely.
    if (resolveAudioMode() === "loopback") {
        logger.info("mic stream: skipped (loopback mode handles audio separately)");
        return null;
    }
    // Use `ideal` rather than `exact`: Discord's MediaEngineStore returns a
    // device ID from its own native audio stack that doesn't always line up
    // with the browser's navigator.mediaDevices enumeration. `exact` throws
    // OverconstrainedError when the browser can't find a matching device;
    // `ideal` prefers that ID but falls back to the default mic, which is
    // good enough for archival and avoids failing mic capture entirely.
    const deviceId = (MediaEngineStore as any).getInputDeviceId?.();
    const constraintChain: MediaStreamConstraints[] = [
        { audio: deviceId ? { deviceId: { ideal: deviceId } } : true },
        { audio: true }
    ];
    for (const constraints of constraintChain) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            logger.warn("getMicStream attempt failed", constraints, err);
        }
    }
    logger.error("getMicStream: all attempts failed; recording without own mic");
    return null;
}

const avatarCache = new Map<string, HTMLImageElement>();
function resolveAvatar(tile: TileSpec): HTMLImageElement | null {
    if (!tile.avatarUrl) return null;
    const cached = avatarCache.get(tile.avatarUrl);
    if (cached && cached.complete) return cached;
    if (!cached) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = tile.avatarUrl;
        avatarCache.set(tile.avatarUrl, img);
    }
    return null; // TileRenderer falls back to background-only until loaded
}

function makeSession(): RecordingSession {
    return new RecordingSession({
        native: {
            startRecording: dir => Native.startRecording(dir),
            appendVideoChunk: (h, bytes) => Native.appendVideoChunk(h, bytes),
            rolloverVideo: h => Native.rolloverVideo(h),
            appendChatLine: (h, k, l) => Native.appendChatLine(h, k, l),
            writeMetadata: (h, m) => Native.writeMetadata(h, m),
            finalize: h => Native.finalize(h),
            ffmpegRemuxDir: (dir, opts) => Native.ffmpegRemuxDir(dir, opts),
            revealInFileManager: p => Native.revealInFileManager(p)
        },
        settings,
        getSelfMuted: () => {
            const s = getSelfVoiceState();
            // suppress in stage channels = audience role, can't speak. Treat
            // as muted so the mic doesn't get attached to the recording mix.
            return !!(s && (s.selfMute || s.mute || s.suppress));
        },
        getChannelName: id => ChannelStore.getChannel(id)?.name ?? id,
        getGuildId: id => (ChannelStore.getChannel(id) as any)?.guild_id ?? null,
        getGuildName: gid => (gid ? GuildStore.getGuild(gid)?.name : "DMs") ?? "DMs",
        getParticipants,
        getMicStream,
        getParticipantAudioStream,
        onToast: (msg, onClick) => toast.show(msg, onClick),
        resolveAvatar
    });
}

// When loopback mode is active we must call getDisplayMedia BEFORE any other
// awaits so the browser's user-gesture window is still valid for the
// permission prompt. We capture upfront, then hand the resulting stream into
// the session via opts.loopbackAudioStream.
async function captureLoopbackIfNeeded(): Promise<MediaStream | null> {
    const mode = resolveAudioMode();
    if (mode !== "loopback") return null;
    return await captureDesktopAudio();
}

// Ask ApplicationStreamingStore for any screenshares already live in this
// channel. STREAM_CREATE flux events only fire when the local viewer clicks
// Watch Stream, so streams that were running before we started recording
// would otherwise never reach addStream. The correct method in current
// Discord builds is `getAllActiveStreamsForChannel(channelId)`, which
// returns an array of stream objects with shape roughly:
//   { type, guildId?, channelId, ownerId, state, ... }
// The object doesn't always carry a pre-built streamKey, so we construct
// it from the other fields to match Discord's streamKey format.
function streamInfoToKey(s: any): string | null {
    if (!s) return null;
    if (typeof s.streamKey === "string") return s.streamKey;
    if (!s.ownerId || !s.channelId) return null;
    if (s.type === "guild" && s.guildId) return `guild:${s.guildId}:${s.channelId}:${s.ownerId}`;
    if (s.type === "call") return `call:${s.channelId}:${s.ownerId}`;
    return null;
}

function findExistingStreamKeysInChannel(channelId: string): string[] {
    const store: any = ApplicationStreamingStore;
    if (!store) return [];
    const keys = new Set<string>();

    // Primary: getAllApplicationStreamsForChannel returns DISCOVERABLE
    // streams (what's live regardless of whether we're watching), unlike
    // getAllActiveStreamsForChannel which only lists streams we've
    // subscribed to.
    try {
        const streams = store.getAllApplicationStreamsForChannel?.(channelId);
        if (Array.isArray(streams)) {
            for (const s of streams) {
                const k = streamInfoToKey(s);
                if (k) keys.add(k);
            }
        }
    } catch (err) {
        logger.warn("getAllApplicationStreamsForChannel failed", err);
    }

    // Secondary: also try active-streams in case the two diverge for
    // streams we're already watching.
    try {
        const streams = store.getAllActiveStreamsForChannel?.(channelId);
        if (Array.isArray(streams)) {
            for (const s of streams) {
                const k = streamInfoToKey(s);
                if (k) keys.add(k);
            }
        }
    } catch { /* ignore */ }

    // Tertiary: voice states directly — `selfStream: true` means that
    // participant is currently streaming even if the streaming store
    // lookup missed them.
    try {
        const states = (VoiceStateStore as any).getVoiceStatesForChannel?.(channelId) ?? {};
        for (const [uid, vs] of Object.entries(states) as Array<[string, any]>) {
            if (!vs?.selfStream) continue;
            // We don't have guildId from the voice state; reconstruct from
            // the channel. ChannelStore.getChannel(channelId).guild_id.
            const channel = ChannelStore.getChannel(channelId);
            const guildId = (channel as any)?.guild_id;
            if (guildId) {
                keys.add(`guild:${guildId}:${channelId}:${uid}`);
            } else {
                keys.add(`call:${channelId}:${uid}`);
            }
        }
    } catch (err) {
        logger.warn("voice state scan failed", err);
    }

    // Filter to this channel in case any fell through with a different one.
    const out: string[] = [];
    for (const k of keys) {
        const parsed = parseStreamKey(k);
        if (parsed && parsed.channelId === channelId) out.push(k);
    }
    return out;
}

async function ingestExistingStreams(channelId: string): Promise<void> {
    if (!currentSession) return;
    const keys = findExistingStreamKeysInChannel(channelId);
    if (keys.length === 0) {
        logger.info(`no existing streams found in channel ${channelId} at session start`);
        return;
    }
    logger.info(`found ${keys.length} existing stream(s) in channel ${channelId}: ${keys.join(", ")}`);
    for (const k of keys) await currentSession.addStream(k);
}

async function maybeAutoStart(channelId: string): Promise<void> {
    if (currentSession) return;
    if (!settings.store.autoRecordOnJoin) return;
    const channelMatch = listContains(settings.store.autoRecordChannels, channelId);
    const userMatch = (() => {
        const states = (VoiceStateStore as any).getVoiceStatesForChannel?.(channelId) ?? {};
        for (const userId of Object.keys(states)) {
            if (listContains(settings.store.autoRecordUsers, userId)) return true;
        }
        return false;
    })();
    if (!channelMatch && !userMatch) return;
    // Auto-start is triggered by VOICE_STATE_UPDATES, not a user gesture — the
    // getDisplayMedia prompt may be rejected here because Chromium has no
    // recent gesture to attribute it to. We still attempt it; if it fails,
    // the session starts with no loopback audio and the toast log explains.
    const loopbackAudioStream = await captureLoopbackIfNeeded();
    // Channel-whitelist takes priority over user-whitelist for the absence
    // timer — whitelisting a channel means "record while I'm here", regardless
    // of which users are in it.
    const trigger: import("./stores/sessionStore").SessionTrigger = channelMatch ? "channel" : "user";
    currentSession = makeSession();
    try {
        await currentSession.start({ channelId, loopbackAudioStream, onSubscribeTapChanges: subscribeToTapChanges, trigger });
        await ingestExistingStreams(channelId);
    } catch (err) {
        logger.error("auto-start failed", err);
        toast.showError(String(err));
        currentSession = null;
    }
}

// Called from the context-menu toggles after the autoRecord{Users,Channels}
// list has been mutated. Brings the recording state in line with the new
// whitelist without waiting for a leave/rejoin event:
//   - if the user is in a VC and now matches a whitelist criterion, start;
//   - if a whitelist-triggered session no longer matches its trigger
//     (last whitelisted user removed, or the recorded channel got
//     unwhitelisted), stop.
// Manual sessions are never stopped here — those were started by the user
// pressing Record explicitly and shouldn't be terminated by toggle changes.
function reevaluateAutoRecord(): void {
    const myChannelId = (SelectedChannelStore as any).getVoiceChannelId?.();
    const s = sessionStore.get();
    if (s.state !== "recording") {
        if (myChannelId) maybeAutoStart(myChannelId);
        return;
    }
    if (s.trigger === "user" && !anyWhitelistedUserInChannel(s.channelId)) {
        stop();
        return;
    }
    if (s.trigger === "channel" && !listContains(settings.store.autoRecordChannels, s.channelId)) {
        stop();
    }
}

async function manualStart(channelId: string, anchorStreamKey?: string): Promise<void> {
    if (currentSession) return;
    // Prompt upfront to stay within the user-gesture window.
    const loopbackAudioStream = await captureLoopbackIfNeeded();
    const trigger: import("./stores/sessionStore").SessionTrigger = anchorStreamKey ? "stream-anchor" : "manual";
    currentSession = makeSession();
    try {
        await currentSession.start({ channelId, anchorStreamKey, loopbackAudioStream, onSubscribeTapChanges: subscribeToTapChanges, trigger });
        await ingestExistingStreams(channelId);
    } catch (err) {
        logger.error("manual start failed", err);
        toast.showError(String(err));
        currentSession = null;
    }
}

async function stop(): Promise<void> {
    if (!currentSession) return;
    if (absenceTimerHandle !== null) {
        clearTimeout(absenceTimerHandle);
        absenceTimerHandle = null;
    }
    const s = currentSession; currentSession = null;
    try { await s.stop(); }
    catch (err) { logger.error("stop failed", err); toast.showError(String(err)); }
}

function avatarUrlForUser(userId: string, size = 64): string {
    const u = UserStore.getUser(userId);
    return (u as any)?.getAvatarURL?.(undefined, size, false) ?? "";
}

function chatMessageFromPayload(m: any): ChatMessage {
    const author = m.author ?? {};
    const name = (author as any).global_name || author.username || "unknown";
    const avatarUrl = avatarUrlForUser(author.id);
    const ts = typeof m.timestamp === "string" ? Date.parse(m.timestamp) : Number(m.timestamp ?? Date.now());
    const s = sessionStore.get();
    const sessionStart = s.state === "recording" ? s.startedAt : Date.now();

    // Reply context: Discord puts the full replied-to message on
    // `referenced_message` when this is a reply.
    let replyTo: ChatMessage["replyTo"];
    const ref = m.referenced_message;
    if (ref?.author?.id) {
        const refAuthor = ref.author;
        const refName = refAuthor.global_name || refAuthor.username || "unknown";
        const snippet = String(ref.content ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
        replyTo = {
            authorId: refAuthor.id,
            authorName: refName,
            avatarUrl: avatarUrlForUser(refAuthor.id, 32),
            contentSnippet: snippet || "[no text]"
        };
    }

    // Embeds: Discord's shape has camelCased and snake_case field variations
    // across builds. Normalise the fields we actually use for rendering.
    //
    // Media URL preference: proxy_url by default (Discord's media proxy
    // sends CORS-friendly headers for canvas use, unlike arbitrary origin
    // URLs). EXCEPTION: sticker URLs. Discord's external proxy strips APNG
    // animation from stickers and returns a static PNG — same as FakeNitro
    // observed. For a pasted sticker link we fall back to the direct CDN
    // URL (cdn.discordapp.com/stickers/<id>.<ext>) which serves the native
    // APNG bytes. That CDN endpoint sends CORS, so it's still canvas-safe.
    const embeds = (m.embeds ?? []).map((e: any) => ({
        type: e.type,
        title: e.title,
        description: e.description,
        url: e.url,
        color: typeof e.color === "number" ? e.color : undefined,
        author: e.author ? {
            name: e.author.name,
            // Prefer proxy URLs: they're served by media.discordapp.net with
            // CORS headers, so they work with canvas. Raw icon_url points at
            // the origin (twitter/youtube/etc.) which usually blocks canvas.
            iconUrl: e.author.proxy_icon_url ?? e.author.proxyIconURL ?? e.author.icon_url ?? e.author.iconURL
        } : undefined,
        thumbnail: e.thumbnail ? {
            url: preferDirectForStickers(e.thumbnail.url, e.thumbnail.proxy_url ?? e.thumbnail.proxyURL),
            width: e.thumbnail.width,
            height: e.thumbnail.height
        } : undefined,
        image: e.image ? {
            url: preferDirectForStickers(e.image.url, e.image.proxy_url ?? e.image.proxyURL),
            width: e.image.width,
            height: e.image.height
        } : undefined,
        fields: Array.isArray(e.fields)
            ? e.fields.map((f: any) => ({ name: f.name, value: f.value, inline: !!f.inline }))
            : undefined,
        footer: e.footer ? {
            text: e.footer.text,
            iconUrl: e.footer.proxy_icon_url ?? e.footer.proxyIconURL ?? e.footer.icon_url ?? e.footer.iconURL
        } : undefined,
        video: e.video ? {
            url: e.video.proxy_url ?? e.video.proxyURL ?? e.video.url,
            width: e.video.width,
            height: e.video.height
        } : undefined
    }));

    const stickers = Array.isArray(m.sticker_items)
        ? m.sticker_items.map((s: any) => ({
            id: s.id,
            name: s.name,
            formatType: (s.format_type ?? s.formatType ?? 1) as 1 | 2 | 3 | 4
        }))
        : undefined;

    const reactions = Array.isArray(m.reactions)
        ? m.reactions.map((r: any) => ({
            emoji: { name: r.emoji?.name ?? "?", id: r.emoji?.id ?? undefined, animated: !!r.emoji?.animated },
            count: r.count ?? 0,
            me: !!r.me
        }))
        : undefined;

    const contentHasAnimatedEmote = /<a:[a-zA-Z0-9_~]+:\d{5,25}>/.test(m.content ?? "");
    const attachmentsHaveGif = (m.attachments ?? []).some((a: any) =>
        /\.gif(\?|$)/i.test(a.url ?? a.proxy_url ?? ""));
    const embedsHaveGifv = embeds.some((e: any) => e.type === "gifv");
    const stickersHaveAnim = stickers?.some((s: any) => s.formatType === 2 || s.formatType === 4) ?? false;
    const hasAnimated = contentHasAnimatedEmote || attachmentsHaveGif || embedsHaveGifv || stickersHaveAnim;

    return {
        id: m.id,
        authorId: author.id,
        authorName: name,
        avatarUrl,
        content: m.content ?? "",
        timestampMs: ts,
        relativeMs: ts - sessionStart,
        attachments: (m.attachments ?? []).map((a: any) => ({
            url: a.proxy_url ?? a.proxyURL ?? a.url,
            filename: a.filename,
            isImage: /^image\//i.test(a.content_type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename ?? ""),
            width: a.width,
            height: a.height
        })),
        embeds: embeds.length > 0 ? embeds : undefined,
        stickers,
        reactions,
        hasAnimated,
        replyTo,
        op: "create"
    };
}

// Pick the embed media URL that gives us the native content. For stickers
// (/stickers/<id>.<ext>), Discord's external proxy re-encodes APNG as flat
// PNG — FakeNitro addressed the same problem. The direct CDN URL still
// sends canvas-friendly CORS headers, so it's safe to prefer over the
// proxied version. Non-sticker media keeps preferring proxy_url.
function preferDirectForStickers(direct: string | undefined, proxied: string | undefined): string | undefined {
    if (direct && /\/stickers\/\d+\.(png|webp|gif)/i.test(direct)) return direct;
    return proxied ?? direct;
}

function isInterestingChatChannel(channelId: string): boolean {
    const s = sessionStore.get();
    if (s.state !== "recording") return false;
    if (settings.store.chatSourceMode === "none") return false;
    // "linked-text" default: the voice channel's own chat uses the VC's own channel id in modern Discord.
    return channelId === s.channelId;
}

function reactionEmojiMatches(
    a: { id?: string | null; name: string },
    b: { id?: string; name: string }
): boolean {
    if (a.id && b.id) return a.id === b.id;
    return a.name === b.name;
}

// Only apply reaction mutations for messages currently visible on the chat
// panel — off-screen messages won't ever be rendered again in this session,
// so tracking their reaction deltas is wasted work. Initial reactions from
// MESSAGE_CREATE still flow through chatMessageFromPayload regardless.
function applyReactionMutation(
    messageId: string,
    mutate: (reactions: ChatReaction[]) => ChatReaction[]
): void {
    const panel = currentSession?.currentChatPanel;
    if (!panel) return;
    if (!panel.getVisibleMessageIds().has(messageId)) return;
    panel.updateReactions(messageId, mutate);
}

export default definePlugin({
    name: "DiscordStreamArchiver",
    description: "Automatic archival of Discord live streams, VC audio, and chat.",
    authors: [{ id: 236950175480807424n, name: "max2fly" }],
    tags: ["Voice", "Media", "Chat", "Utility"],
    enabledByDefault: false,
    dependencies: [],
    settings,

    flux: {
        VOICE_STATE_UPDATES: (payload: VoiceStateUpdatePayload) => {
            const self = getSelfId();
            const selfState = payload.voiceStates.find(v => v.userId === self);
            if (selfState) {
                if (selfState.channelId) {
                    maybeAutoStart(selfState.channelId);
                } else if (currentSession) {
                    stop();
                }
            }
            currentSession?.onParticipantsChanged();
            if (selfState && currentSession) currentSession.onMuteStateChanged();
            // If anyone in the VC flipped selfStream (started or stopped
            // screen-sharing), re-ingest. ingestExistingStreams is idempotent
            // via RecordingSession.taps dedup, so re-running is cheap.
            const s = sessionStore.get();
            if (s.state === "recording") {
                const touchesThisChannel = payload.voiceStates.some(v => v.channelId === s.channelId);
                if (touchesThisChannel) ingestExistingStreams(s.channelId).catch(err => logger.warn("mid-session ingest failed", err));
            }
            reevaluateAbsenceTimer();
        },

        STREAM_CREATE: (p: StreamCreatePayload) => {
            logger.info(`STREAM_CREATE fired, streamKey=${p?.streamKey}`);
            if (!currentSession) { logger.info("STREAM_CREATE: no active session, ignoring"); return; }
            const parsed = parseStreamKey(p.streamKey ?? "");
            if (!parsed) { logger.warn(`STREAM_CREATE: unrecognized streamKey format: ${p.streamKey}`); return; }
            const s = sessionStore.get();
            if (s.state !== "recording") { logger.info(`STREAM_CREATE: session not recording (state=${s.state})`); return; }
            if (s.channelId !== parsed.channelId) { logger.info(`STREAM_CREATE: channel mismatch session=${s.channelId} stream=${parsed.channelId}`); return; }
            currentSession.addStream(p.streamKey);
        },

        STREAM_DELETE: (p: StreamDeletePayload) => {
            logger.info(`STREAM_DELETE fired, streamKey=${p?.streamKey}`);
            currentSession?.removeStream(p.streamKey);
        },

        MESSAGE_CREATE: (p: MessageCreatePayload) => {
            if (!currentSession) return;
            if (!isInterestingChatChannel(p.channelId)) return;
            // Discord fires MESSAGE_CREATE twice for your own messages: an
            // optimistic one with a temp id like "unsent:..." as soon as you
            // hit Enter, then a confirmed one with the real id once the server
            // acks. Drop the optimistic one so we don't log the same message
            // twice in chat.jsonl / chat.csv. `optimistic` is on the payload;
            // the temp id is a secondary signal.
            if ((p as any).optimistic || p.message.id?.startsWith?.("unsent:")) return;
            const msg = chatMessageFromPayload(p.message);
            // Belt-and-suspenders: dedupe by id in case the handler ever fires
            // twice with the same id (some plugins re-dispatch events).
            if (seenMessagesById.has(msg.id)) return;
            seenMessagesById.set(msg.id, msg);
            currentSession.ingestChatMessage(msg);
        },

        MESSAGE_UPDATE: (p: MessageUpdatePayload) => {
            if (!currentSession) return;
            if (!isInterestingChatChannel(p.message.channel_id)) return;
            // MESSAGE_UPDATE payloads from Discord only include the fields
            // that actually changed (e.g. an embed lands ~1s after the
            // initial CREATE, and the update has just `id`, `channel_id`,
            // and `embeds`). chatMessageFromPayload would derive defaults
            // for any missing field — most visibly, no `author` block
            // means avatarUrl="" and authorName="unknown", which paints
            // the avatar tile blank. Merge the partial update over the
            // cached message so untouched fields keep their values.
            const raw = p.message as any;
            const fresh = chatMessageFromPayload(raw);
            const cached = seenMessagesById.get(fresh.id);
            // Capture first-sent content the moment we see a real text edit.
            // Once set, originalContent never changes through subsequent
            // edits — we want the very first version, not the most recent
            // prior. editedAtMs uses Discord's edited_timestamp when
            // present, falling back to wall clock so we still get a sane
            // value for embed-injection updates that don't carry a content
            // change but mark the message as touched.
            const isTextEdit = raw.content !== undefined && raw.content !== cached?.content;
            const editTs = raw.edited_timestamp
                ? Date.parse(raw.edited_timestamp)
                : Date.now();
            const merged: ChatMessage = cached ? {
                ...cached,
                ...(raw.content !== undefined ? { content: fresh.content } : {}),
                ...(raw.embeds !== undefined ? { embeds: fresh.embeds } : {}),
                ...(raw.attachments !== undefined ? { attachments: fresh.attachments } : {}),
                ...(raw.sticker_items !== undefined ? { stickers: fresh.stickers } : {}),
                ...(raw.reactions !== undefined ? { reactions: fresh.reactions } : {}),
                ...(raw.referenced_message !== undefined ? { replyTo: fresh.replyTo } : {}),
                ...(raw.author ? {
                    authorId: fresh.authorId,
                    authorName: fresh.authorName,
                    avatarUrl: fresh.avatarUrl,
                    roleColor: fresh.roleColor
                } : {}),
                ...(isTextEdit ? {
                    originalContent: cached.originalContent ?? cached.content,
                    editedAtMs: editTs
                } : {}),
                hasAnimated: fresh.hasAnimated || cached.hasAnimated,
                op: "edit"
            } : fresh;
            seenMessagesById.set(merged.id, merged);
            currentSession.editChatMessage(merged);
        },

        MESSAGE_DELETE: (p: MessageDeletePayload) => {
            if (!currentSession) return;
            if (!isInterestingChatChannel(p.channelId)) return;
            currentSession.deleteChatMessage(p.id, seenMessagesById.get(p.id) ?? null);
        },

        MESSAGE_REACTION_ADD: (p: MessageReactionAddPayload) => {
            if (!isInterestingChatChannel(p.channelId)) return;
            const selfId = getSelfId();
            applyReactionMutation(p.messageId, (reactions) => {
                const next = reactions.slice();
                const idx = next.findIndex(r => reactionEmojiMatches(p.emoji, r.emoji));
                if (idx >= 0) {
                    next[idx] = {
                        ...next[idx],
                        count: next[idx].count + 1,
                        me: next[idx].me || p.userId === selfId
                    };
                } else {
                    next.push({
                        emoji: {
                            name: p.emoji.name,
                            id: p.emoji.id ?? undefined,
                            animated: !!p.emoji.animated
                        },
                        count: 1,
                        me: p.userId === selfId
                    });
                }
                return next;
            });
        },

        MESSAGE_REACTION_REMOVE: (p: MessageReactionRemovePayload) => {
            if (!isInterestingChatChannel(p.channelId)) return;
            const selfId = getSelfId();
            applyReactionMutation(p.messageId, (reactions) => {
                const next = reactions.slice();
                const idx = next.findIndex(r => reactionEmojiMatches(p.emoji, r.emoji));
                if (idx < 0) return next;
                const nextCount = Math.max(0, next[idx].count - 1);
                if (nextCount === 0) {
                    next.splice(idx, 1);
                } else {
                    next[idx] = {
                        ...next[idx],
                        count: nextCount,
                        me: next[idx].me && p.userId !== selfId
                    };
                }
                return next;
            });
        },

        MESSAGE_REACTION_REMOVE_ALL: (p: MessageReactionRemoveAllPayload) => {
            if (!isInterestingChatChannel(p.channelId)) return;
            applyReactionMutation(p.messageId, () => []);
        },

        MESSAGE_REACTION_REMOVE_EMOJI: (p: MessageReactionRemoveEmojiPayload) => {
            if (!isInterestingChatChannel(p.channelId)) return;
            applyReactionMutation(p.messageId, (reactions) =>
                reactions.filter(r => !reactionEmojiMatches(p.emoji, r.emoji))
            );
        }
    },

    // Mount the Record button into Discord's bottom-left account panel,
    // in the button row next to Mute/Deafen/Settings/Game Activity.
    //
    // Two mutually-exclusive replacements handle both load orders:
    //   1. Pristine-source (GAT disabled or our plugin runs first): anchors
    //      on `accountContainerRef` close after `children:[` — same pattern
    //      GameActivityToggle itself uses.
    //   2. Post-GAT (the common case; GAT is stock/default-on and our
    //      plugin name sorts after "GameActivityToggle" alphabetically):
    //      anchors on GAT's already-injected canonical form, which only
    //      exists inside the correct children array.
    //
    // `noWarn: true` on each so the one that doesn't match doesn't log a
    // misleading "had no effect" warning to the Vencord console.
    patches: [
        {
            find: ".DISPLAY_NAME_STYLES_COACHMARK)",
            replacement: [
                {
                    match: /children:\[(?=.{0,25}?accountContainerRef)/,
                    replace: "children:[$self.RecordingPanelButton(arguments[0]),",
                    noWarn: true
                },
                {
                    match: /children:\[(?=Vencord\.Plugins\.plugins\["GameActivityToggle"\]\.GameActivityToggleButton\(arguments\[0\]\),)/,
                    replace: "children:[$self.RecordingPanelButton(arguments[0]),",
                    noWarn: true
                }
            ]
        },
        // Web Audio tap for per-participant voice MediaStreams. The module
        // containing `streamSourceNode` is Discord's per-participant Output
        // class. Two replacements cover the two moments we care about:
        //   (a) entry of updateAudioElement — called on addTrack (first track
        //       only), volume change, mute change, speakingFlags change, and
        //       setSinkId. Catches any state transition on existing streams,
        //       so if someone joined the VC before we hit Record, the next
        //       time they speak our hook fires with their audio track live.
        //   (b) the streamSourceNode creation line inside addTrack — runs
        //       exactly when an audio track becomes available on the stream.
        //       Catches participants whose first track was video (their
        //       audio arrives in a second addTrack call that doesn't re-run
        //       updateAudioElement).
        // Gated to non-Desktop because on Discord Desktop the native voice
        // module handles mixing and no JS MediaStream exists to tap.
        {
            find: "streamSourceNode",
            predicate: () => !IS_DISCORD_DESKTOP,
            replacement: [
                {
                    match: /updateAudioElement\(\)\{/,
                    replace: "updateAudioElement(){$self.webAudioTap(this);"
                },
                {
                    match: /this\.streamSourceNode=this\.audioContext\.createMediaStreamSource\(this\.stream\);/,
                    replace: "$&$self.webAudioTap(this);"
                }
            ]
        }
    ],

    RecordingPanelButton: ErrorBoundary.wrap(RecordingPanelButton, { noop: true }),

    webAudioTap(streamData: any) {
        onStreamDataSeen(streamData);
    },

    async start() {
        initStreamSubscriptionPatches();
        addContextMenuPatch("channel-context", channelContextPatch);
        addContextMenuPatch("stream-context", streamContextPatch);
        addContextMenuPatch("user-context", userContextPatch);
        registerStreamMenuHooks({
            startForStream: (streamKey, channelId) => {
                manualStart(channelId, streamKey);
            }
        });
        registerRecordingButtonHooks({
            start: channelId => manualStart(channelId),
            stop: () => stop()
        });
        setAutoRecordReevaluator(reevaluateAutoRecord);
        logger.info("DiscordStreamArchiver started");
    },

    async stop() {
        removeContextMenuPatch("channel-context", channelContextPatch);
        removeContextMenuPatch("stream-context", streamContextPatch);
        removeContextMenuPatch("user-context", userContextPatch);
        if (currentSession) await currentSession.stop();
        logger.info("DiscordStreamArchiver stopped");
    }
});
