export interface TextStyle {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    code: boolean;
}

export type ContentToken =
    | { kind: "text"; text: string; style: TextStyle }
    | { kind: "emote"; name: string; id: string; animated: boolean; url: string }
    | { kind: "unicodeEmoji"; char: string }
    | { kind: "mention"; subtype: "user" | "role" | "channel"; id: string; label: string; color?: string }
    | { kind: "codeBlock"; lang: string; text: string }
    | { kind: "blockquote"; inner: ContentToken[] }
    | { kind: "link"; text: string; href: string };

export interface MentionResolution {
    label: string;
    color?: string;
}

export interface MentionResolvers {
    resolveUser(id: string): MentionResolution | null;
    resolveRole(id: string): MentionResolution | null;
    resolveChannel(id: string): MentionResolution | null;
}

const PLAIN: TextStyle = { bold: false, italic: false, underline: false, strike: false, code: false };

const CODE_BLOCK_RX = /```(\w*)\n?([\s\S]*?)```/g;
const URL_RX = /https?:\/\/[^\s<>]+/g;
const EMOTE_RX = /<(a?):([a-zA-Z0-9_~]+):(\d{5,25})>/g;
const MENTION_USER_RX = /<@!?(\d{5,25})>/g;
const MENTION_ROLE_RX = /<@&(\d{5,25})>/g;
const MENTION_CHANNEL_RX = /<#(\d{5,25})>/g;
// Coarse unicode emoji regex: BMP symbols + misc pictographs + supplementary
// pictographs + emoji presentation selectors + regional indicators. Not a
// perfect coverage but enough for jumbo count.
const UNICODE_EMOJI_RX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]️?/gu;

