import type { ChatMessage } from "../types";
import { toCsvCell } from "../utils";

export interface ChatIO {
    appendChatLine(handle: number, kind: "jsonl" | "csv", line: string): Promise<void>;
}

export function messageToJsonLine(msg: ChatMessage): string {
    return JSON.stringify(msg) + "\n";
}

export function messageToCsvLine(msg: ChatMessage): string {
    const cells = [
        new Date(msg.timestampMs).toISOString(),
        String(msg.relativeMs),
        msg.authorId,
        toCsvCell(msg.authorName),
        msg.op,
        toCsvCell(msg.content),
        toCsvCell(msg.attachments.map(a => a.url).join("|"))
    ];
    return cells.join(",") + "\n";
}

export class ChatLogger {
    constructor(
        private readonly io: ChatIO,
        private readonly handle: number
    ) {}

    async pushMessage(msg: ChatMessage): Promise<void> {
        const withOp: ChatMessage = { ...msg, op: "create" };
        await Promise.all([
            this.io.appendChatLine(this.handle, "jsonl", messageToJsonLine(withOp)),
            this.io.appendChatLine(this.handle, "csv", messageToCsvLine(withOp))
        ]);
    }

    async editMessage(msg: ChatMessage): Promise<void> {
        const withOp: ChatMessage = { ...msg, op: "edit" };
        await Promise.all([
            this.io.appendChatLine(this.handle, "jsonl", messageToJsonLine(withOp)),
            this.io.appendChatLine(this.handle, "csv", messageToCsvLine(withOp))
        ]);
    }

    async deleteMessage(msg: ChatMessage): Promise<void> {
        const withOp: ChatMessage = { ...msg, op: "delete" };
        await Promise.all([
            this.io.appendChatLine(this.handle, "jsonl", messageToJsonLine(withOp)),
            this.io.appendChatLine(this.handle, "csv", messageToCsvLine(withOp))
        ]);
    }
}
