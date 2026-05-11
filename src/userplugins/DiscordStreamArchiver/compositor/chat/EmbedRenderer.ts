import type { ChatEmbed } from "../../types";
import type { ImageCache } from "./ImageCache";
import { STICKER_SIZE } from "./StickerRenderer";

// Minimal interface the embed renderer needs to read decoded animation
// frames. Keeps this module independent of the concrete AnimatedEmoteCache.
export interface FrameLookup {
    getFrame(url: string): CanvasImageSource | null;
}

// Bare-media embeds: Discord renders these without chrome (no border, no
// title, no description) — just the media. A raw Tenor GIF URL, a direct
// image link, or a Twitter/Giphy gifv all land here. Everything else
// (type "rich", "link", "video") keeps the full embed box.
function isBareMedia(emb: ChatEmbed): boolean {
    if (emb.type !== "gifv" && emb.type !== "image") return false;
    return !!(emb.image?.url || emb.video?.url || emb.thumbnail?.url);
}

const EMBED_BG = "#2f3136";
const EMBED_BORDER_DEFAULT = "#202225";
const LINK_COLOR = "#00b0f4";
const AUTHOR_COLOR = "#ffffff";
const CONTENT_COLOR = "#dcddde";
const FOOTER_COLOR = "#b5bac1";
const FIELD_NAME_COLOR = "#ffffff";
const EMBED_PADDING = 10;
const EMBED_THUMB_SIZE = 60;
const LINE_HEIGHT = 20;
const SMALL_LINE_HEIGHT = 16;
const FIELD_GAP = 8;

const DEFAULT_MAX_WIDTH = 320;
const LINK_ONLY_MAX_WIDTH = 450;
const LINK_ONLY_IMAGE_MAX_HEIGHT = 288;

const EMBED_TITLE_FONT = "bold 14px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const EMBED_BODY_FONT = "13px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const FIELD_NAME_FONT = "bold 13px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const FIELD_VALUE_FONT = "13px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const FOOTER_FONT = "12px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export interface EmbedVariant {
    maxWidth: number;
    maxImageHeight: number;
}

export function embedVariant(linkOnly: boolean): EmbedVariant {
    return linkOnly
        ? { maxWidth: LINK_ONLY_MAX_WIDTH, maxImageHeight: LINK_ONLY_IMAGE_MAX_HEIGHT }
        : { maxWidth: DEFAULT_MAX_WIDTH, maxImageHeight: 200 };
}

export function embedHeight(
    ctx: CanvasRenderingContext2D,
    emb: ChatEmbed,
    variant: EmbedVariant,
    contentWidth: number
): number {
    if (isBareMedia(emb)) return bareMediaSize(emb, variant, contentWidth).h;

    const boxW = Math.min(variant.maxWidth, contentWidth);
    const innerWidth = boxW - EMBED_PADDING * 2 - 4 - (emb.thumbnail ? EMBED_THUMB_SIZE + EMBED_PADDING : 0);
    let h = EMBED_PADDING * 2;
    if (emb.author?.name) h += SMALL_LINE_HEIGHT;
    if (emb.title) h += LINE_HEIGHT;
    if (emb.description) {
        ctx.font = EMBED_BODY_FONT;
        h += wrapText(ctx, emb.description, innerWidth).length * LINE_HEIGHT;
    }
    if (emb.fields && emb.fields.length > 0) {
        h += fieldsHeight(ctx, emb.fields, innerWidth);
    }
    if (emb.image?.url || emb.video?.url) {
        const imgW = emb.image?.width ?? emb.video?.width ?? innerWidth;
        const imgH = emb.image?.height ?? emb.video?.height ?? 180;
        const scale = Math.min((boxW - EMBED_PADDING * 2 - 4) / imgW, variant.maxImageHeight / imgH, 1);
        h += Math.round(imgH * scale) + 6;
    }
    if (emb.footer?.text) h += SMALL_LINE_HEIGHT + 4;
    return Math.max(h, EMBED_THUMB_SIZE + EMBED_PADDING * 2);
}

