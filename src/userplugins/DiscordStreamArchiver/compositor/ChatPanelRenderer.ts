import type { ChatAttachment, ChatMessage, ChatReaction, ChatReplyContext } from "../types";
import { ImageCache } from "./chat/ImageCache";
import { AnimatedEmoteCache } from "./chat/AnimatedEmoteCache";
import { VideoFrameCache } from "./chat/VideoFrameCache";
import { parseContent, type MentionResolvers, type ContentToken } from "./chat/ContentParser";
import { layoutContent, setFontForStyle, type LayoutOp, type RowMeta } from "./chat/ContentLayout";
import { classify, EMOTE_SIZE_DEFAULT, EMOTE_SIZE_JUMBO } from "./chat/MessageSizer";
import { drawEmbed, embedHeight, embedVariant } from "./chat/EmbedRenderer";
import { drawSticker, stickerHeight, STICKER_SIZE } from "./chat/StickerRenderer";
import { drawReactions, reactionsHeight } from "./chat/ReactionsRenderer";

const PANEL_BG = "#2f3136";
const AUTHOR_COLOR = "#ffffff";
const CONTENT_COLOR = "#dcddde";
const TIMESTAMP_COLOR = "#72767d";
const REPLY_COLOR = "#b9bbbe";
const LINK_COLOR = "#00b0f4";
const CODE_BG = "#2b2d31";

const MESSAGE_PADDING = 12;
const AVATAR_SIZE = 32;
const REPLY_AVATAR_SIZE = 16;
const ATTACHMENT_MAX_WIDTH = 280;
const ATTACHMENT_MAX_HEIGHT = 200;

const AUTHOR_FONT = "bold 15px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const TIMESTAMP_FONT = "12px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const REPLY_FONT = "12px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const CODE_BLOCK_FONT = "13px Consolas, 'Courier New', monospace";

const LINE_HEIGHT = 20;
const SMALL_LINE_HEIGHT = 16;
const ROW_GAP = 10;

export class ChatPanelRenderer {
    private messages: ChatMessage[] = [];
    private messageHeights = new Map<string, number>();
    private messageTokens = new Map<string, ContentToken[]>();
    // Parallel to messageTokens but holds the originalContent's parsed
    // tokens — only populated for edited messages. The renderer draws
    // these in gray above the current content as edit history.
    private messageOriginalTokens = new Map<string, ContentToken[]>();
    private dirty = true;
    private images: ImageCache;
    private animated: AnimatedEmoteCache;
    private videos: VideoFrameCache;
    private lastVisibleIds = new Set<string>();
    private mentionResolvers: MentionResolvers;

    constructor(private readonly canvas: HTMLCanvasElement, resolvers?: MentionResolvers) {
        this.images = new ImageCache(() => { this.dirty = true; });
        this.animated = new AnimatedEmoteCache(() => { this.dirty = true; });
        this.videos = new VideoFrameCache(() => { this.dirty = true; });
        this.mentionResolvers = resolvers ?? {
            resolveUser: id => ({ label: `<@${id}>`, color: undefined }),
            resolveRole: id => ({ label: `<@&${id}>`, color: undefined }),
            resolveChannel: id => ({ label: `<#${id}>`, color: undefined })
        };
    }

    setMentionResolvers(resolvers: MentionResolvers): void {
        this.mentionResolvers = resolvers;
        this.messageTokens.clear();
        this.messageOriginalTokens.clear();
        this.messageHeights.clear();
        for (const m of this.messages) this.cacheTokens(m);
        for (const m of this.messages) this.messageHeights.set(m.id, this.computeHeight(m));
        this.dirty = true;
    }

    pushMessage(msg: ChatMessage): void {
        const idx = this.messages.findIndex(m => m.id === msg.id);
        if (idx >= 0) this.messages[idx] = msg;
        else this.messages.push(msg);
        this.cacheTokens(msg);
        this.preloadMessageImages(msg);
        this.messageHeights.set(msg.id, this.computeHeight(msg));
        this.dirty = true;
    }

    editMessage(msg: ChatMessage): void {
        const idx = this.messages.findIndex(m => m.id === msg.id);
        if (idx < 0) { this.pushMessage(msg); return; }
        this.messages[idx] = msg;
        this.cacheTokens(msg);
        this.preloadMessageImages(msg);
        this.messageHeights.set(msg.id, this.computeHeight(msg));
        this.dirty = true;
    }

