/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

enum Mode {
    INSERT = "insert",
    NORMAL = "normal"
}

let mode: Mode = Mode.INSERT;
let cursorElement: HTMLDivElement | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let styleElement: HTMLStyleElement | null = null;
const inputListener: () => void = updateCursor;
let entryLength: number = 0;
let entryKey: string = "";

function getScroller(): HTMLElement | null {
    const wrapper = document.querySelector('[class*="messagesWrapper_"]');
    if (!wrapper) return null;

    return wrapper.querySelector('[class*="scroller_"]') as HTMLElement;
}

function getEditor(): HTMLElement | null {
    return document.querySelector('[contenteditable="true"][role="textbox"]');
}

function getCharWidth(editor: HTMLElement): number {
    const style = getComputedStyle(editor);
    const span = document.createElement("span");
    span.style.font = style.font;
    span.style.visibility = "hidden";
    span.textContent = "M";
    document.body.appendChild(span);
    const { width } = span.getBoundingClientRect();
    document.body.removeChild(span);
    return width;
}

function updateCursor() {
    if (mode !== Mode.NORMAL || !cursorElement) return;
    const editor = getEditor();
    if (!editor || document.activeElement !== editor) {
        cursorElement.style.display = "none";
        return;
    }
    cursorElement.style.display = "";
    editor.style.caretColor = "transparent";
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    let range = selection.getRangeAt(0);
    if (!range.collapsed) {
        selection.collapseToEnd();
        range = selection.getRangeAt(0);
    }
    const rect = range.getBoundingClientRect();
    let { left } = rect;
    let { top } = rect;
    let { height } = rect;
    let width = 0;
    const charRange = range.cloneRange();
    if (charRange.endContainer.nodeType === Node.TEXT_NODE && charRange.endOffset < (charRange.endContainer.textContent?.length ?? 0)) {
        charRange.setEnd(charRange.endContainer, charRange.endOffset + 1);
        const charRect = charRange.getBoundingClientRect();
        left = charRect.left;
        top = charRect.top;
        height = charRect.height;
        width = charRect.width;
    } else if (charRange.startOffset > 0 && charRange.startContainer.nodeType === Node.TEXT_NODE) {
        charRange.setStart(charRange.startContainer, charRange.startOffset - 1);
        const charRect = charRange.getBoundingClientRect();
        left = charRect.left;
        top = charRect.top;
        height = charRect.height;
        width = charRect.width;
    } else {
        width = getCharWidth(editor);
    }
    if (width === 0) width = getCharWidth(editor);
    cursorElement.style.left = `${left + window.pageXOffset}px`;
    cursorElement.style.top = `${top + window.pageYOffset}px`;
    cursorElement.style.width = `${width}px`;
    cursorElement.style.height = `${height}px`;
}

function getCaretPositionType(): "before" | "after" | "empty" | "unknown" {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "unknown";
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return "unknown";
    const hasNext = range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset < (range.endContainer.textContent?.length ?? 0);
    const hasPrevious = range.startOffset > 0 && range.startContainer.nodeType === Node.TEXT_NODE;
    if (hasNext) return "before";
    if (hasPrevious) return "after";
    return "empty";
}

