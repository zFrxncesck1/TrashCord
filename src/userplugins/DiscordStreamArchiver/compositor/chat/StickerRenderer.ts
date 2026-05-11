import type { ChatSticker } from "../../types";
import type { ImageCache } from "./ImageCache";
import type { FrameLookup } from "./EmbedRenderer";

export const STICKER_SIZE = 160;

export function stickerUrl(s: ChatSticker): string | null {
    if (s.formatType === 3) return null; // Lottie: no static image available
    const ext = s.formatType === 4 ? "gif" : "png";
    return `https://media.discordapp.net/stickers/${s.id}.${ext}`;
}

export function stickerHeight(): number {
    return STICKER_SIZE;
}

export function drawSticker(
    ctx: CanvasRenderingContext2D,
    sticker: ChatSticker,
    x: number, y: number,
    images: ImageCache,
    animated?: FrameLookup
): void {
    const url = stickerUrl(sticker);
    if (!url) {
        // Lottie placeholder: grey box with sticker name.
        ctx.save();
        ctx.fillStyle = "#2b2d31";
        ctx.fillRect(x, y, STICKER_SIZE, STICKER_SIZE);
        ctx.fillStyle = "#b5bac1";
        ctx.font = "12px Whitney, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(sticker.name, x + STICKER_SIZE / 2, y + STICKER_SIZE / 2);
        ctx.textAlign = "left";
        ctx.restore();
        return;
    }
    const frame = animated?.getFrame(url);
    if (frame) {
        ctx.drawImage(frame, x, y, STICKER_SIZE, STICKER_SIZE);
        return;
    }
    const img = images.get(url);
    if (img) {
        ctx.drawImage(img, x, y, STICKER_SIZE, STICKER_SIZE);
    } else {
        ctx.fillStyle = "#2b2d31";
        ctx.fillRect(x, y, STICKER_SIZE, STICKER_SIZE);
    }
}
