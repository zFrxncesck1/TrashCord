import type { TileSpec, Rect } from "../types";
import { layout } from "./GridLayout";
import { drawAvatarTile, drawStreamTile } from "./TileRenderer";
import type { ChatPanelRenderer } from "./ChatPanelRenderer";
import { logger } from "../utils";

export interface CompositorOpts {
    width: number;
    height: number;
    framerate: number;
    bakeChat: boolean;
    chatPanelWidthPct: number;  // 0-100
    streamerOverlayBorder: boolean;
    codec: "vp9" | "vp8" | "av1";
    videoBitsPerSecond: number;
    timesliceMs: number;        // e.g. 1000
}

export interface CompositorCallbacks {
    onChunk: (bytes: Uint8Array) => Promise<void>;
    onError: (err: Error) => void;
    getAvatar: (tile: TileSpec) => HTMLImageElement | ImageBitmap | null;
}

export class Compositor {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private chatPanel: ChatPanelRenderer | null = null;
    private tiles: TileSpec[] = [];
    private rAFHandle: number | null = null;
    private recorder: MediaRecorder | null = null;
    private audioTrack: MediaStreamTrack | null = null;
    private chatCanvas: HTMLCanvasElement | null = null;

    droppedFrames = 0;
    private lastFrameTs = 0;
    private targetFrameIntervalMs: number;
    private chunkQueue: Promise<void> = Promise.resolve();
    // Toggles on each drawFrame; when a visible message has animated content
    // we flip chatPanel.dirty on every 2nd tick so the chat layer repaints at
    // ~half framerate (enough for GIF emotes to appear smooth without burning
    // CPU when nothing is animating).
    private animTick = 0;

    constructor(
        private readonly opts: CompositorOpts,
        private readonly cb: CompositorCallbacks
    ) {
        this.canvas = document.createElement("canvas");
        // videoResolution defines the GRID area. When chat is baked in, the
        // chat panel is appended to the right, so the canvas is wider than
        // the video area rather than the video area being squeezed to make
        // room. Keeps streams at their native aspect.
        const videoW = opts.width;
        const videoH = opts.height;
        const chatW = opts.bakeChat ? Math.floor(videoW * opts.chatPanelWidthPct / 100) : 0;
        this.canvas.width = videoW + chatW;
        this.canvas.height = videoH;
        // captureStream ONLY produces frames if the canvas is actually
        // rendered by Chromium's paint pipeline. Several things prevent
        // that: display:none, off-viewport positioning (left:-99999px),
        // and sometimes 1x1 transparent elements that the compositor
        // treats as dead layers. Most reliable: full-size canvas at
        // position:fixed (so it doesn't push Discord's layout) with
        // visibility:hidden (kept in layout + still rendered to its
        // backing bitmap, just not shown) and behind everything.
        this.canvas.style.cssText =
            "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;z-index:-9999;";
        document.body.appendChild(this.canvas);

        const ctx = this.canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d context unavailable");
        this.ctx = ctx;
        this.targetFrameIntervalMs = 1000 / opts.framerate;

        if (opts.bakeChat) {
            this.chatCanvas = document.createElement("canvas");
            this.chatCanvas.width = chatW;
            this.chatCanvas.height = videoH;
        }
    }

    attachChatPanel(panel: ChatPanelRenderer): void {
        this.chatPanel = panel;
    }

    setTiles(tiles: TileSpec[]): void {
        this.tiles = tiles;
    }

