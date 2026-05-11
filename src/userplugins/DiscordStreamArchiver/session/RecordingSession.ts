import { UserStore, GuildStore, ChannelStore, GuildMemberStore } from "@webpack/common";

import { AudioMixer } from "./AudioMixer";
import { StreamTap } from "./StreamTap";
import { ChatLogger } from "./ChatLogger";
import { Compositor } from "../compositor/Compositor";
import { ChatPanelRenderer } from "../compositor/ChatPanelRenderer";
import type { MentionResolvers } from "../compositor/chat/ContentParser";
import { getAllTappedStreams } from "../patches/webAudioTap";
import { sessionStore, type SessionTrigger } from "../stores/sessionStore";
import type { TileSpec, ChatMessage, SessionMetadata } from "../types";
import { logger, parseStreamKey, sessionFolderName } from "../utils";

export interface RecordingSessionDeps {
    native: {
        startRecording(dir: string): Promise<number>;
        appendVideoChunk(handle: number, bytes: Uint8Array): Promise<void>;
        rolloverVideo(handle: number): Promise<{ partName: string }>;
        appendChatLine(handle: number, kind: "jsonl" | "csv", line: string): Promise<void>;
        writeMetadata(handle: number, meta: Record<string, unknown>): Promise<void>;
        finalize(handle: number): Promise<{ path: string }>;
        ffmpegRemuxDir(dir: string, opts: any): Promise<{ path: string }>;
        revealInFileManager(p: string): Promise<void>;
    };
    settings: any;  // typed as SettingsStore
    getSelfMuted(): boolean;
    getChannelName(channelId: string): string;
    getGuildId(channelId: string): string | null;
    getGuildName(guildId: string | null): string;
    getParticipants(channelId: string): TileSpec[];
    getMicStream(): Promise<MediaStream | null>;
    getParticipantAudioStream(userId: string): MediaStream | null;
    onToast: (msg: string, onClick?: () => void) => void;
    resolveAvatar: (tile: TileSpec) => HTMLImageElement | ImageBitmap | null;
}

export interface StartOpts {
    channelId: string;
    anchorStreamKey?: string;
    // Pre-captured loopback MediaStream for Discord Desktop / "loopback" mode.
    // The index.tsx caller is responsible for prompting getDisplayMedia upfront
    // (to stay inside the user-gesture window) and passing the result here.
    loopbackAudioStream?: MediaStream | null;
    // Called at start time so the session can subscribe to new per-user streams
    // appearing after start (Vesktop/web path, via webAudioTap). The returned
    // function is the unsubscribe handle and is invoked on session stop.
    onSubscribeTapChanges?: (listener: () => void) => () => void;
    // What kicked off this session. Read by the absence-timer logic to decide
    // whether to auto-stop when whitelisted users leave. Channel-whitelist wins
    // over user-whitelist when both match at start time.
    trigger: SessionTrigger;
}

export class RecordingSession {
    private handle: number | null = null;
    private channelId: string | null = null;
    private audioMixer: AudioMixer | null = null;
    private compositor: Compositor | null = null;
    private chatPanel: ChatPanelRenderer | null = null;
    private chatLogger: ChatLogger | null = null;
    private micStream: MediaStream | null = null;
    private loopbackStream: MediaStream | null = null;
    private tapUnsubscribe: (() => void) | null = null;
    private taps = new Map<string, StreamTap>();
    // Tracks which per-user audio streams are currently wired into the mixer
    // so reconcile can add/replace/remove precisely without querying the mixer.
    private participantStreamLinks = new Map<string, MediaStream>();
    // Tracks which per-user screenshare video streams are linked into tiles.
    // Keyed by userId; value is the MediaStream + hidden <video> element
    // feeding the compositor.
    private screenshareLinks = new Map<string, { stream: MediaStream; videoEl: HTMLVideoElement }>();
    private tiles: TileSpec[] = [];
    private anchorStreamKey: string | null = null;
    private trigger: SessionTrigger = "manual";
    // Defensive net for screenshares whose video tracks arrive late: the
    // addtrack listener in webAudioTap should catch those, but a 3s poll
    // covers any edge case the listener misses (e.g. track registered on
    // the stream before we attached the listener).
    private reconcilePollHandle: ReturnType<typeof setInterval> | null = null;
    private startedAt = 0;
    private droppedAtStart = 0;
    private aborted = false;

