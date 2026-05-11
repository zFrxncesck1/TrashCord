import type { ChatMessage } from "../../types";
import type { ContentToken } from "./ContentParser";

export type MessageKind = "jumbo-emote" | "link-only-embed" | "sticker-only" | "normal";

export const JUMBO_EMOTE_MAX_COUNT = 27;
export const EMOTE_SIZE_DEFAULT = 22;
export const EMOTE_SIZE_JUMBO = 48;
export const STICKER_SIZE = 160;
export const LINK_ONLY_EMBED_MAX_WIDTH = 450;
export const LINK_ONLY_EMBED_IMAGE_MAX_HEIGHT = 288;

export function classify(m: ChatMessage, tokens: ContentToken[]): MessageKind {
    if (isStickerOnly(m)) return "sticker-only";
    if (isLinkOnlyEmbed(m, tokens)) return "link-only-embed";
    if (isJumboEmote(m, tokens)) return "jumbo-emote";
    return "normal";
}

function isStickerOnly(m: ChatMessage): boolean {
    if (!m.stickers || m.stickers.length !== 1) return false;
    if (m.content.trim() !== "") return false;
    if (m.attachments.length !== 0) return false;
    if ((m.embeds?.length ?? 0) !== 0) return false;
    if (m.replyTo) return false;
    return true;
}

function isLinkOnlyEmbed(m: ChatMessage, tokens: ContentToken[]): boolean {
    if ((m.embeds?.length ?? 0) !== 1) return false;
    if (m.attachments.length !== 0) return false;
    if ((m.stickers?.length ?? 0) !== 0) return false;
    if (m.replyTo) return false;
    const trimmed = m.content.trim();
    if (!/^https?:\/\/\S+$/.test(trimmed)) return false;
    const linkCount = tokens.filter(t => t.kind === "link").length;
    return linkCount === 1;
}

function isJumboEmote(m: ChatMessage, tokens: ContentToken[]): boolean {
    if (m.attachments.length !== 0) return false;
    if ((m.embeds?.length ?? 0) !== 0) return false;
    if ((m.stickers?.length ?? 0) !== 0) return false;
    if (m.replyTo) return false;
    let emoteCount = 0;
    for (const t of tokens) {
        if (t.kind === "emote" || t.kind === "unicodeEmoji") { emoteCount++; continue; }
        if (t.kind === "text") {
            if (/\S/.test(t.text)) return false;
            continue;
        }
        return false;
    }
    return emoteCount >= 1 && emoteCount <= JUMBO_EMOTE_MAX_COUNT;
}
