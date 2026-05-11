/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    padHours: {
        type: OptionType.BOOLEAN,
        description: "Pad hours with a leading zero (e.g., 09:00 vs 9:00)",
                                             default: false
    },
    use24h: {
        type: OptionType.BOOLEAN,
        description: "Use 24-hour time format instead of 12-hour AM/PM",
                                             default: false
    },
    dateFormat: {
        type: OptionType.SELECT,
        description: "Date format to use for older messages",
        options: [
            // Day/Month/Year (Slash)
            { label: "dd/MM/yyyy (e.g., 31/08/2026)", value: "dd/MM/yyyy" },
            { label: "dd/MM/yy (e.g., 31/08/26)", value: "dd/MM/yy" },
            { label: "d/M/yyyy (e.g., 3/8/2026)", value: "d/M/yyyy" },
            { label: "d/M/yy (e.g., 3/8/26)", value: "d/M/yy" },

            // Day/Month/Year (Dot without spaces)
            { label: "dd.MM.yyyy (e.g., 31.08.2026)", value: "dd.MM.yyyy" },
            { label: "dd.MM.yy (e.g., 31.08.26)", value: "dd.MM.yy" },
            { label: "d.M.yyyy (e.g., 3.8.2026)", value: "d.M.yyyy" },
            { label: "d.M.yy (e.g., 3.8.26)", value: "d.M.yy" },

            // Day/Month/Year (Dot with spaces)
            { label: "dd. MM. yyyy (e.g., 31. 08. 2026)", value: "dd. MM. yyyy" },
            { label: "dd. MM. yy (e.g., 31. 08. 26)", value: "dd. MM. yy" },
            { label: "d. M. yyyy (e.g., 3. 8. 2026)", value: "d. M. yyyy" },
            { label: "d. M. yy (e.g., 3. 8. 26)", value: "d. M. yy" },

            // Month/Day/Year (Slash)
            { label: "MM/dd/yyyy (e.g., 08/31/2026)", value: "MM/dd/yyyy" },
            { label: "MM/dd/yy (e.g., 08/31/26)", value: "MM/dd/yy" },
            { label: "M/d/yyyy (e.g., 8/3/2026)", value: "M/d/yyyy" },
            { label: "M/d/yy (e.g., 8/3/26)", value: "M/d/yy" },

            // Month/Day/Year (Dot)
            { label: "MM.dd.yyyy (e.g., 08.31.2026)", value: "MM.dd.yyyy" },
            { label: "MM.dd.yy (e.g., 08.31.26)", value: "MM.dd.yy" },
            { label: "M.d.yyyy (e.g., 8.3.2026)", value: "M.d.yyyy" },
            { label: "M.d.yy (e.g., 8.3.26)", value: "M.d.yy" },

            // Year/Month/Day
            { label: "yyyy-MM-dd (ISO 8601, e.g., 2026-08-31)", value: "yyyy-MM-dd" },
            { label: "yyyy/MM/dd (e.g., 2026/08/31)", value: "yyyy/MM/dd" },
            { label: "yyyy.MM.dd (e.g., 2026.08.31)", value: "yyyy.MM.dd" },
            { label: "yyyy. MM. dd (e.g., 2026. 08. 31)", value: "yyyy. MM. dd" }
        ],
            default: "dd/MM/yyyy"
    },
    showCurrentYear: {
        type: OptionType.BOOLEAN,
        description: "Always show the year (even if it's the current year)",
        default: false
    }
});

function formatTime(date: Date): string {
    const hours24 = date.getHours();

    const use24h = settings.store.use24h;
    const padHours = settings.store.padHours;

    let hStr: string;
    let ampm = "";

    if (use24h) {
        hStr = padHours ? hours24.toString().padStart(2, "0") : hours24.toString();
    } else {
        ampm = hours24 >= 12 ? " PM" : " AM";
        const hours12 = hours24 % 12 || 12;
        hStr = padHours ? hours12.toString().padStart(2, "0") : hours12.toString();
    }

    const m = date.getMinutes().toString().padStart(2, "0");
    const s = date.getSeconds().toString().padStart(2, "0");

    return `${hStr}:${m}:${s}${ampm}`;
}

function formatDateStr(date: Date): string {
    const format = settings.store.dateFormat;
    const showCurrentYear = settings.store.showCurrentYear;

    let fmt = format;

    // Check if it's the current year and the user chose to hide it
    if (date.getFullYear() === new Date().getFullYear() && !showCurrentYear) {
        // Strip year from the end (e.g., dd/MM/yyyy -> dd/MM)
        fmt = fmt.replace(/[\/\.\s\-]+(?:yyyy|yy)$/, "");
        // Strip year from the start (e.g., yyyy-MM-dd -> MM-dd)
        fmt = fmt.replace(/^(?:yyyy|yy)[\/\.\s\-]+/, "");
    }

    const d = date.getDate();
    const m = date.getMonth() + 1;

    // Map format tokens to actual date values
    const map: Record<string, string> = {
        "dd": d.toString().padStart(2, "0"),
        "d": d.toString(),
        "MM": m.toString().padStart(2, "0"),
        "M": m.toString(),
        "yyyy": date.getFullYear().toString(),
        "yy": date.getFullYear().toString().slice(-2)
    };

    // Replace the tokens. Sorting by length ensures "yyyy" matches before "yy", and "dd" before "d"
    return fmt.replace(/yyyy|yy|MM|M|dd|d/g, (match) => map[match]);
}

function getFullTimestamp(date: Date): string {
    const timeStr = formatTime(date);

    const now = new Date();
    // Normalize times to midnight to easily compare purely by calendar day
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (targetDate.getTime() === today.getTime()) {
        return timeStr; // For 'today', we just show the time as requested
    }

    if (targetDate.getTime() === yesterday.getTime()) {
        return `Yesterday at ${timeStr}`;
    }

    return `${formatDateStr(date)}, ${timeStr}`;
}

function updateTimestamp(timeEl: HTMLTimeElement) {
    const dt = timeEl.getAttribute("datetime");
    if (!dt) return;
    const date = new Date(dt);
    if (isNaN(date.getTime())) return;

    for (const node of Array.from(timeEl.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            node.textContent = getFullTimestamp(date);
            return;
        }
    }

    timeEl.appendChild(document.createTextNode(getFullTimestamp(date)));
}

function updateAll() {
    document.querySelectorAll<HTMLTimeElement>("time[datetime]").forEach(updateTimestamp);
}

let observer: MutationObserver | null = null;

export default definePlugin({
    name: "blueTimestamps",
    description: "Shows seconds in message timestamps",
    authors: [{ id: 585517584137453611n, name: "blue" }],
    tags: ["Chat", "Appearance"],
    enabledByDefault: false,

    settings,

    start() {
        updateAll();

        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof Element) {
                        node.querySelectorAll<HTMLTimeElement>("time[datetime]").forEach(updateTimestamp);
                        if (node instanceof HTMLTimeElement && node.hasAttribute("datetime")) {
                            updateTimestamp(node);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
    },
});