// Sizing for a bare-media embed: fit the media into variant dims, preserving
// the source aspect ratio. Used for both height-report and draw. Pasted
// sticker links are a special case — they arrive as image-type embeds with
// the source dimensions reported by Discord (often 320x320), but we want
// them rendered at the same fixed 160x160 size as actual sticker
// attachments so they read as stickers, not generic image embeds.
function bareMediaSize(
    emb: ChatEmbed,
    variant: EmbedVariant,
    contentWidth: number
): { w: number; h: number; url: string } {
    const url = emb.video?.url ?? emb.image?.url ?? emb.thumbnail!.url;
    if (/\/stickers\/\d+\./i.test(url)) {
        return { w: STICKER_SIZE, h: STICKER_SIZE, url };
    }
    const srcW = emb.image?.width ?? emb.video?.width ?? emb.thumbnail?.width ?? variant.maxWidth;
    const srcH = emb.image?.height ?? emb.video?.height ?? emb.thumbnail?.height ?? variant.maxImageHeight;
    const maxW = Math.min(variant.maxWidth, contentWidth);
    const scale = Math.min(maxW / srcW, variant.maxImageHeight / srcH, 1);
    return { w: Math.round(srcW * scale), h: Math.round(srcH * scale), url };
}

function fieldsHeight(ctx: CanvasRenderingContext2D, fields: NonNullable<ChatEmbed["fields"]>, innerWidth: number): number {
    let h = 0;
    const groups = groupInlineFields(fields);
    for (const g of groups) {
        if (g.length === 1) {
            h += fieldHeight(ctx, g[0], innerWidth);
        } else {
            const colW = Math.floor((innerWidth - FIELD_GAP * (g.length - 1)) / g.length);
            h += Math.max(...g.map(f => fieldHeight(ctx, f, colW)));
        }
        h += FIELD_GAP;
    }
    return h;
}

function fieldHeight(ctx: CanvasRenderingContext2D, field: { name: string; value: string }, w: number): number {
    ctx.font = FIELD_NAME_FONT;
    const nameLines = wrapText(ctx, field.name, w).length;
    ctx.font = FIELD_VALUE_FONT;
    const valueLines = Math.min(4, wrapText(ctx, field.value, w).length);
    return nameLines * LINE_HEIGHT + valueLines * LINE_HEIGHT;
}

function groupInlineFields(fields: NonNullable<ChatEmbed["fields"]>): Array<NonNullable<ChatEmbed["fields"]>> {
    const out: Array<NonNullable<ChatEmbed["fields"]>> = [];
    let buffer: NonNullable<ChatEmbed["fields"]> = [];
    for (const f of fields) {
        if (f.inline) {
            buffer.push(f);
            if (buffer.length === 3) {
                out.push(buffer);
                buffer = [];
            }
        } else {
            if (buffer.length) { out.push(buffer); buffer = []; }
            out.push([f]);
        }
    }
    if (buffer.length) out.push(buffer);
    return out;
}