    constructor(private readonly deps: RecordingSessionDeps) {}

    async start(opts: StartOpts): Promise<void> {
        this.channelId = opts.channelId;
        this.anchorStreamKey = opts.anchorStreamKey ?? null;
        this.trigger = opts.trigger;
        this.startedAt = Date.now();

        const channelName = this.deps.getChannelName(opts.channelId);
        const guildId = this.deps.getGuildId(opts.channelId);
        const guildName = this.deps.getGuildName(guildId);

        // Build the absolute session directory. When outputDirectory is empty,
        // we pass just the session folder name; native.ts anchors it under
        // the OS default (~/Videos/DiscordArchive/<session>).
        const outputBase = (this.deps.settings.store.outputDirectory ?? "").trim();
        const folder = sessionFolderName(new Date(), channelName, guildName);
        const dir = outputBase
            ? `${outputBase.replace(/[/\\]+$/, "")}/${folder}`.replace(/\\/g, "/")
            : folder;

        this.handle = await this.deps.native.startRecording(dir);

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        logger.info(`AudioContext initial state=${ctx.state}`);
        await ctx.resume().catch(err => logger.warn("AudioContext.resume failed", err));
        logger.info(`AudioContext post-resume state=${ctx.state} sampleRate=${ctx.sampleRate}`);
        this.audioMixer = new AudioMixer(ctx);

        // Own mic (following Discord mute state unless narrateWhileMuted)
        const shouldRecordMic = !this.deps.getSelfMuted() || this.deps.settings.store.narrateWhileMuted;
        if (shouldRecordMic) {
            this.micStream = await this.deps.getMicStream();
            if (this.micStream) this.audioMixer.addTrack("self-mic", this.micStream);
        }

        // Desktop loopback: one MediaStream carrying Discord's mixed system
        // audio output (see LoopbackAudio.ts). Added as a single track; tears
        // down with the session.
        if (opts.loopbackAudioStream) {
            this.loopbackStream = opts.loopbackAudioStream;
            this.audioMixer.addTrack("desktop-loopback", opts.loopbackAudioStream);
            logger.info(`loopback audio stream added (${opts.loopbackAudioStream.getAudioTracks().length} track(s))`);
        }

        // Initial participant tiles + audio
        this.tiles = this.deps.getParticipants(opts.channelId);
        this.reconcileParticipantAudio();
        this.reconcileScreenshares();

        // Vesktop/web path: participant streams often come online lazily,
        // after the user has started speaking at least once, and screenshare
        // video tracks arrive via the same tap pipeline. Subscribe once so
        // audio and screenshare reconciles run on every registry change.
        if (opts.onSubscribeTapChanges) {
            this.tapUnsubscribe = opts.onSubscribeTapChanges(() => {
                this.reconcileParticipantAudio();
                this.reconcileScreenshares();
            });
        }

        // Chat panel
        if (this.deps.settings.store.bakeChatIntoVideo) {
            const chatCanvas = document.createElement("canvas");
            const [w, h] = (this.deps.settings.store.videoResolution as string).split("x").map(Number);
            const pct = this.deps.settings.store.chatPanelWidthPct / 100;
            chatCanvas.width = Math.floor(w * pct);
            chatCanvas.height = h;
            this.chatPanel = new ChatPanelRenderer(chatCanvas, this.buildMentionResolvers());
        }

        this.chatLogger = new ChatLogger(
            { appendChatLine: (h, k, l) => this.deps.native.appendChatLine(h, k, l) },
            this.handle
        );

        // Compositor
        const [w, h] = (this.deps.settings.store.videoResolution as string).split("x").map(Number);
        this.compositor = new Compositor(
            {
                width: w, height: h,
                framerate: this.deps.settings.store.videoFramerate,
                bakeChat: this.deps.settings.store.bakeChatIntoVideo,
                chatPanelWidthPct: this.deps.settings.store.chatPanelWidthPct,
                streamerOverlayBorder: this.deps.settings.store.streamerOverlayBorder,
                codec: this.deps.settings.store.videoCodec,
                videoBitsPerSecond: this.deps.settings.store.videoBitrate,
                timesliceMs: 1000
            },
            {
                onChunk: async (bytes) => {
                    if (this.handle !== null) await this.deps.native.appendVideoChunk(this.handle, bytes);
                },
                onError: (err) => this.onRecorderError(err),
                getAvatar: (tile) => this.deps.resolveAvatar(tile)
            }
        );
        if (this.chatPanel) this.compositor.attachChatPanel(this.chatPanel);
        this.compositor.setTiles(this.tiles);
        await this.compositor.start(this.audioMixer.destinationTrack);

        // Initial metadata
        await this.deps.native.writeMetadata(this.handle, this.initialMeta());

        sessionStore.set({
            state: "recording",
            handle: this.handle,
            channelId: opts.channelId,
            channelName,
            startedAt: this.startedAt,
            anchorStreamKey: this.anchorStreamKey,
            trigger: this.trigger
        });

        this.reconcilePollHandle = setInterval(() => {
            this.reconcileScreenshares();
        }, 3000);

        if (this.deps.settings.store.notifyOnStart) {
            this.deps.onToast(`Recording started: ${channelName}`);
        }
    }