    async start(audioTrack: MediaStreamTrack): Promise<void> {
        this.audioTrack = audioTrack;

        // Draw the first frame BEFORE captureStream so the canvas track
        // starts in "live" state (some Chromium versions produce an inert
        // track otherwise, which makes MediaRecorder silently emit 0 bytes).
        this.drawFrame();

        const stream = (this.canvas as any).captureStream(this.opts.framerate) as MediaStream;
        stream.addTrack(audioTrack);
        logger.info(`captureStream tracks: video=${stream.getVideoTracks().length} audio=${stream.getAudioTracks().length}`);
        for (const t of stream.getTracks()) {
            logger.info(`  track ${t.kind} readyState=${t.readyState} enabled=${t.enabled} muted=${t.muted}`);
        }

        const mimeType = this.resolveMimeType();
        logger.info(`MediaRecorder mimeType=${mimeType}`);
        this.recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: this.opts.videoBitsPerSecond
        });

        let chunkCount = 0;
        this.recorder.ondataavailable = ev => {
            if (!ev.data || ev.data.size === 0) {
                logger.warn(`dataavailable with size=${ev.data?.size ?? "none"}`);
                return;
            }
            chunkCount++;
            if (chunkCount <= 3 || chunkCount % 30 === 0) {
                logger.info(`chunk #${chunkCount} size=${ev.data.size}`);
            }
            // Serialize chunk writes: WebM stream is order-dependent,
            // and concurrent async handlers would let IPC deliver out of order.
            const blob = ev.data;
            this.chunkQueue = this.chunkQueue.then(async () => {
                try {
                    const buf = new Uint8Array(await blob.arrayBuffer());
                    await this.cb.onChunk(buf);
                } catch (err) {
                    this.cb.onError(err as Error);
                }
            });
        };
        this.recorder.onerror = ev => {
            const e = (ev as any).error ?? new Error("MediaRecorder error");
            logger.error("recorder error", e);
            this.cb.onError(e);
        };
        this.recorder.onstart = () => logger.info("MediaRecorder started");
        this.recorder.onstop = () => logger.info(`MediaRecorder stopped (total chunks received=${chunkCount})`);
        this.recorder.start(this.opts.timesliceMs);

        // Start the rAF loop AFTER the recorder is running so no early ticks
        // are wasted before capture is active.
        this.rAFHandle = requestAnimationFrame(this.tick);
    }

    async stop(): Promise<void> {
        if (this.rAFHandle !== null) {
            cancelAnimationFrame(this.rAFHandle);
            this.rAFHandle = null;
        }
        if (this.recorder && this.recorder.state !== "inactive") {
            const done = new Promise<void>(resolve => {
                const prev = this.recorder!.onstop;
                this.recorder!.onstop = ev => {
                    try { prev?.call(this.recorder!, ev); } catch { /* ignore */ }
                    resolve();
                };
            });
            this.recorder.stop();
            await done;
        }
        // Drain any queued chunk writes so the final flush reaches disk.
        await this.chunkQueue;
        // Release the off-screen canvas from the DOM.
        this.canvas.remove();
    }

    private resolveMimeType(): string {
        const codecMap = {
            vp9: ["video/webm;codecs=vp9,opus"],
            vp8: ["video/webm;codecs=vp8,opus"],
            av1: ["video/webm;codecs=av01,opus"]
        };
        const primary = codecMap[this.opts.codec];
        for (const mt of primary) {
            if (MediaRecorder.isTypeSupported(mt)) return mt;
        }
        // fallback chain
        for (const mt of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
            if (MediaRecorder.isTypeSupported(mt)) return mt;
        }
        throw new Error("no supported MediaRecorder mimeType");
    }

    private tick = (ts: number) => {
        if (this.rAFHandle === null) return;
        if (this.lastFrameTs && ts - this.lastFrameTs > this.targetFrameIntervalMs * 1.5) {
            this.droppedFrames++;
        }
        this.lastFrameTs = ts;
        this.drawFrame();
        this.rAFHandle = requestAnimationFrame(this.tick);
    };

    private drawFrame(): void {
        const height = this.canvas.height;
        const videoW = this.opts.width;
        const chatW = this.chatCanvas?.width ?? 0;
        this.ctx.save();
        this.ctx.fillStyle = "#202225";
        this.ctx.fillRect(0, 0, videoW + chatW, height);

        const gridRect: Rect = { x: 0, y: 0, width: videoW, height };

        // When one or more screenshares are active, take over the grid with
        // just those — the whole point of viewing is to see the stream, and
        // cramping it into one small tile next to avatar boxes defeats that.
        // Falls back to the full participant grid when nobody is streaming.
        const streamingTiles = this.tiles.filter(t => t.streaming && t.videoEl);
        const tilesToRender = streamingTiles.length > 0 ? streamingTiles : this.tiles;

        const rects = layout(tilesToRender.length, gridRect);
        for (let i = 0; i < rects.length; i++) {
            const tile = tilesToRender[i];
            const rect = rects[i];
            if (tile.streaming && tile.videoEl) {
                drawStreamTile(this.ctx, rect, tile, { borderGlow: this.opts.streamerOverlayBorder });
            } else {
                drawAvatarTile(this.ctx, rect, tile, this.cb.getAvatar(tile));
            }
        }

        if (this.opts.bakeChat && this.chatPanel && this.chatCanvas) {
            const chatBmp = this.chatPanel.getBitmap();
            this.ctx.drawImage(chatBmp, videoW, 0);
        }

        this.ctx.restore();

        // Animated content in the chat panel needs a periodic dirty-flip so
        // decoded frames reach the composite. Skip this nudge when nothing
        // visible is animated so static chat doesn't churn CPU.
        if (this.opts.bakeChat && this.chatPanel) {
            this.animTick = (this.animTick + 1) & 1;
            if (this.animTick === 0 && this.chatPanel.hasVisibleAnimation()) {
                this.chatPanel.markDirty();
            }
        }
    }
}