export function drawEmbed(
    ctx: CanvasRenderingContext2D,
    emb: ChatEmbed,
    x: number, y: number,
    contentWidth: number,
    variant: EmbedVariant,
    images: ImageCache,
    animated?: FrameLookup
): number {
    // Bare-media: no chrome, just the frame. Matches how Discord renders
    // gifv/image-type embeds (direct image URL, Tenor/Giphy/Twitter GIF).
    // drawMedia does its own save/restore — no extra bookkeeping needed.
    if (isBareMedia(emb)) {
        const { w, h, url } = bareMediaSize(emb, variant, contentWidth);
        // For gifv: primary URL is the MP4 (video); poster fallback is the
        // thumbnail/image URL so blank frames while the video loads (or if
        // it fails) still show the static poster.
        const posterUrl = url !== emb.image?.url ? emb.image?.url : undefined;
        const thumbUrl = posterUrl ?? (url !== emb.thumbnail?.url ? emb.thumbnail?.url : undefined);
        drawMedia(ctx, url, x, y, w, h, images, animated, thumbUrl);
        return h;
    }

    const boxW = Math.min(variant.maxWidth, contentWidth);
    const boxH = embedHeight(ctx, emb, variant, contentWidth);
    const borderColor = colorToCss(emb.color) ?? EMBED_BORDER_DEFAULT;

    ctx.save();
    ctx.fillStyle = EMBED_BG;
    if ("roundRect" in ctx) {
        (ctx as any).roundRect(x, y, boxW, boxH, 4);
        ctx.fill();
    } else {
        ctx.fillRect(x, y, boxW, boxH);
    }
    ctx.fillStyle = borderColor;
    ctx.fillRect(x, y, 4, boxH);

    const innerX = x + 4 + EMBED_PADDING;
    const hasThumb = !!emb.thumbnail?.url;
    const innerRight = hasThumb ? x + boxW - EMBED_PADDING - EMBED_THUMB_SIZE - EMBED_PADDING : x + boxW - EMBED_PADDING;
    const innerW = Math.max(1, innerRight - innerX);
    let innerY = y + EMBED_PADDING;

    if (emb.author?.name) {
        if (emb.author.iconUrl) {
            const icon = images.get(emb.author.iconUrl);
            if (icon) ctx.drawImage(icon, innerX, innerY, SMALL_LINE_HEIGHT - 2, SMALL_LINE_HEIGHT - 2);
        }
        ctx.font = "12px Whitney, sans-serif";
        ctx.fillStyle = CONTENT_COLOR;
        ctx.textBaseline = "top";
        const textOffset = emb.author.iconUrl ? SMALL_LINE_HEIGHT + 4 : 0;
        ctx.fillText(truncateForWidth(ctx, emb.author.name, Math.max(1, innerW - textOffset)), innerX + textOffset, innerY);
        innerY += SMALL_LINE_HEIGHT;
    }

    if (emb.title) {
        ctx.font = EMBED_TITLE_FONT;
        ctx.fillStyle = emb.url ? LINK_COLOR : AUTHOR_COLOR;
        ctx.fillText(truncateForWidth(ctx, emb.title, innerW), innerX, innerY);
        innerY += LINE_HEIGHT;
    }

    if (emb.description) {
        ctx.font = EMBED_BODY_FONT;
        ctx.fillStyle = CONTENT_COLOR;
        for (const line of wrapText(ctx, emb.description, innerW)) {
            ctx.fillText(line, innerX, innerY);
            innerY += LINE_HEIGHT;
        }
    }

    if (emb.fields) {
        innerY = drawFields(ctx, emb.fields, innerX, innerY, innerW);
    }

    if (emb.image?.url || emb.video?.url) {
        // Prefer the video URL when both are present — for "video" embeds
        // (YouTube etc.) the thumbnail is already in emb.image, and the
        // video field holds the actual media for gifv. We keep the play
        // overlay for non-gifv video embeds so it reads as clickable.
        const preferVideo = emb.type === "gifv" && !!emb.video?.url;
        const url = preferVideo ? emb.video!.url : (emb.image?.url ?? emb.video!.url);
        const imgW = emb.image?.width ?? emb.video?.width ?? innerW;
        const imgH = emb.image?.height ?? emb.video?.height ?? 180;
        const scale = Math.min((boxW - EMBED_PADDING * 2 - 4) / imgW, variant.maxImageHeight / imgH, 1);
        const dw = Math.round(imgW * scale);
        const dh = Math.round(imgH * scale);
        const posterUrl = preferVideo ? emb.image?.url : undefined;
        drawMedia(ctx, url, innerX, innerY + 4, dw, dh, images, animated, posterUrl);
        if (emb.video?.url && emb.type !== "gifv") drawPlayOverlay(ctx, innerX, innerY + 4, dw, dh);
        innerY += dh + 4;
    }

    if (emb.footer?.text) {
        let fx = innerX;
        if (emb.footer.iconUrl) {
            const icon = images.get(emb.footer.iconUrl);
            if (icon) ctx.drawImage(icon, fx, innerY, SMALL_LINE_HEIGHT - 2, SMALL_LINE_HEIGHT - 2);
            fx += SMALL_LINE_HEIGHT + 4;
        }
        ctx.font = FOOTER_FONT;
        ctx.fillStyle = FOOTER_COLOR;
        ctx.fillText(truncateForWidth(ctx, emb.footer.text, Math.max(1, innerW - (fx - innerX))), fx, innerY);
        innerY += SMALL_LINE_HEIGHT;
    }

    if (hasThumb && emb.thumbnail) {
        const tx = x + boxW - EMBED_PADDING - EMBED_THUMB_SIZE;
        const ty = y + EMBED_PADDING;
        drawImageBox(ctx, emb.thumbnail.url, tx, ty, EMBED_THUMB_SIZE, EMBED_THUMB_SIZE, images);
    }

    ctx.restore();
    return boxH;
}

