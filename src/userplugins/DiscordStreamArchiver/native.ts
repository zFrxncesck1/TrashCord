// Runs in Electron main process. Auto-exposed to the renderer as
// VencordNative.pluginHelpers.DiscordStreamArchiver.<method>.

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import type { IpcMainInvokeEvent } from "electron";
import { app, shell } from "electron";

interface Handle {
    dir: string;
    videoParts: string[];     // relative filenames, in order
    currentVideoFd: fs.promises.FileHandle;
    currentVideoPath: string;
    jsonlFd: fs.promises.FileHandle;
    csvFd: fs.promises.FileHandle;
    writeQueue: Promise<void>;  // single-concurrent writer
    finalized: boolean;
}

const handles = new Map<number, Handle>();
let nextHandle = 1;

app?.on("will-quit", async () => {
    for (const [id] of handles) {
        try { await finalize(null as any, id); } catch { /* best-effort */ }
    }
});

function defaultOutputDir(): string {
    const home = os.homedir();
    // macOS convention is ~/Movies; Windows and Linux use ~/Videos.
    const mediaFolder = process.platform === "darwin" ? "Movies" : "Videos";
    return path.join(home, mediaFolder, "DiscordArchive");
}

// Accepts either (a) a concrete absolute path, (b) "" / undefined for the
// OS default, or (c) a relative-looking base like "foo" which is interpreted
// as `<defaultBase>/foo`. Returns the resolved absolute directory.
function resolveSessionDir(requested: string): string {
    const base = requested && requested.trim() ? requested.trim() : defaultOutputDir();
    // If the caller passed just a subfolder name (no slash), anchor it under
    // the default base so we never end up writing to Discord's cwd.
    if (!base.includes("/") && !base.includes("\\")) {
        return path.join(defaultOutputDir(), base);
    }
    return base;
}

export async function startRecording(_: IpcMainInvokeEvent, dir: string): Promise<number> {
    dir = resolveSessionDir(dir);
    await fsp.mkdir(dir, { recursive: true });
    const videoPath = path.join(dir, "call.webm");
    const jsonlPath = path.join(dir, "chat.jsonl");
    const csvPath = path.join(dir, "chat.csv");

    const currentVideoFd = await fsp.open(videoPath, "w");
    const jsonlFd = await fsp.open(jsonlPath, "w");
    const csvFd = await fsp.open(csvPath, "w");

    // CSV header
    await csvFd.write(
        "abs_ts,rel_ts,author_id,author_name,op,content,attachment_urls\n"
    );

    const id = nextHandle++;
    handles.set(id, {
        dir,
        videoParts: ["call.webm"],
        currentVideoFd,
        currentVideoPath: videoPath,
        jsonlFd,
        csvFd,
        writeQueue: Promise.resolve(),
        finalized: false
    });
    return id;
}

function enqueue<T>(h: Handle, op: () => Promise<T>): Promise<T> {
    const next = h.writeQueue.then(op, op);
    h.writeQueue = next.then(() => undefined, () => undefined);
    return next;
}

export async function appendVideoChunk(
    _: IpcMainInvokeEvent,
    id: number,
    bytes: Uint8Array
): Promise<void> {
    const h = handles.get(id);
    if (!h || h.finalized) throw new Error(`invalid or finalized handle ${id}`);
    await enqueue(h, async () => {
        await h.currentVideoFd.write(bytes);
    });
}

export async function rolloverVideo(
    _: IpcMainInvokeEvent,
    id: number
): Promise<{ partName: string }> {
    const h = handles.get(id);
    if (!h || h.finalized) throw new Error(`invalid or finalized handle ${id}`);
    await enqueue(h, async () => {
        await h.currentVideoFd.close();
    });
    const nextIdx = h.videoParts.length + 1;
    const partName = `call.part${nextIdx}.webm`;
    const partPath = path.join(h.dir, partName);
    h.currentVideoFd = await fsp.open(partPath, "w");
    h.currentVideoPath = partPath;
    h.videoParts.push(partName);
    return { partName };
}