    deleteMessage(id: string): void {
        const idx = this.messages.findIndex(m => m.id === id);
        if (idx < 0) return;
        this.messages.splice(idx, 1);
        this.messageHeights.delete(id);
        this.messageTokens.delete(id);
        this.messageOriginalTokens.delete(id);
        this.dirty = true;
    }

    updateReactions(id: string, mutate: (current: ChatReaction[]) => ChatReaction[]): void {
        const m = this.messages.find(x => x.id === id);
        if (!m) return;
        m.reactions = mutate(m.reactions ?? []);
        this.messageHeights.set(id, this.computeHeight(m));
        this.dirty = true;
    }

    getVisibleMessageIds(): ReadonlySet<string> {
        return this.lastVisibleIds;
    }

    hasVisibleAnimation(): boolean {
        for (const id of this.lastVisibleIds) {
            const m = this.messages.find(x => x.id === id);
            if (m?.hasAnimated) return true;
        }
        return false;
    }

    markDirty(): void { this.dirty = true; }

    getBitmap(): HTMLCanvasElement {
        if (this.dirty) this.render();
        return this.canvas;
    }

    dispose(): void {
        this.animated.dispose();
        this.videos.dispose();
    }

    private cacheTokens(msg: ChatMessage): void {
        this.messageTokens.set(msg.id, parseContent(msg.content, this.mentionResolvers));
        if (msg.originalContent !== undefined) {
            this.messageOriginalTokens.set(msg.id, parseContent(msg.originalContent, this.mentionResolvers));
        } else {
            this.messageOriginalTokens.delete(msg.id);
        }
    }

    private preloadMessageImages(msg: ChatMessage): void {
        this.images.preload(msg.avatarUrl);
        if (msg.replyTo) this.images.preload(msg.replyTo.avatarUrl);
        const tokens = this.messageTokens.get(msg.id) ?? [];
        for (const tok of tokens) {
            if (tok.kind === "emote") {
                this.preloadMaybeAnimated(tok.url, tok.animated);
            }
        }
        for (const att of msg.attachments) {
            if (att.isImage) {
                this.preloadMaybeAnimated(att.url, /\.gif(\?|$)/i.test(att.url));
            }
        }
        for (const emb of msg.embeds ?? []) {
            if (emb.author?.iconUrl) this.images.preload(emb.author.iconUrl);
            if (emb.thumbnail?.url) {
                // Image embeds from pasted Discord-CDN GIF links land in
                // emb.thumbnail (Discord's API uses thumbnail for the
                // small preview, even when there's no separate image
                // field). Route through animated cache when the URL looks
                // like it could be animated — .gif, or a /stickers/
                // URL (which is APNG and often animated even with a .png
                // extension).
                if (isUrlLikelyAnimated(emb.thumbnail.url)) this.preloadMaybeAnimated(emb.thumbnail.url, true);
                else this.images.preload(emb.thumbnail.url);
            }
            if (emb.footer?.iconUrl) this.images.preload(emb.footer.iconUrl);
            const isAnimatedEmbed = emb.type === "gifv";
            if (emb.image?.url) {
                this.preloadMaybeAnimated(emb.image.url, isAnimatedEmbed || isUrlLikelyAnimated(emb.image.url));
            }
            if (emb.video?.url) {
                // MP4/WebM (Tenor/Giphy/Twitter gifv) can't go through
                // HTMLImageElement at all — route them to VideoFrameCache
                // which mounts a hidden <video> element and plays it on
                // loop. The drawMedia path will pick it up via the
                // frame-lookup chain.
                if (/\.(mp4|webm|mov)(\?|$)/i.test(emb.video.url)) {
                    this.videos.preload(emb.video.url);
                    // Poster fallback so the embed isn't blank while the
                    // video is still loading (or if it fails).
                    const poster = emb.image?.url ?? emb.thumbnail?.url;
                    if (poster) this.images.preload(poster);
                } else {
                    this.preloadMaybeAnimated(emb.video.url, isAnimatedEmbed);
                }
            }
        }
        for (const st of msg.stickers ?? []) {
            const url = st.formatType === 4
                ? `https://media.discordapp.net/stickers/${st.id}.gif`
                : st.formatType !== 3
                    ? `https://media.discordapp.net/stickers/${st.id}.png`
                    : null;
            if (!url) continue;
            // formatType 2 = APNG (served at `.png` URL). It is animated and
            // must go through AnimatedEmoteCache, same as GIF (formatType 4).
            this.preloadMaybeAnimated(url, st.formatType === 4 || st.formatType === 2);
        }
        for (const r of msg.reactions ?? []) {
            if (!r.emoji.id) continue;
            const url = `https://cdn.discordapp.com/emojis/${r.emoji.id}.${r.emoji.animated ? "gif" : "png"}?size=32`;
            this.preloadMaybeAnimated(url, !!r.emoji.animated);
        }
    }

