import type { TileSpec, Rect } from "../types";

const PILL_BG = "rgba(0, 0, 0, 0.65)";
const PILL_TEXT = "#ffffff";
const PILL_PADDING = 8;
const PILL_HEIGHT = 28;
const PILL_FONT = "500 14px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const AVATAR_FRAC = 0.35;  // avatar diameter as fraction of tile min dimension

const FALLBACK_BG = "#2f3136";
const STREAM_BORDER = "#eb459e";

export function drawAvatarTile(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    tile: TileSpec,
    avatar: HTMLImageElement | ImageBitmap | null
): void {
    ctx.save();
    ctx.fillStyle = tile.bannerColor || FALLBACK_BG;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    if (avatar) {
        const avatarSize = Math.min(rect.width, rect.height) * AVATAR_FRAC;
        const ax = rect.x + rect.width / 2 - avatarSize / 2;
        const ay = rect.y + rect.height / 2 - avatarSize / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, ax, ay, avatarSize, avatarSize);
        ctx.restore();
    }

    drawPill(ctx, rect, tile);
    ctx.restore();
}

export interface StreamTileOpts {
    borderGlow: boolean;
}

export function drawStreamTile(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    tile: TileSpec,
    opts: StreamTileOpts
): void {
    ctx.save();
    // Black letterbox fill first; stream paints into a preserved-aspect sub-
    // rect inside. Prevents squishing when tile aspect differs from the
    // native video aspect (common in 2-up / 3-up grids even at 16:9 tiles).
    ctx.fillStyle = "#000";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (tile.videoEl) {
        const vw = tile.videoEl.videoWidth;
        const vh = tile.videoEl.videoHeight;
        if (vw > 0 && vh > 0) {
            const srcAspect = vw / vh;
            const dstAspect = rect.width / rect.height;
            let drawW: number;
            let drawH: number;
            if (srcAspect > dstAspect) {
                drawW = rect.width;
                drawH = rect.width / srcAspect;
            } else {
                drawH = rect.height;
                drawW = rect.height * srcAspect;
            }
            const cx = rect.x + (rect.width - drawW) / 2;
            const cy = rect.y + (rect.height - drawH) / 2;
            ctx.drawImage(tile.videoEl, cx, cy, drawW, drawH);
        }
    } else {
        ctx.fillStyle = FALLBACK_BG;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }

    if (opts.borderGlow) {
        ctx.strokeStyle = STREAM_BORDER;
        ctx.lineWidth = 4;
        ctx.shadowColor = STREAM_BORDER;
        ctx.shadowBlur = 12;
        ctx.strokeRect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4);
        ctx.shadowBlur = 0;
    }

    drawPill(ctx, rect, tile);
    ctx.restore();
}

function drawPill(ctx: CanvasRenderingContext2D, rect: Rect, tile: TileSpec): void {
    const label = tile.displayName;
    const iconWidth = (tile.muted ? 18 : 0) + (tile.deafened ? 18 : 0);
    ctx.font = PILL_FONT;
    const textWidth = ctx.measureText(label).width;
    const pillWidth = textWidth + iconWidth + PILL_PADDING * 2 + (iconWidth > 0 ? PILL_PADDING : 0);

    const px = rect.x + 12;
    const py = rect.y + rect.height - PILL_HEIGHT - 12;

    ctx.fillStyle = PILL_BG;
    ctx.beginPath();
    if ("roundRect" in ctx) {
        ctx.roundRect(px, py, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2);
    } else {
        // fallback for older engines
        ctx.rect(px, py, pillWidth, PILL_HEIGHT);
    }
    ctx.fill();

    let cursor = px + PILL_PADDING;
    if (tile.muted) {
        ctx.fillStyle = "#ed4245";
        ctx.fillText("🔇", cursor, py + PILL_HEIGHT / 2 + 5);
        cursor += 18;
    }
    if (tile.deafened) {
        ctx.fillStyle = "#ed4245";
        ctx.fillText("🔈", cursor, py + PILL_HEIGHT / 2 + 5);
        cursor += 18;
    }
    if (iconWidth > 0) cursor += PILL_PADDING;
    ctx.fillStyle = PILL_TEXT;
    ctx.textBaseline = "middle";
    ctx.fillText(label, cursor, py + PILL_HEIGHT / 2);
}
