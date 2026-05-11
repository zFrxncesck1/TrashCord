import type { ContentToken, TextStyle } from "./ContentParser";

export type LayoutOp =
    | { op: "text"; x: number; text: string; style: TextStyle }
    | { op: "emote"; x: number; url: string; size: number }
    | { op: "unicodeEmoji"; x: number; char: string; size: number }
    | { op: "mention"; x: number; label: string; color?: string }
    | { op: "link"; x: number; text: string; href: string };

export type RowKind = "inline" | "codeBlock" | "blockquote";

export interface RowMeta {
    kind: RowKind;
    code?: { lang: string; text: string };
    blockquote?: { rows: LayoutOp[][]; rowMeta: RowMeta[] };
    height: number;
    // x-coordinate where the row's last visible op ends, in row-local
    // pixels. Inline rows only — undefined for code/blockquote. Used by
    // the chat panel to position trailing inline labels (e.g. the gray
    // "(edit time)" after an edited message's last content line).
    endX?: number;
}

export interface LaidOutContent {
    rows: LayoutOp[][];
    rowMeta: RowMeta[];
}

const LINE_HEIGHT = 20;
const CODE_BLOCK_LINE_HEIGHT = 18;

export function layoutContent(
    ctx: CanvasRenderingContext2D,
    tokens: ContentToken[],
    maxWidth: number,
    emoteSize: number
): LaidOutContent {
    const rows: LayoutOp[][] = [];
    const rowMeta: RowMeta[] = [];

    let currentRow: LayoutOp[] = [];
    let currentWidth = 0;

    const flush = () => {
        // Row height is the tallest op in the row. Text/mentions/links sit at
        // LINE_HEIGHT; emotes and unicode emoji can be 22 (default) or 48
        // (jumbo). A jumbo row without this max would be reported as 20 high
        // and the renderer would stomp the bottom of the emote with the next
        // message.
        let rowHeight = LINE_HEIGHT;
        for (const op of currentRow) {
            if (op.op === "emote" || op.op === "unicodeEmoji") {
                if (op.size > rowHeight) rowHeight = op.size;
            }
        }
        rows.push(currentRow);
        rowMeta.push({ kind: "inline", height: rowHeight, endX: currentWidth });
        currentRow = [];
        currentWidth = 0;
    };

    for (const tok of tokens) {
        if (tok.kind === "codeBlock") {
            if (currentRow.length > 0) flush();
            const lines = tok.text.split("\n");
            rows.push([]);
            rowMeta.push({ kind: "codeBlock", code: { lang: tok.lang, text: tok.text }, height: lines.length * CODE_BLOCK_LINE_HEIGHT + 12 });
            continue;
        }
        if (tok.kind === "blockquote") {
            if (currentRow.length > 0) flush();
            const inner = layoutContent(ctx, tok.inner, Math.max(1, maxWidth - 16), emoteSize);
            const innerHeight = inner.rowMeta.reduce((acc, m) => acc + m.height, 0);
            rows.push([]);
            rowMeta.push({
                kind: "blockquote",
                blockquote: { rows: inner.rows, rowMeta: inner.rowMeta },
                height: Math.max(LINE_HEIGHT, innerHeight)
            });
            continue;
        }

        if (tok.kind === "emote") {
            if (currentWidth + emoteSize > maxWidth && currentWidth > 0) flush();
            currentRow.push({ op: "emote", x: currentWidth, url: tok.url, size: emoteSize });
            currentWidth += emoteSize + 2;
            continue;
        }

        if (tok.kind === "unicodeEmoji") {
            const w = emoteSize === 22 ? ctx.measureText(tok.char).width : emoteSize;
            if (currentWidth + w > maxWidth && currentWidth > 0) flush();
            currentRow.push({ op: "unicodeEmoji", x: currentWidth, char: tok.char, size: emoteSize });
            currentWidth += w + 2;
            continue;
        }

        if (tok.kind === "mention") {
            ctx.font = "500 14px Whitney, sans-serif";
            const w = ctx.measureText(tok.label).width + 6;
            if (currentWidth + w > maxWidth && currentWidth > 0) flush();
            currentRow.push({ op: "mention", x: currentWidth, label: tok.label, color: tok.color });
            currentWidth += w + 2;
            continue;
        }

        if (tok.kind === "link") {
            ctx.font = "14px Whitney, sans-serif";
            const w = ctx.measureText(tok.text).width;
            if (currentWidth + w > maxWidth && currentWidth > 0) flush();
            currentRow.push({ op: "link", x: currentWidth, text: tok.text, href: tok.href });
            currentWidth += w + 2;
            continue;
        }

        if (tok.kind !== "text") continue;
        setFontForStyle(ctx, tok.style);
        const paragraphs = tok.text.split(/\n/);
        for (let p = 0; p < paragraphs.length; p++) {
            if (p > 0) flush();
            const para = paragraphs[p];
            if (!para) continue;
            const words = para.split(/(\s+)/);
            for (const w of words) {
                if (!w) continue;
                const width = ctx.measureText(w).width;
                if (currentWidth + width > maxWidth && currentWidth > 0 && !/^\s+$/.test(w)) {
                    flush();
                    if (/^\s+$/.test(w)) continue;
                }
                currentRow.push({ op: "text", x: currentWidth, text: w, style: tok.style });
                currentWidth += width;
            }
        }
    }

    if (currentRow.length > 0) flush();

    while (rows.length > 1 && rows[rows.length - 1].length === 0 && rowMeta[rowMeta.length - 1].kind === "inline") {
        rows.pop();
        rowMeta.pop();
    }

    return { rows, rowMeta };
}

export function setFontForStyle(ctx: CanvasRenderingContext2D, style: TextStyle): void {
    if (style.code) {
        ctx.font = "13px Consolas, 'Courier New', monospace";
        return;
    }
    const weight = style.bold ? "bold" : "";
    const slant = style.italic ? "italic" : "";
    ctx.font = `${slant} ${weight} 14px Whitney, 'Helvetica Neue', Helvetica, Arial, sans-serif`.trim();
}