export async function appendChatLine(
    _: IpcMainInvokeEvent,
    id: number,
    kind: "jsonl" | "csv",
    line: string
): Promise<void> {
    const h = handles.get(id);
    if (!h || h.finalized) throw new Error(`invalid or finalized handle ${id}`);
    await enqueue(h, async () => {
        const fd = kind === "jsonl" ? h.jsonlFd : h.csvFd;
        await fd.write(line);
    });
}

export async function writeMetadata(
    _: IpcMainInvokeEvent,
    id: number,
    meta: Record<string, unknown>
): Promise<void> {
    const h = handles.get(id);
    if (!h) throw new Error(`invalid handle ${id}`);
    const metaWithParts = { ...meta, videoParts: h.videoParts };
    await fsp.writeFile(
        path.join(h.dir, "metadata.json"),
        JSON.stringify(metaWithParts, null, 2)
    );
}

export async function finalize(
    _: IpcMainInvokeEvent | null,
    id: number
): Promise<{ path: string }> {
    const h = handles.get(id);
    if (!h) throw new Error(`invalid handle ${id}`);
    if (h.finalized) return { path: h.dir };
    await enqueue(h, async () => {
        await h.currentVideoFd.close();
        await h.jsonlFd.close();
        await h.csvFd.close();
    });
    h.finalized = true;
    handles.delete(id);
    return { path: h.dir };
}

export async function ffmpegRemuxDir(
    _: IpcMainInvokeEvent,
    dir: string,
    opts: { format?: "mkv" | "mp4"; ffmpegPath?: string; keepWebm?: boolean }
): Promise<{ path: string }> {
    const format = opts.format ?? "mkv";
    const input = path.join(dir, "call.webm");
    const output = path.join(dir, `call.${format}`);
    const bin = opts.ffmpegPath || "ffmpeg";

    // mkv: copy both streams — WebM is already Matroska-family so no re-encode needed.
    // mp4: re-encode video to H.264 and audio to AAC for maximum player compatibility.
    //      VP9+Opus in MP4 works in some players but is flaky on Windows / older systems;
    //      H.264+AAC is the universal baseline.
    const args = format === "mkv"
        ? ["-y", "-i", input, "-c", "copy", output]
        : [
            "-y", "-i", input,
            "-c:v", "libx264", "-crf", "23", "-preset", "fast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            output
        ];

    await new Promise<void>((resolve, reject) => {
        const proc = spawn(bin, args, { stdio: "ignore" });
        proc.on("error", reject);
        proc.on("exit", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    });

    if (!opts.keepWebm) {
        await fsp.unlink(input).catch(() => {});
    }
    return { path: output };
}

export async function ensureDirectoryExists(_: IpcMainInvokeEvent, p: string): Promise<void> {
    await fsp.mkdir(p, { recursive: true });
}

export async function revealInFileManager(_: IpcMainInvokeEvent, p: string): Promise<void> {
    shell.showItemInFolder(p);
}

export async function ffmpegAvailable(_: IpcMainInvokeEvent, ffmpegPath: string): Promise<boolean> {
    const bin = ffmpegPath || "ffmpeg";
    return new Promise<boolean>(resolve => {
        const proc = spawn(bin, ["-version"], { stdio: "ignore" });
        proc.on("error", () => resolve(false));
        proc.on("exit", code => resolve(code === 0));
    });
}

// CORS bypass helper. Runs in the main process where no CORS policy applies,
// returns raw bytes plus the server's Content-Type to the renderer. Used for
// URLs whose origin doesn't send Access-Control-Allow-Origin: Discord's
// Tenor MP4 proxy, and Discord's sticker CDN (which despite being on
// cdn.discordapp.com doesn't send CORS for /stickers/ unlike /emojis/).
//
// The renderer either wraps the bytes in a Blob URL (for <video>) or
// hands them directly to the decode worker (for ImageDecoder on APNG).
export async function fetchAsBytes(
    _: IpcMainInvokeEvent,
    url: string
): Promise<{ bytes: Uint8Array; mime: string }> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    return { bytes: new Uint8Array(buf), mime };
}