    async addStream(streamKey: string): Promise<void> {
        if (!this.audioMixer || !this.compositor) return;
        if (this.taps.has(streamKey)) return;
        const userId = extractUserId(streamKey);
        const tap = new StreamTap(streamKey);
        try {
            await tap.attach();
        } catch (err) {
            // Deferred, not fatal. The webpack-patched `watchStream` action
            // isn't reachable in current Discord builds, and at STREAM_CREATE
            // time the webAudioTap registry may not yet contain the stream
            // (Discord processes it a beat later). reconcileScreenshares at
            // the end of this function and on every subsequent tap-change
            // will pick up the video as soon as it arrives.
            logger.info(`stream tap for ${streamKey} deferred: ${String(err).split("\n")[0]}`);
        }
        // Always record the streamKey so anchor-bound session lifecycle
        // (STREAM_DELETE → stop if anchor and !continueRecordingAfterStreamEnds)
        // works even when the initial attach didn't produce tracks.
        this.taps.set(streamKey, tap);
        if (tap.audioStream) this.audioMixer.addTrack(`stream:${streamKey}`, tap.audioStream);
        if (tap.videoEl) {
            const idx = this.tiles.findIndex(t => t.userId === userId);
            if (idx >= 0) {
                this.tiles[idx] = { ...this.tiles[idx], streaming: true, videoEl: tap.videoEl };
            }
        }
        this.compositor.setTiles(this.tiles);
        // Kick a reconcile so if the stream is ALREADY in the tap registry
        // (racy but common) the video lands immediately.
        this.reconcileScreenshares();
    }

    async removeStream(streamKey: string): Promise<void> {
        const tap = this.taps.get(streamKey);
        if (!tap) return;
        const userId = extractUserId(streamKey);
        this.audioMixer?.removeTrack(`stream:${streamKey}`);
        tap.dispose();
        this.taps.delete(streamKey);
        const idx = this.tiles.findIndex(t => t.userId === userId);
        if (idx >= 0) {
            this.tiles[idx] = { ...this.tiles[idx], streaming: false, videoEl: null };
        }
        this.compositor?.setTiles(this.tiles);

        if (streamKey === this.anchorStreamKey
            && !this.deps.settings.store.continueRecordingAfterStreamEnds) {
            await this.stop();
        }
    }

    onParticipantsChanged(): void {
        if (!this.channelId || !this.audioMixer) return;
        const newTiles = this.deps.getParticipants(this.channelId);
        // Preserve streaming state across participant refreshes.
        for (const t of newTiles) {
            const existing = this.tiles.find(x => x.userId === t.userId);
            if (existing?.streaming) { t.streaming = true; t.videoEl = existing.videoEl; }
        }
        this.tiles = newTiles;
        this.compositor?.setTiles(newTiles);
        this.reconcileParticipantAudio();
        this.reconcileScreenshares();
    }