    // Animated URLs always go into the static image cache as well: the DOM
    // HTMLImageElement auto-plays GIFs, and with the compositor's periodic
    // dirty-flip each drawImage samples the current frame. That gives a
    // working animation even when ImageDecoder is unavailable or the fetch
    // is blocked. When ImageDecoder does work, getFrame() wins over the
    // static fallback in the draw path.
    private preloadMaybeAnimated(url: string, animated: boolean): void {
        this.images.preload(url);
        if (animated) this.animated.preload(url);
    }

    render(): void {
        const ctx = this.canvas.getContext("2d");
        if (!ctx) return;
        const { width, height } = this.canvas;

        ctx.save();
        ctx.fillStyle = PANEL_BG;
        ctx.fillRect(0, 0, width, height);

        const visible: ChatMessage[] = [];
        let usedHeight = 0;
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            const h = this.messageHeights.get(msg.id) ?? this.computeHeight(msg);
            if (usedHeight + h + ROW_GAP > height) break;
            usedHeight += h + ROW_GAP;
            visible.unshift(msg);
        }

        this.lastVisibleIds = new Set(visible.map(m => m.id));

        let y = height - usedHeight;
        for (const msg of visible) {
            y += this.drawMessage(ctx, msg, y, width);
            y += ROW_GAP;
        }

