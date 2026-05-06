/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

import type { SurveillanceEvent } from "./types";

const STORE_KEY = "Illegalcord_Surveillance_events";
const MIN_EVENTS = 50;
const SAVE_DELAY = 750;
const logger = new Logger("Surveillance");
const listeners = new Set<() => void>();

let events: SurveillanceEvent[] = [];
let loaded = false;
let loading: Promise<SurveillanceEvent[]> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const notify = () => {
    for (const listener of listeners) {
        listener();
    }
};

export const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getEvents = () => events;

const persistEvents = () =>
    DataStore.set(STORE_KEY, events).catch(error => logger.error("Failed to save surveillance events:", error));

const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void persistEvents();
    }, SAVE_DELAY);
};

const persistNow = async () => {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = undefined;
    }

    await persistEvents();
};

export async function loadEvents() {
    if (loaded) return events;
    if (loading) return loading;

    loading = DataStore.get<SurveillanceEvent[]>(STORE_KEY)
        .then(savedEvents => {
            events = Array.isArray(savedEvents) ? savedEvents : [];
            loaded = true;
            notify();
            return events;
        })
        .catch(error => {
            logger.error("Failed to load surveillance events:", error);
            events = [];
            loaded = true;
            notify();
            return events;
        });

    return loading;
}

export async function recordEvent(event: SurveillanceEvent, limit: number) {
    await loadEvents();

    events = [event, ...events].slice(0, Math.max(MIN_EVENTS, limit));
    notify();
    scheduleSave();
}

export async function clearEvents() {
    events = [];
    loaded = true;
    await persistNow();
    notify();
}

export async function trimEvents(limit: number) {
    await loadEvents();
    events = events.slice(0, Math.max(MIN_EVENTS, limit));
    await persistNow();
    notify();
}