    // Walk current participants and keep the mixer's per-user tracks in sync
    // with whatever streams are available right now. Called at start, on
    // VOICE_STATE_UPDATES, and whenever the Web Audio tap registry changes
    // (Vesktop/web, where remote streams materialize lazily).
    private reconcileParticipantAudio(): void {
        if (!this.audioMixer) return;
        const currentUserIds = new Set(this.tiles.map(t => t.userId));

        // Add/replace links for each current participant.
        for (const tile of this.tiles) {
            const stream = this.deps.getParticipantAudioStream(tile.userId);
            const linked = this.participantStreamLinks.get(tile.userId);
            if (!stream) {
                if (linked) {
                    this.audioMixer.removeTrack(`user:${tile.userId}`);
                    this.participantStreamLinks.delete(tile.userId);
                }
                continue;
            }
            if (linked === stream) continue; // already wired with this exact stream
            this.audioMixer.addTrack(`user:${tile.userId}`, stream);
            this.participantStreamLinks.set(tile.userId, stream);
        }

        // Drop links for users no longer present.
        for (const userId of Array.from(this.participantStreamLinks.keys())) {
            if (!currentUserIds.has(userId)) {
                this.audioMixer.removeTrack(`user:${userId}`);
                this.participantStreamLinks.delete(userId);
            }
        }
    }

    // Scan the Web Audio tap registry for any stream with video tracks and
    // link it into the matching participant's tile so the compositor draws
    // it. This is the screenshare path — on Vesktop/web, Discord's Output
    // class captures screenshare video onto the same MediaStream our
    // webAudioTap already grabs, so we don't need STREAM_CREATE to fire
    // (it's unreliable across client builds). Registry id shapes observed:
    //   "userId", "userId_screen", "userId/stream", "streamKey",
    //   "streamKey:stream", etc. We match by tile.userId being a substring
    //   of the registry id.
    private reconcileScreenshares(): void {
        if (!this.compositor) return;

        const tiles = this.tiles.slice();
        const userIdsWithVideo = new Map<string, MediaStream>();
        for (const [id, tap] of getAllTappedStreams()) {
            if (tap.stream.getVideoTracks().length === 0) continue;
            // Find which participant this stream belongs to. Prefer exact
            // match, fall back to substring.
            for (const tile of tiles) {
                if (id === tile.userId || id.includes(tile.userId)) {
                    userIdsWithVideo.set(tile.userId, tap.stream);
                    break;
                }
            }
        }

        // Attach/update links for active screenshares.
        for (const [userId, stream] of userIdsWithVideo) {
            const linked = this.screenshareLinks.get(userId);
            if (linked && linked.stream === stream) continue;

            // Tear down stale link (different stream for same user).
            if (linked) {
                linked.videoEl.srcObject = null;
                linked.videoEl.remove();
            }

            const videoEl = document.createElement("video");
            videoEl.autoplay = true;
            videoEl.muted = true;
            videoEl.playsInline = true;
            // Same fix as the composite canvas: must be kept in the composited
            // viewport or Chromium skips the video decoder for the element,
            // and drawImage(videoEl) then paints nothing. visibility:hidden
            // keeps it in layout but invisible, behind everything.
            videoEl.style.cssText = "position:fixed;top:0;left:0;width:640px;height:360px;visibility:hidden;pointer-events:none;z-index:-9999;";
            document.body.appendChild(videoEl);
            videoEl.srcObject = stream;

            videoEl.addEventListener("loadedmetadata", () => {
                logger.info(`screenshare video for ${userId}: loadedmetadata, ${videoEl.videoWidth}x${videoEl.videoHeight}`);
            });
            videoEl.addEventListener("playing", () => {
                logger.info(`screenshare video for ${userId}: playing (readyState=${videoEl.readyState})`);
            });
            videoEl.addEventListener("error", () => {
                logger.error(`screenshare video for ${userId}: error`, videoEl.error);
            });

            videoEl.play()
                .then(() => logger.info(`screenshare video.play resolved for ${userId}`))
                .catch(err => logger.warn(`screenshare video.play failed for ${userId}`, err));

            this.screenshareLinks.set(userId, { stream, videoEl });
            const idx = this.tiles.findIndex(t => t.userId === userId);
            if (idx >= 0) {
                this.tiles[idx] = { ...this.tiles[idx], streaming: true, videoEl };
            }
            logger.info(`screenshare linked for user ${userId} (video tracks=${stream.getVideoTracks().length}, readyState=${videoEl.readyState})`);
        }

        // Drop links for users whose screenshare is no longer in the registry.
        for (const userId of Array.from(this.screenshareLinks.keys())) {
            if (userIdsWithVideo.has(userId)) continue;
            const link = this.screenshareLinks.get(userId)!;
            link.videoEl.srcObject = null;
            link.videoEl.remove();
            this.screenshareLinks.delete(userId);
            const idx = this.tiles.findIndex(t => t.userId === userId);
            if (idx >= 0) {
                this.tiles[idx] = { ...this.tiles[idx], streaming: false, videoEl: null };
            }
            logger.info(`screenshare unlinked for user ${userId}`);
        }

        this.compositor.setTiles(this.tiles);
    }