function moveLeft() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        range.setStart(range.startContainer, range.startOffset - 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function moveRight() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset < (range.startContainer.textContent?.length ?? 0)) {
        range.setStart(range.startContainer, range.startOffset + 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function moveToLineStart() {
    const selection = window.getSelection();
    selection?.modify("move", "backward", "lineboundary");
}

function moveToLineEnd() {
    const selection = window.getSelection();
    selection?.modify("move", "forward", "lineboundary");
}

function moveToFirstNonBlank() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    let range = selection.getRangeAt(0);
    while (true) {
        const charRange = range.cloneRange();
        charRange.setEnd(charRange.endContainer, charRange.endOffset + 1);
        const text = charRange.toString();
        if (!text || /\S/.test(text)) break;
        range = charRange;
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function enterNormalMode() {
    mode = Mode.NORMAL;
    const editor = getEditor();
    if (!editor) return;
    editor.focus();
    editor.style.caretColor = "transparent";
    editor.addEventListener("input", inputListener);
    const currentLength = editor.textContent?.length ?? 0;
    const noInsert = currentLength === entryLength;
    if (entryKey === "a" && noInsert) {
        moveLeft();
    }
    entryKey = "";
    entryLength = 0;
    cursorElement = document.createElement("div");
    cursorElement.className = "vimmotion-cursor";
    document.body.appendChild(cursorElement);
    updateCursor();
}

function enterInsertMode() {
    mode = Mode.INSERT;
    const editor = getEditor();
    if (editor) {
        editor.style.caretColor = "auto";
        editor.removeEventListener("input", inputListener);
        editor.focus();
    }
    if (idleTimer) clearTimeout(idleTimer);
    if (cursorElement) {
        cursorElement.remove();
        cursorElement = null;
    }
}

function handleKeyDown(key_event: KeyboardEvent): void {
    if (mode === Mode.INSERT) {
        if (key_event.key === "Escape") {
            enterNormalMode();
        }
        return;
    }
    key_event.preventDefault();
    key_event.stopPropagation();
    if (mode === Mode.NORMAL) {
        if (idleTimer) clearTimeout(idleTimer);
        if (cursorElement) {
            cursorElement.style.animation = "none";
            cursorElement.style.opacity = "1";
        }
        idleTimer = setTimeout(() => {
            if (cursorElement) {
                cursorElement.style.animation = "";
                cursorElement.style.opacity = "";
            }
        }, 500);
    }
    const scroller = getScroller();
    const editor = getEditor();
    const hasText = !!editor?.textContent?.trim();
    const selection = window.getSelection();
    switch (key_event.key) {
        case "h":
            selection?.modify("move", "backward", "character");
            break;
        case "l":
            selection?.modify("move", "forward", "character");
            break;
        case "j":
            if (!hasText) {
                scroller?.scrollBy({ top: 50, behavior: "instant" });
            } else {
                selection?.modify("move", "forward", "line");
            }
            break;
        case "k":
            if (!hasText) {
                scroller?.scrollBy({ top: -50, behavior: "instant" });
            } else {
                selection?.modify("move", "backward", "line");
            }
            break;
        case "I":
            moveToLineStart();
            moveToFirstNonBlank();
            const typeBigI = getCaretPositionType();
            if (typeBigI === "after") {
                moveLeft();
            }
            entryKey = "i";
            entryLength = editor?.textContent?.length ?? 0;
            enterInsertMode();
            break;
        case "A":
            moveToLineEnd();
            entryKey = "a";
            entryLength = editor?.textContent?.length ?? 0;
            enterInsertMode();
            break;
        case "w":
            selection?.modify("move", "forward", "word");
            break;
        case "b":
            selection?.modify("move", "backward", "word");
            break;
        case "i":
            const typeI = getCaretPositionType();
            if (typeI === "after") {
                moveLeft();
            }
            entryKey = "i";
            entryLength = editor?.textContent?.length ?? 0;
            enterInsertMode();
            break;
        case "a":
            const typeA = getCaretPositionType();
            if (typeA === "before") {
                moveRight();
            }
            entryKey = "a";
            entryLength = editor?.textContent?.length ?? 0;
            enterInsertMode();
            break;
    }
    if (["h", "j", "k", "l", "w", "b"].includes(key_event.key)) {
        const type = getCaretPositionType();
        if (type === "after") {
            moveLeft();
        }
    }
    updateCursor();
}


export default definePlugin({
    name: "vimMotion",
    description: "A plugin that allow you to use vim keymap to navigate in Discord",
    authors: [{ name: "yewspine", id: 1061439057722359808n }],
    start() {
        styleElement = document.createElement("style");
        styleElement.textContent = `
@keyframes vimmotion-blink {
    50% { opacity: 0; }
}
.vimmotion-cursor {
    position: absolute;
    pointer-events: none;
    background-color: var(--interactive-active);
    opacity: 0.7;
    animation: vimmotion-blink 1s step-end infinite;
    z-index: 1000;
}
        `;
        document.head.appendChild(styleElement);
        window.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("selectionchange", updateCursor);
        window.addEventListener("resize", updateCursor);
        document.addEventListener("scroll", updateCursor, true);
    },
    stop() {
        window.removeEventListener("keydown", handleKeyDown, true);
        document.removeEventListener("selectionchange", updateCursor);
        window.removeEventListener("resize", updateCursor);
        document.removeEventListener("scroll", updateCursor, true);
        enterInsertMode();
        styleElement?.remove();
    }
});
