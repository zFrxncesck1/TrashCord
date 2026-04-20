/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Minimal GIF parser — drop-in replacement for gifuct-js

export interface ParsedGif {
    lsd: { width: number; height: number; };
    gct: number[][];
    frames: RawFrame[];
}

interface RawFrame {
    dims: { left: number; top: number; width: number; height: number; };
    delay: number;
    disposalType: number;
    transparentIndex: number | null;
    lct: number[][] | null;
    lzwData: Uint8Array;
    minCodeSize: number;
    interlaced: boolean;
}

export interface ParsedFrame {
    patch: Uint8ClampedArray;
    dims: { left: number; top: number; width: number; height: number; };
    delay: number;
    disposalType: number;
    transparentIndex: number;
}

export function parseGIF(buffer: ArrayBuffer): ParsedGif {
    const data = new Uint8Array(buffer);
    let pos = 6; // skip header ("GIF89a" / "GIF87a")

    const readUint16 = () => { const v = data[pos] | (data[pos + 1] << 8); pos += 2; return v; };

    const readColorTable = (size: number): number[][] => {
        const count = 2 ** (size + 1);
        const table: number[][] = [];
        for (let i = 0; i < count; i++) table.push([data[pos++], data[pos++], data[pos++]]);
        return table;
    };

    const readSubBlocks = (): Uint8Array => {
        const chunks: number[] = [];
        let len = data[pos++];
        while (len > 0) { for (let i = 0; i < len; i++) chunks.push(data[pos++]); len = data[pos++]; }
        return new Uint8Array(chunks);
    };

    const skipSubBlocks = () => { let len = data[pos++]; while (len > 0) { pos += len; len = data[pos++]; } };

    // Logical Screen Descriptor
    const width = readUint16();
    const height = readUint16();
    const packed = data[pos++];
    const gctSize = packed & 0x07;
    const hasGct = (packed >> 7) & 1;
    pos += 2; // background color index + pixel aspect ratio

    const gct: number[][] = hasGct ? readColorTable(gctSize) : [];
    const frames: RawFrame[] = [];

    let delay = 0;
    let disposalType = 0;
    let transparentIndex: number | null = null;

    while (pos < data.length) {
        const byte = data[pos++];
        if (byte === 0x3B) break; // trailer

        if (byte === 0x21) { // extension
            const label = data[pos++];
            if (label === 0xF9) { // graphic control extension
                pos++; // block size (always 4)
                const gcPacked = data[pos++];
                disposalType = (gcPacked >> 2) & 0x07;
                const hasTransparent = gcPacked & 0x01;
                delay = readUint16();
                const tIdx = data[pos++];
                transparentIndex = hasTransparent ? tIdx : null;
                pos++; // block terminator
            } else {
                skipSubBlocks();
            }
            continue;
        }

        if (byte === 0x2C) { // image descriptor
            const left = readUint16();
            const top = readUint16();
            const imgWidth = readUint16();
            const imgHeight = readUint16();
            const imgPacked = data[pos++];
            const hasLct = (imgPacked >> 7) & 1;
            const interlaced = !!((imgPacked >> 6) & 1);
            const lctSize = imgPacked & 0x07;
            const lct = hasLct ? readColorTable(lctSize) : null;
            const minCodeSize = data[pos++];
            const lzwData = readSubBlocks();

            frames.push({ dims: { left, top, width: imgWidth, height: imgHeight }, delay, disposalType, transparentIndex, lct, lzwData, minCodeSize, interlaced });
            delay = 0; disposalType = 0; transparentIndex = null;
        }
    }

    return { lsd: { width, height }, gct, frames };
}

function lzwDecode(minCodeSize: number, data: Uint8Array): number[] {
    const clearCode = 1 << minCodeSize;
    const eoi = clearCode + 1;

    const buildInitTable = () => {
        const t: number[][] = [];
        for (let i = 0; i < clearCode; i++) t.push([i]);
        t.push([clearCode]); t.push([eoi]);
        return t;
    };

    let table = buildInitTable();
    let nextCode = eoi + 1;
    let codeSize = minCodeSize + 1;

    let pos = 0, bitBuf = 0, bitsLeft = 0;
    const readCode = (): number => {
        while (bitsLeft < codeSize) {
            if (pos >= data.length) return -1;
            bitBuf |= data[pos++] << bitsLeft;
            bitsLeft += 8;
        }
        const code = bitBuf & ((1 << codeSize) - 1);
        bitBuf >>= codeSize; bitsLeft -= codeSize;
        return code;
    };

    const output: number[] = [];
    let code = readCode();
    if (code === clearCode) code = readCode();
    if (code < 0 || code >= table.length) return output;

    output.push(...table[code]);
    let prevCode = code;

    while (true) {
        code = readCode();
        if (code < 0 || code === eoi) break;

        if (code === clearCode) {
            table = buildInitTable(); nextCode = eoi + 1; codeSize = minCodeSize + 1;
            code = readCode();
            if (code < 0 || code === eoi) break;
            output.push(...table[code]); prevCode = code;
            continue;
        }

        let entry: number[];
        if (code < table.length) {
            entry = table[code];
        } else if (code === nextCode) {
            const prev = table[prevCode]; entry = [...prev, prev[0]];
        } else break;

        output.push(...entry);

        if (nextCode < 4096) {
            table.push([...table[prevCode], entry[0]]);
            if (++nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
        }

        prevCode = code;
    }

    return output;
}

function deinterlace(pixels: number[], width: number, height: number): number[] {
    const out = new Array(pixels.length);
    const passes = [{ s: 0, step: 8 }, { s: 4, step: 8 }, { s: 2, step: 4 }, { s: 1, step: 2 }];
    let idx = 0;
    for (const { s, step } of passes)
        for (let row = s; row < height; row += step)
            for (let col = 0; col < width; col++)
                out[row * width + col] = pixels[idx++];
    return out;
}

export function decompressFrames(parsed: ParsedGif, _full: boolean): ParsedFrame[] {
    return parsed.frames.map(frame => {
        const ct = frame.lct ?? parsed.gct;
        let pixels = lzwDecode(frame.minCodeSize, frame.lzwData);
        if (frame.interlaced) pixels = deinterlace(pixels, frame.dims.width, frame.dims.height);

        const count = frame.dims.width * frame.dims.height;
        const patch = new Uint8ClampedArray(count * 4);

        for (let i = 0; i < count; i++) {
            const ci = pixels[i] ?? 0;
            if (frame.transparentIndex !== null && ci === frame.transparentIndex) {
                patch[i * 4 + 3] = 0;
            } else {
                const c = ct[ci] ?? [0, 0, 0];
                patch[i * 4] = c[0]; patch[i * 4 + 1] = c[1]; patch[i * 4 + 2] = c[2]; patch[i * 4 + 3] = 255;
            }
        }

        return { patch, dims: frame.dims, delay: frame.delay, disposalType: frame.disposalType, transparentIndex: frame.transparentIndex ?? 0 };
    });
}