    onMuteStateChanged(): void {
        if (!this.audioMixer) return;
        const shouldRecord = !this.deps.getSelfMuted() || this.deps.settings.store.narrateWhileMuted;
        if (shouldRecord) {
            if (!this.micStream) {
                this.deps.getMicStream().then(s => {
                    if (!s) return;
                    this.micStream = s;
                    this.audioMixer!.addTrack("self-mic", s);
                });
            }
        } else {
            this.audioMixer.removeTrack("self-mic");
        }
    }

    ingestChatMessage(m: ChatMessage): void {
        this.chatLogger?.pushMessage(m).catch(err => logger.error("chatLogger.pushMessage", err));
        this.chatPanel?.pushMessage(m);
    }

    editChatMessage(m: ChatMessage): void {
        this.chatLogger?.editMessage(m).catch(err => logger.error("chatLogger.editMessage", err));
        this.chatPanel?.editMessage(m);
    }

    deleteChatMessage(id: string, placeholderFromCache: ChatMessage | null): void {
        if (placeholderFromCache) {
            this.chatLogger?.deleteMessage(placeholderFromCache).catch(err => logger.error(err));
        }
        this.chatPanel?.deleteMessage(id);
    }

    private onRecorderError(err: Error): void {
        logger.error("recorder error, rolling over", err);
        // fire-and-forget rollover; keep session alive
        if (this.handle === null) return;
        this.deps.native.rolloverVideo(this.handle)
            .then(() => this.compositor?.stop()
                .then(() => this.compositor?.start(this.audioMixer!.destinationTrack)))
            .catch(e => {
                logger.error("rollover failed; aborting", e);
                this.aborted = true;
                this.stop();
            });
    }