        ctx.restore();
        this.dirty = false;
    }

    private computeHeight(msg: ChatMessage): number {
        const ctx = this.canvas.getContext("2d");
        if (!ctx) return 50;
        const contentX = MESSAGE_PADDING + AVATAR_SIZE + MESSAGE_PADDING;
        const contentWidth = Math.max(1, this.canvas.width - contentX - MESSAGE_PADDING);

        const tokens = this.messageTokens.get(msg.id) ?? [];
        const kind = classify(msg, tokens);
        const emoteSize = kind === "jumbo-emote" ? EMOTE_SIZE_JUMBO : EMOTE_SIZE_DEFAULT;

        let h = 0;
        if (msg.replyTo) h += SMALL_LINE_HEIGHT + 4;

        h += LINE_HEIGHT;
        if (kind !== "sticker-only" && kind !== "link-only-embed") {
            const origTokens = this.messageOriginalTokens.get(msg.id);
            if (origTokens && origTokens.length > 0) {
                const origLaid = layoutContent(ctx, origTokens, contentWidth, emoteSize);
                for (const meta of origLaid.rowMeta) h += meta.height;
            }
            const laid = layoutContent(ctx, tokens, contentWidth, emoteSize);
            for (const meta of laid.rowMeta) h += meta.height;
        }

        for (const att of msg.attachments) {
            if (att.isImage) h += attachmentDisplayHeight(att) + 6;
            else h += SMALL_LINE_HEIGHT + 4;
        }

        const linkOnly = kind === "link-only-embed";
        for (const emb of msg.embeds ?? []) {
            const v = embedVariant(linkOnly);
            h += embedHeight(ctx, emb, v, contentWidth) + 6;
        }

        if (msg.stickers && msg.stickers.length > 0) {
            h += stickerHeight() + 6;
        }

        if (msg.reactions && msg.reactions.length > 0) {
            h += reactionsHeight(ctx, msg.reactions, contentWidth) + 4;
        }

        return Math.max(h, AVATAR_SIZE);
    }

    private drawMessage(ctx: CanvasRenderingContext2D, msg: ChatMessage, y: number, width: number): number {
        const contentX = MESSAGE_PADDING + AVATAR_SIZE + MESSAGE_PADDING;
        const contentWidth = Math.max(1, width - contentX - MESSAGE_PADDING);
        const tokens = this.messageTokens.get(msg.id) ?? [];
        const kind = classify(msg, tokens);
        const emoteSize = kind === "jumbo-emote" ? EMOTE_SIZE_JUMBO : EMOTE_SIZE_DEFAULT;
        let offset = 0;

        if (msg.replyTo) {
            offset += this.drawReplyHeader(ctx, msg.replyTo, y, contentX, contentWidth) + 4;
        }

        const avatarTop = y + offset;
        this.drawAvatar(ctx, msg.avatarUrl, MESSAGE_PADDING, avatarTop, AVATAR_SIZE);

        ctx.font = AUTHOR_FONT;
        ctx.fillStyle = msg.roleColor ?? AUTHOR_COLOR;
        ctx.textBaseline = "top";
        ctx.fillText(msg.authorName, contentX, avatarTop);
        const authorW = ctx.measureText(msg.authorName).width;

        ctx.font = TIMESTAMP_FONT;
        ctx.fillStyle = TIMESTAMP_COLOR;
        ctx.fillText(formatRel(msg.relativeMs), contentX + authorW + 8, avatarTop + 2);

        offset += LINE_HEIGHT;

        if (kind !== "sticker-only" && kind !== "link-only-embed") {
            // Edit history: render the original (pre-edit) content above the
            // current content, dimmed via globalAlpha. Mirrors how
            // MessageLogger surfaces edits.
            const origTokens = this.messageOriginalTokens.get(msg.id);
            if (origTokens && origTokens.length > 0) {
                const origLaid = layoutContent(ctx, origTokens, contentWidth, emoteSize);
                ctx.save();
                ctx.globalAlpha = 0.45;
                for (let i = 0; i < origLaid.rows.length; i++) {
                    const row = origLaid.rows[i];
                    const meta = origLaid.rowMeta[i];
                    if (meta.kind === "inline") {
                        this.drawContentRow(ctx, row, contentX, y + offset, meta.height);
                    } else if (meta.kind === "codeBlock" && meta.code) {
                        this.drawCodeBlock(ctx, meta.code.text, contentX, y + offset, contentWidth);
                    } else if (meta.kind === "blockquote" && meta.blockquote) {
                        this.drawBlockquote(ctx, meta.blockquote, contentX, y + offset, meta.height);
                    }
                    offset += meta.height;
                }
                ctx.restore();
            }

            const laid = layoutContent(ctx, tokens, contentWidth, emoteSize);
            // Track the last inline row so we can append "(edit time)"
            // immediately after the final visible character without a
            // line break.
            let lastInlineEndX = -1;
            let lastInlineY = 0;
            let lastInlineHeight = LINE_HEIGHT;
            for (let i = 0; i < laid.rows.length; i++) {
                const row = laid.rows[i];
                const meta = laid.rowMeta[i];
                if (meta.kind === "inline") {
                    this.drawContentRow(ctx, row, contentX, y + offset, meta.height);
                    lastInlineEndX = meta.endX ?? 0;
                    lastInlineY = y + offset;
                    lastInlineHeight = meta.height;
                } else if (meta.kind === "codeBlock" && meta.code) {
                    this.drawCodeBlock(ctx, meta.code.text, contentX, y + offset, contentWidth);
                } else if (meta.kind === "blockquote" && meta.blockquote) {
                    this.drawBlockquote(ctx, meta.blockquote, contentX, y + offset, meta.height);
                }
                offset += meta.height;
            }

            if (msg.editedAtMs !== undefined && lastInlineEndX >= 0) {
                // Compute the edit time relative to the recording start. We
                // don't store relativeMs for edits, but timestampMs and
                // relativeMs together pin the session start point:
                // sessionStart = timestampMs - relativeMs.
                const editRel = msg.editedAtMs - (msg.timestampMs - msg.relativeMs);
                ctx.font = TIMESTAMP_FONT;
                ctx.fillStyle = TIMESTAMP_COLOR;
                ctx.textBaseline = "top";
                // Vertically align with the row's text baseline (matches the
                // text positioning in drawContentRow).
                const textY = lastInlineY + (lastInlineHeight - 14) / 2 + 2;
                ctx.fillText(` (${formatRel(editRel)})`, contentX + lastInlineEndX, textY);
            }
        }

        for (const att of msg.attachments) {
            offset += 4;
            if (att.isImage) {
                const h = attachmentDisplayHeight(att);
                const w = att.width && att.height ? Math.round(att.width * (h / att.height)) : ATTACHMENT_MAX_WIDTH;
                this.drawAttachmentImage(ctx, att.url, contentX, y + offset, Math.min(w, ATTACHMENT_MAX_WIDTH), h);
                offset += h;
            } else {
                ctx.font = "14px Whitney, sans-serif";
                ctx.fillStyle = LINK_COLOR;
                ctx.fillText(`📎 ${att.filename}`, contentX, y + offset);
                offset += SMALL_LINE_HEIGHT;
            }
        }

        const linkOnly = kind === "link-only-embed";
        // Composed frame lookup: video (MP4/WebM) first, then decoded
        // animated (ImageDecoder), then fall through to the static image.
        // First hit wins; the static HTMLImageElement path itself animates
        // GIFs thanks to the DOM-attached container in ImageCache.
        const frameLookup = {
            getFrame: (url: string) =>
                this.videos.getFrame(url) ?? this.animated.getFrame(url)
        };
        for (const emb of msg.embeds ?? []) {
            offset += 6;
            const v = embedVariant(linkOnly);
            offset += drawEmbed(ctx, emb, contentX, y + offset, contentWidth, v, this.images, frameLookup);
        }

        if (msg.stickers) {
            for (const st of msg.stickers) {
                offset += 6;
                drawSticker(ctx, st, contentX, y + offset, this.images, frameLookup);
                offset += STICKER_SIZE;
            }
        }

        if (msg.reactions && msg.reactions.length > 0) {
            offset += 4;
            offset += drawReactions(ctx, msg.reactions, contentX, y + offset, contentWidth, this.images);
        }

        return Math.max(offset, AVATAR_SIZE);
    }

    private drawReplyHeader(
        ctx: CanvasRenderingContext2D,
        reply: ChatReplyContext,
        y: number,
        contentX: number,
        contentWidth: number
    ): number {
        ctx.strokeStyle = "#4f545c";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(MESSAGE_PADDING + AVATAR_SIZE / 2, y + SMALL_LINE_HEIGHT);
        ctx.lineTo(MESSAGE_PADDING + AVATAR_SIZE / 2, y + SMALL_LINE_HEIGHT - 8);
        ctx.lineTo(contentX - 4, y + SMALL_LINE_HEIGHT - 8);
        ctx.stroke();

        this.drawAvatar(ctx, reply.avatarUrl, contentX, y, REPLY_AVATAR_SIZE);

        const textX = contentX + REPLY_AVATAR_SIZE + 6;
        const textW = Math.max(1, contentWidth - REPLY_AVATAR_SIZE - 6);
        ctx.font = REPLY_FONT;
        ctx.fillStyle = REPLY_COLOR;
        ctx.textBaseline = "top";
        const authorLabel = `@${reply.authorName}`;
        ctx.fillText(authorLabel, textX, y + 1);
        const authorW = ctx.measureText(authorLabel).width;
        const snippetX = textX + authorW + 6;
        const snippet = truncate(ctx, reply.contentSnippet, Math.max(1, textW - authorW - 6));
        ctx.fillStyle = "#999";
        ctx.fillText(snippet, snippetX, y + 1);

        return SMALL_LINE_HEIGHT;
    }

    private drawContentRow(
        ctx: CanvasRenderingContext2D,
        row: LayoutOp[],
        baseX: number,
        y: number,
        rowHeight: number = LINE_HEIGHT
    ): void {
        ctx.textBaseline = "top";
        // Center each op within the row's true height. For jumbo rows
        // (rowHeight=48) this pushes 14px text down 17px so it sits centered
        // rather than glued to the top.
        const textY = y + (rowHeight - 14) / 2;
        for (const op of row) {
            if (op.op === "text") {
                setFontForStyle(ctx, op.style);
                if (op.style.code) {
                    const w = ctx.measureText(op.text).width + 4;
                    ctx.fillStyle = CODE_BG;
                    ctx.fillRect(baseX + op.x - 2, textY - 2, w, 18);
                }
                ctx.fillStyle = op.style.code ? "#e0e0e0" : CONTENT_COLOR;
                ctx.fillText(op.text, baseX + op.x, textY);
                if (op.style.underline) {
                    const w = ctx.measureText(op.text).width;
                    ctx.fillRect(baseX + op.x, textY + 14, w, 1);
                }
                if (op.style.strike) {
                    const w = ctx.measureText(op.text).width;
                    ctx.fillRect(baseX + op.x, textY + 7, w, 1);
                }
            } else if (op.op === "emote") {
                const size = op.size;
                const emoteY = y + (rowHeight - size) / 2;
                const frame = this.animated.getFrame(op.url);
                if (frame) {
                    ctx.drawImage(frame, baseX + op.x, emoteY, size, size);
                } else {
                    const img = this.images.get(op.url);
                    if (img) ctx.drawImage(img, baseX + op.x, emoteY, size, size);
                    else {
                        ctx.fillStyle = "#444";
                        ctx.fillRect(baseX + op.x, emoteY, size, size);
                    }
                }
            } else if (op.op === "unicodeEmoji") {
                // Scale font roughly with size: normal rows get 14px, jumbo
                // rows get size-8 (so 48 → 40px glyphs which visually match
                // jumbo custom emotes). Vertical center within the row.
                const fontSize = op.size <= 22 ? 14 : op.size - 8;
                ctx.font = `${fontSize}px "Twemoji Mozilla","Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol",sans-serif`;
                ctx.fillStyle = CONTENT_COLOR;
                ctx.fillText(op.char, baseX + op.x, y + (rowHeight - fontSize) / 2);
            } else if (op.op === "mention") {
                ctx.font = "500 14px Whitney, sans-serif";
                ctx.fillStyle = op.color ?? LINK_COLOR;
                ctx.fillText(op.label, baseX + op.x, textY);
            } else if (op.op === "link") {
                ctx.font = "14px Whitney, sans-serif";
                ctx.fillStyle = LINK_COLOR;
                ctx.fillText(op.text, baseX + op.x, textY);
            }
        }
    }

    private drawCodeBlock(
        ctx: CanvasRenderingContext2D,
        text: string,
        x: number, y: number, width: number
    ): void {
        const lines = text.split("\n");
        const h = lines.length * 18 + 12;
        ctx.fillStyle = CODE_BG;
        if ("roundRect" in ctx) {
            (ctx as any).roundRect(x, y, width, h, 4);
            ctx.fill();
        } else {
            ctx.fillRect(x, y, width, h);
        }
        ctx.font = CODE_BLOCK_FONT;
        ctx.fillStyle = "#e0e0e0";
        ctx.textBaseline = "top";
        let cy = y + 6;
        for (const line of lines) {
            ctx.fillText(line, x + 8, cy);
            cy += 18;
        }
    }

    private drawBlockquote(
        ctx: CanvasRenderingContext2D,
        inner: { rows: LayoutOp[][]; rowMeta: RowMeta[] },
        x: number, y: number, h: number
    ): void {
        ctx.fillStyle = "#4f545c";
        ctx.fillRect(x, y, 4, h);
        let cy = y;
        for (let i = 0; i < inner.rows.length; i++) {
            const innerMeta = inner.rowMeta[i];
            // Only the inline case makes sense inside a blockquote; code
            // blocks and nested blockquotes aren't produced by the parser
            // here. Treat everything inline-style with its own height.
            this.drawContentRow(ctx, inner.rows[i], x + 8, cy, innerMeta.height);
            cy += innerMeta.height;
        }
    }

    private drawAvatar(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number): void {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const img = this.images.get(url);
        if (img) ctx.drawImage(img, x, y, size, size);
        else {
            ctx.fillStyle = "#444";
            ctx.fillRect(x, y, size, size);
        }
        ctx.restore();
    }

    private drawAttachmentImage(
        ctx: CanvasRenderingContext2D,
        url: string,
        x: number, y: number, w: number, h: number
    ): void {
        ctx.save();
        ctx.fillStyle = "#202225";
        ctx.fillRect(x, y, w, h);
        const frame = this.animated.getFrame(url);
        if (frame) ctx.drawImage(frame, x, y, w, h);
        else {
            const img = this.images.get(url);
            if (img) ctx.drawImage(img, x, y, w, h);
        }
        ctx.restore();
    }
}

// URL-heuristic for "could this be animated media?". .gif is obvious; the
// trickier case is Discord's /stickers/<id>.<ext> URLs, which are usually
// APNG even with a .png extension — we route those through the animated
// decoder and let the decoder itself decide (it skips recursive scheduling
// when the file turns out to be single-frame, so the cost of a false
// positive is just one decode).
function isUrlLikelyAnimated(url: string): boolean {
    if (/\.gif(\?|$)/i.test(url)) return true;
    if (/\/stickers\/\d+\.(png|webp|gif)(\?|$|%)/i.test(url)) return true;
    return false;
}

function attachmentDisplayHeight(att: ChatAttachment): number {
    if (!att.width || !att.height) return ATTACHMENT_MAX_HEIGHT;
    const scale = Math.min(ATTACHMENT_MAX_WIDTH / att.width, ATTACHMENT_MAX_HEIGHT / att.height, 1);
    return Math.round(att.height * scale);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (!text) return "";
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + "…";
}

function formatRel(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