function drawFields(
    ctx: CanvasRenderingContext2D,
    fields: NonNullable<ChatEmbed["fields"]>,
    x: number, y: number, width: number
): number {
    const groups = groupInlineFields(fields);
    for (const g of groups) {
        if (g.length === 1) {
            y = drawField(ctx, g[0], x, y, width);
        } else {
            const colW = Math.floor((width - FIELD_GAP * (g.length - 1)) / g.length);
            const baseY = y;
            let maxY = y;
            for (let i = 0; i < g.length; i++) {
                const cx = x + i * (colW + FIELD_GAP);
                const ny = drawField(ctx, g[i], cx, baseY, colW);
                if (ny > maxY) maxY = ny;
            }
            y = maxY;
        }
        y += FIELD_GAP;
    }
    return y;
}

function drawField(
    ctx: CanvasRenderingContext2D,
    field: { name: string; value: string },
    x: number, y: number, width: number
): number {
    ctx.font = FIELD_NAME_FONT;
    ctx.fillStyle = FIELD_NAME_COLOR;
    ctx.textBaseline = "top";
    for (const line of wrapText(ctx, field.name, width)) {
        ctx.fillText(line, x, y);
        y += LINE_HEIGHT;
    }
    ctx.font = FIELD_VALUE_FONT;
    ctx.fillStyle = CONTENT_COLOR;
    const valueLines = wrapText(ctx, field.value, width).slice(0, 4);
    for (const line of valueLines) {
        ctx.fillText(line, x, y);
        y += LINE_HEIGHT;
    }
    return y;
}

function drawImageBox(
    ctx: CanvasRenderingContext2D,
    url: string,
    x: number, y: number, w: number, h: number,
    images: ImageCache
): void {
    ctx.save();
    ctx.fillStyle = "#202225";
    ctx.fillRect(x, y, w, h);
    const img = images.get(url);
    if (img) ctx.drawImage(img, x, y, w, h);
    ctx.restore();
}

// Draw any media URL, preferring an animated frame if available. Falls back
// to the static HTMLImageElement, then to an optional poster URL (used for
// gifv embeds where the primary URL is an MP4 that may fail or still be
// loading — without the poster the embed would paint as a blank grey box).
function drawMedia(
    ctx: CanvasRenderingContext2D,
    url: string,
    x: number, y: number, w: number, h: number,
    images: ImageCache,
    animated?: FrameLookup,
    posterUrl?: string
): void {
    ctx.save();
    ctx.fillStyle = "#202225";
    ctx.fillRect(x, y, w, h);
    const frame = animated?.getFrame(url);
    if (frame) {
        ctx.drawImage(frame, x, y, w, h);
    } else {
        const img = images.get(url);
        if (img) {
            ctx.drawImage(img, x, y, w, h);
        } else if (posterUrl) {
            const poster = images.get(posterUrl);
            if (poster) ctx.drawImage(poster, x, y, w, h);
        }
    }
    ctx.restore();
}

function drawPlayOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = 24;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 10);
    ctx.lineTo(cx + 12, cy);
    ctx.lineTo(cx - 8, cy + 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    if (!text) return [""];
    const paragraphs = text.split(/\n/);
    const lines: string[] = [];
    for (const para of paragraphs) {
        const words = para.split(/\s+/);
        let current = "";
        for (const w of words) {
            if (!w) continue;
            const test = current ? current + " " + w : w;
            if (ctx.measureText(test).width > maxWidth && current) {
                lines.push(current);
                current = w;
            } else {
                current = test;
            }
        }
        if (current) lines.push(current); else lines.push("");
    }
    return lines.length ? lines : [""];
}

function truncateForWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (!text) return "";
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + "…";
}

function colorToCss(c: number | undefined): string | null {
    if (typeof c !== "number" || c === 0) return null;
    return "#" + c.toString(16).padStart(6, "0");
}