    async stop(): Promise<void> {
        if (this.handle === null) return;
        if (this.reconcilePollHandle !== null) {
            clearInterval(this.reconcilePollHandle);
            this.reconcilePollHandle = null;
        }
        // Unsubscribe from tap updates first so no late reconciles try to
        // touch a closing mixer.
        this.tapUnsubscribe?.();
        this.tapUnsubscribe = null;
        for (const [key] of Array.from(this.taps)) await this.removeStreamInternal(key);
        await this.compositor?.stop();
        await this.audioMixer?.close();
        // End the loopback capture — this releases the user's screen/window
        // audio selection. Must happen after mixer.close so the tracks aren't
        // yanked out from under the encoder mid-flush.
        if (this.loopbackStream) {
            for (const t of this.loopbackStream.getTracks()) {
                try { t.stop(); } catch { /* ignore */ }
            }
            this.loopbackStream = null;
        }
        this.participantStreamLinks.clear();
        for (const { videoEl } of this.screenshareLinks.values()) {
            try { videoEl.srcObject = null; videoEl.remove(); } catch { /* ignore */ }
        }
        this.screenshareLinks.clear();

        const endTs = Date.now();
        const meta = this.initialMeta();
        meta.endTs = endTs;
        meta.durationMs = endTs - this.startedAt;
        meta.droppedFrameCount = this.compositor?.droppedFrames ?? 0;
        meta.abnormalExit = this.aborted;
        await this.deps.native.writeMetadata(this.handle, meta as any);

        const { path: dir } = await this.deps.native.finalize(this.handle);

        const format = this.deps.settings.store.outputFormat;
        if (format === "mkv" || format === "mp4") {
            const startedAt = Date.now();
            if (format === "mp4") {
                this.deps.onToast("Converting to MP4 via ffmpeg — this can take a while…");
            }
            try {
                const { path: converted } = await this.deps.native.ffmpegRemuxDir(dir, {
                    format,
                    ffmpegPath: this.deps.settings.store.ffmpegPath,
                    keepWebm: this.deps.settings.store.keepWebmAfterRemux
                });
                const secs = Math.round((Date.now() - startedAt) / 1000);
                logger.info(`ffmpeg ${format} produced ${converted} in ${secs}s`);
            } catch (err) {
                logger.error(`ffmpeg ${format} conversion failed`, err);
                this.deps.onToast(`ffmpeg ${format.toUpperCase()} conversion failed; .webm was still saved`);
            }
        }

        this.handle = null;
        this.channelId = null;
        this.tiles = [];
        this.audioMixer = null;
        this.compositor = null;
        // dispose() tears down the hidden <video>/ImageDecoder elements the
        // panel keeps alive for animated media. Without this they'd leak
        // across sessions.
        this.chatPanel?.dispose();
        this.chatPanel = null;
        this.chatLogger = null;
        this.micStream?.getTracks().forEach(t => t.stop());
        this.micStream = null;

        sessionStore.set({ state: "idle" });

        if (this.deps.settings.store.notifyOnStop) {
            this.deps.onToast(`Saved to ${dir}`, () => this.deps.native.revealInFileManager(dir));
        }
    }

    private async removeStreamInternal(streamKey: string): Promise<void> {
        const tap = this.taps.get(streamKey);
        if (!tap) return;
        this.audioMixer?.removeTrack(`stream:${streamKey}`);
        tap.dispose();
        this.taps.delete(streamKey);
    }

    private initialMeta(): SessionMetadata {
        return {
            channelId: this.channelId ?? "",
            channelName: this.channelId ? this.deps.getChannelName(this.channelId) : "",
            guildId: this.channelId ? this.deps.getGuildId(this.channelId) : null,
            guildName: this.channelId ? this.deps.getGuildName(this.deps.getGuildId(this.channelId)) : "",
            startTs: this.startedAt,
            participantIds: this.tiles.map(t => t.userId),
            streamerIds: this.tiles.filter(t => t.streaming).map(t => t.userId),
            settingsSnapshot: { ...this.deps.settings.store }
        };
    }

    // Exposed to index.tsx so MESSAGE_REACTION_* flux handlers can feed
    // reactions back into the panel only for currently-visible messages.
    get currentChatPanel(): ChatPanelRenderer | null {
        return this.chatPanel;
    }

    private buildMentionResolvers(): MentionResolvers {
        return {
            resolveUser: id => {
                const u = UserStore.getUser(id);
                if (!u) return null;
                const name = (u as any).globalName || u.username;
                const guildId = this.channelId ? this.deps.getGuildId(this.channelId) : null;
                let color: string | undefined;
                if (guildId) {
                    const member = (GuildMemberStore as any).getMember?.(guildId, id);
                    if (member?.colorString) color = member.colorString;
                }
                return { label: `@${name}`, color };
            },
            resolveRole: id => {
                const guildId = this.channelId ? this.deps.getGuildId(this.channelId) : null;
                if (!guildId) return null;
                const role = (GuildStore as any).getRole?.(guildId, id);
                if (!role) return null;
                return { label: `@${role.name}`, color: role.colorString || "#99aab5" };
            },
            resolveChannel: id => {
                const c = ChannelStore.getChannel(id);
                if (!c) return null;
                return { label: `#${(c as any).name}` };
            }
        };
    }
}

function extractUserId(streamKey: string): string {
    return parseStreamKey(streamKey)?.userId ?? "";
}