function emoteUrl(id: string, animated: boolean): string {
    return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=48`;
}

// Line-level extraction first: code blocks and blockquotes span multiple
// lines and must not be re-scanned as inline content.
export function parseContent(input: string, resolvers: MentionResolvers): ContentToken[] {
    if (!input) return [];
    const tokens: ContentToken[] = [];

    const blockMatches: Array<{ start: number; end: number; lang: string; text: string }> = [];
    for (const m of input.matchAll(CODE_BLOCK_RX)) {
        const idx = m.index ?? 0;
        blockMatches.push({ start: idx, end: idx + m[0].length, lang: m[1] || "", text: m[2].trim() });
    }
    let cursor = 0;
    for (const b of blockMatches) {
        if (b.start > cursor) {
            tokens.push(...parseNonCodeBlockRegion(input.slice(cursor, b.start), resolvers));
        }
        tokens.push({ kind: "codeBlock", lang: b.lang, text: b.text });
        cursor = b.end;
    }
    if (cursor < input.length) {
        tokens.push(...parseNonCodeBlockRegion(input.slice(cursor), resolvers));
    }
    return tokens;
}

function parseNonCodeBlockRegion(region: string, resolvers: MentionResolvers): ContentToken[] {
    const out: ContentToken[] = [];
    const lines = region.split("\n");
    let inlineBuffer: string[] = [];
    const flushInline = () => {
        if (inlineBuffer.length === 0) return;
        const text = inlineBuffer.join("\n");
        out.push(...parseInline(text, resolvers));
        inlineBuffer = [];
    };
    for (const line of lines) {
        if (line.startsWith("> ")) {
            flushInline();
            const inner = parseInline(line.slice(2), resolvers);
            out.push({ kind: "blockquote", inner });
        } else {
            inlineBuffer.push(line);
        }
    }
    flushInline();
    return out;
}

interface Replacement {
    start: number;
    end: number;
    token: ContentToken;
}

function parseInline(text: string, resolvers: MentionResolvers): ContentToken[] {
    if (!text) return [];
    const replacements: Replacement[] = [];

    for (const m of text.matchAll(EMOTE_RX)) {
        const idx = m.index ?? 0;
        replacements.push({
            start: idx, end: idx + m[0].length,
            token: {
                kind: "emote",
                name: m[2], id: m[3],
                animated: m[1] === "a",
                url: emoteUrl(m[3], m[1] === "a")
            }
        });
    }
    for (const m of text.matchAll(MENTION_USER_RX)) {
        const idx = m.index ?? 0;
        const res = resolvers.resolveUser(m[1]);
        if (!res) continue;
        replacements.push({ start: idx, end: idx + m[0].length, token: { kind: "mention", subtype: "user", id: m[1], label: res.label, color: res.color } });
    }
    for (const m of text.matchAll(MENTION_ROLE_RX)) {
        const idx = m.index ?? 0;
        const res = resolvers.resolveRole(m[1]);
        if (!res) continue;
        replacements.push({ start: idx, end: idx + m[0].length, token: { kind: "mention", subtype: "role", id: m[1], label: res.label, color: res.color } });
    }
    for (const m of text.matchAll(MENTION_CHANNEL_RX)) {
        const idx = m.index ?? 0;
        const res = resolvers.resolveChannel(m[1]);
        if (!res) continue;
        replacements.push({ start: idx, end: idx + m[0].length, token: { kind: "mention", subtype: "channel", id: m[1], label: res.label, color: res.color } });
    }
    for (const m of text.matchAll(URL_RX)) {
        const idx = m.index ?? 0;
        if (overlapsClaimed(idx, idx + m[0].length, replacements)) continue;
        replacements.push({ start: idx, end: idx + m[0].length, token: { kind: "link", text: m[0], href: m[0] } });
    }
    for (const m of text.matchAll(UNICODE_EMOJI_RX)) {
        const idx = m.index ?? 0;
        if (overlapsClaimed(idx, idx + m[0].length, replacements)) continue;
        replacements.push({ start: idx, end: idx + m[0].length, token: { kind: "unicodeEmoji", char: m[0] } });
    }

    replacements.sort((a, b) => a.start - b.start);

    const result: ContentToken[] = [];
    let cursor = 0;
    for (const r of replacements) {
        if (r.start < cursor) continue;
        if (r.start > cursor) {
            result.push(...parseStyledText(text.slice(cursor, r.start)));
        }
        result.push(r.token);
        cursor = r.end;
    }
    if (cursor < text.length) {
        result.push(...parseStyledText(text.slice(cursor)));
    }
    return result;
}

function overlapsClaimed(start: number, end: number, claimed: Replacement[]): boolean {
    return claimed.some(c => !(end <= c.start || start >= c.end));
}

// Apply inline markdown (bold/italic/underline/strike/code). Greedy pass
// per marker; longer markers matched first so ** isn't partially captured
// as *.
function parseStyledText(text: string): ContentToken[] {
    if (!text) return [];

    interface StyleSpan { start: number; end: number; style: Partial<TextStyle>; inner: string; }

    const markers: Array<{ rx: RegExp; styleMods: Partial<TextStyle> }> = [
        { rx: /\*\*\*([^*]+?)\*\*\*/g, styleMods: { bold: true, italic: true } },
        { rx: /\*\*([^*]+?)\*\*/g, styleMods: { bold: true } },
        { rx: /__([^_]+?)__/g, styleMods: { underline: true } },
        { rx: /~~([^~]+?)~~/g, styleMods: { strike: true } },
        { rx: /\*([^*]+?)\*/g, styleMods: { italic: true } },
        { rx: /_([^_]+?)_/g, styleMods: { italic: true } },
        { rx: /`([^`]+?)`/g, styleMods: { code: true } }
    ];

    const spans: StyleSpan[] = [];
    const skip = new Array<boolean>(text.length).fill(false);
    for (const { rx, styleMods } of markers) {
        for (const m of text.matchAll(rx)) {
            const idx = m.index ?? 0;
            if (skip[idx]) continue;
            const start = idx;
            const end = idx + m[0].length;
            spans.push({ start, end, style: { ...styleMods }, inner: m[1] });
            for (let i = start; i < end; i++) skip[i] = true;
        }
    }
    spans.sort((a, b) => a.start - b.start);

    const out: ContentToken[] = [];
    let cursor = 0;
    for (const s of spans) {
        if (s.start > cursor) {
            out.push({ kind: "text", text: text.slice(cursor, s.start), style: { ...PLAIN } });
        }
        out.push({ kind: "text", text: s.inner, style: { ...PLAIN, ...s.style } });
        cursor = s.end;
    }
    if (cursor < text.length) {
        out.push({ kind: "text", text: text.slice(cursor), style: { ...PLAIN } });
    }
    return out;
}
