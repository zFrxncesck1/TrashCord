import type { ChatReaction } from "../../types";
import type { ImageCache } from "./ImageCache";

const PILL_HEIGHT = 22;
const PILL_GAP = 4;
const PILL_PADDING_X = 6;
const ICON_SIZE = 18;
const PILL_BG = "#2b2d31";
const PILL_BG_ME = "#3f4a5a";
const PILL_FG = "#dcddde";
const PILL_BORDER_ME = "#5865f2";
const PILL_FONT = "13px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export function reactionEmoteUrl(r: ChatReaction): string | null {
    if (!r.emoji.id) return null;
    return `https://cdn.discordapp.com/emojis/${r.emoji.id}.${r.emoji.animated ? "gif" : "png"}?size=32`;
}

export function reactionsHeight(
    ctx: CanvasRenderingContext2D,
    reactions: ChatReaction[],
    maxWidth: number
): number {
    if (reactions.length === 0) return 0;
    ctx.font = PILL_FONT;
    let x = 0;
    let rows = 1;
    for (const r of reactions) {
        const w = pillWidth(ctx, r);
        if (x + w > maxWidth && x > 0) {
            rows++;
            x = 0;
        }
        x += w + PILL_GAP;
    }
    return rows * (PILL_HEIGHT + PILL_GAP);
}

export function drawReactions(
    ctx: CanvasRenderingContext2D,
    reactions: ChatReaction[],
    x: number, y: number,
    maxWidth: number,
    images: ImageCache
): number {
    if (reactions.length === 0) return 0;
    ctx.save();
    ctx.font = PILL_FONT;
    ctx.textBaseline = "middle";
    let cx = x;
    let cy = y;
    for (const r of reactions) {
        const w = pillWidth(ctx, r);
        if (cx - x + w > maxWidth && cx > x) {
            cx = x;
            cy += PILL_HEIGHT + PILL_GAP;
        }
        drawPill(ctx, r, cx, cy, w, images);
        cx += w + PILL_GAP;
    }
    ctx.restore();
    return cy - y + PILL_HEIGHT;
}

function pillWidth(ctx: CanvasRenderingContext2D, r: ChatReaction): number {
    const label = String(r.count);
    const textW = ctx.measureText(label).width;
    return PILL_PADDING_X * 2 + ICON_SIZE + 4 + textW;
}

function drawPill(
    ctx: CanvasRenderingContext2D,
    r: ChatReaction,
    x: number, y: number, w: number,
    images: ImageCache
): void {
    ctx.fillStyle = r.me ? PILL_BG_ME : PILL_BG;
    if ("roundRect" in ctx) {
        (ctx as any).roundRect(x, y, w, PILL_HEIGHT, PILL_HEIGHT / 2);
        ctx.fill();
    } else {
        ctx.fillRect(x, y, w, PILL_HEIGHT);
    }
    if (r.me) {
        ctx.strokeStyle = PILL_BORDER_ME;
        ctx.lineWidth = 1;
        if ("roundRect" in ctx) {
            (ctx as any).roundRect(x, y, w, PILL_HEIGHT, PILL_HEIGHT / 2);
            ctx.stroke();
        }
    }
    const url = reactionEmoteUrl(r);
    if (url) {
        const img = images.get(url);
        if (img) ctx.drawImage(img, x + PILL_PADDING_X, y + (PILL_HEIGHT - ICON_SIZE) / 2, ICON_SIZE, ICON_SIZE);
    } else {
        ctx.fillStyle = PILL_FG;
        ctx.fillText(r.emoji.name, x + PILL_PADDING_X, y + PILL_HEIGHT / 2);
    }
    ctx.fillStyle = PILL_FG;
    ctx.fillText(String(r.count), x + PILL_PADDING_X + ICON_SIZE + 4, y + PILL_HEIGHT / 2);
}
