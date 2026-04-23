/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";

import { settings } from "../settings";
import { YoutubeMusicStore } from "../YtmStore";
import { getLyrics } from "./api";
import { EnhancedLyric } from "./types";

function showNotif(title: string, body: string) {
    if (settings.store.ShowFailedToasts) {
        showNotification({
            color: "#ee2902",
            title,
            body,
            noPersist: true
        });
    }
}

export const YoutubeMusicLrcStore = proxyLazyWebpack(() => {
    let lyrics: EnhancedLyric[] | null = null;
    let lastTrackId: string | null = null;

    class YoutubeMusicLrcStore extends Flux.Store {
        init() { }
        get lyrics() {
            return lyrics;
        }
        refreshLyrics() {
            const { song } = YoutubeMusicStore;
            if (!song?.videoId) {
                console.log("[YTM Lyrics] Cannot refresh lyrics: No song loaded");
                return;
            }

            console.log(`[YTM Lyrics] Refreshing lyrics for: ${song.title} - ${song.artist}`);

            getLyrics(song)
                .then(l => {
                    lyrics = l;
                    if (l) {
                        console.log(`[YTM Lyrics] Successfully refreshed lyrics (${l.length} lines)`);
                    } else {
                        console.log("[YTM Lyrics] No lyrics found");
                        showNotif("YouTube Music Lyrics", "No lyrics found for this song");
                    }
                    store.emitChange();
                })
                .catch(err => {
                    lyrics = null;
                    console.error("[YTM Lyrics] Failed to refresh lyrics:", err);
                    showNotif("YouTube Music Lyrics", "Failed to fetch lyrics");
                    store.emitChange();
                });
        }
    }

    const store = new YoutubeMusicLrcStore(FluxDispatcher);
    function handleYoutubeMusicStoreChange() {
        const { song } = YoutubeMusicStore;
        if (!song?.videoId || lastTrackId === song.videoId) return;
        lastTrackId = song.videoId;

        getLyrics(song)
            .then(l => { lyrics = l; store.emitChange(); })
            .catch(() => {
                lyrics = null;
                showNotif("YouTube Music Lyrics", "Failed to fetch lyrics");
                store.emitChange();
            });
    }

    YoutubeMusicStore.addChangeListener(handleYoutubeMusicStoreChange);

    return store;
});
