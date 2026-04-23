/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Settings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";

enum MediaType {
    /**
     * Audio uploaded by the original artist
     */
    Audio = "AUDIO",
    /**
     * Official music video uploaded by the original artist
     */
    OriginalMusicVideo = "ORIGINAL_MUSIC_VIDEO",
    /**
     * Normal YouTube video uploaded by a user
     */
    UserGeneratedContent = "USER_GENERATED_CONTENT",
    /**
     * Podcast episode
     */
    PodcastEpisode = "PODCAST_EPISODE",
    OtherVideo = "OTHER_VIDEO",
}

export type RepeatMode = "NONE" | "ONE" | "ALL";

export interface Song {
    title: string;
    artist: string;
    views: number;
    uploadDate?: string;
    imageSrc?: string | null;
    isPaused?: boolean;
    songDuration: number;
    elapsedSeconds?: number;
    url?: string;
    album?: string | null;
    videoId: string;
    playlistId?: string;
    mediaType: MediaType;
}

enum DataTypes {
    PlayerInfo = "PLAYER_INFO",
    VideoChanged = "VIDEO_CHANGED",
    PlayerStateChanged = "PLAYER_STATE_CHANGED",
    PositionChanged = "POSITION_CHANGED",
    VolumeChanged = "VOLUME_CHANGED",
    RepeatChanged = "REPEAT_CHANGED",
    ShuffleChanged = "SHUFFLE_CHANGED",
}

type PlayerInfo = {
    type: DataTypes.PlayerInfo;
    song: Song | undefined;
    volume: number;
    muted: boolean;
    repeat: RepeatMode;
    position: number;
    isPlaying: boolean;
    shuffle: boolean;
};

type VideoChanged = {
    type: DataTypes.VideoChanged;
    song: Song;
    position: number;
};

type PlayerStateChanged = {
    type: DataTypes.PlayerStateChanged;
    isPlaying: boolean;
    position: number;
};

type PositionChanged = {
    type: DataTypes.PositionChanged;
    position: number;
};

type VolumeChanged = {
    type: DataTypes.VolumeChanged;
    volume: number;
    muted: boolean;
};

type RepeatChanged = {
    type: DataTypes.RepeatChanged;
    repeat: RepeatMode;
};

type ShuffleChanged = {
    type: DataTypes.ShuffleChanged;
    shuffle: boolean;
};

export type Repeat = "NONE" | "ONE" | "ALL";

export const logger = new Logger("MusicControls-Ytm");

const YTM_VOLUME_KEY = "YoutubeMusicVolume";

type Message =
    | PlayerInfo
    | VideoChanged
    | PlayerStateChanged
    | PositionChanged
    | VolumeChanged
    | RepeatChanged
    | ShuffleChanged;

type PlayerState = Partial<Omit<PlayerInfo, "type">>;

class YoutubeMusicSocket {
    public onChange: (e: PlayerState) => void;
    private ready = false;
    private connecting = false;

    private socket: WebSocket | undefined;

    constructor(onChange: typeof this.onChange) {
        this.reconnect();
        this.onChange = onChange;
    }

    public scheduleReconnect(ms: number) {
        setTimeout(() => this.reconnect(), ms);
    }

    public reconnect() {
        if (this.ready || this.connecting) return;
        this.connecting = true;
        this.initWs();
    }

    private async initWs() {
        const url = Settings.plugins.MusicControls.YoutubeMusicApiUrl;
        if (!url) {
            this.connecting = false;
            return;
        }

        try {
            this.socket = new WebSocket(new URL("/api/v1/ws", url));
        } catch (e) {
            logger.error("Connection failed");
            return;
        }

        this.socket.addEventListener("open", () => {
            this.ready = true;
            this.connecting = false;

            this.applySavedVolume();
        });

        this.socket.addEventListener("error", e => {
            this.ready = false;
            this.connecting = false;
            if (!this.ready) this.scheduleReconnect(5_000);
            this.onChange({ position: 0, isPlaying: false, song: undefined });
        });

        this.socket.addEventListener("close", e => {
            this.ready = false;
            this.connecting = false;
            if (!this.ready) this.scheduleReconnect(10_000);
            this.onChange({ position: 0, isPlaying: false, song: undefined });
        });

        this.socket.addEventListener("message", e => {
            let message: Message;
            try {
                message = JSON.parse(e.data) as Message;
                this.onChange(message);
            } catch (err) {
                logger.error("Invalid JSON:", err, `\n${e.data}`);
                return;
            }
        });
    }

    private async applySavedVolume() {
        try {
            const savedVolume = await DataStore.get(YTM_VOLUME_KEY);
            if (savedVolume != null && typeof savedVolume === "number") {
                await new Promise(resolve => setTimeout(resolve, 100));

                const apiServerUrl =
                    Settings.plugins.MusicControls.YoutubeMusicApiUrl;
                if (apiServerUrl) {
                    await fetch(apiServerUrl + "/api/v1/volume", {
                        method: "POST",
                        body: JSON.stringify({
                            volume: Math.floor(savedVolume),
                        }),
                        headers: { "Content-Type": "application/json" },
                    });
                    logger.info("Applied saved volume:", savedVolume);
                }
            }
        } catch (err) {
            logger.error("Failed to apply saved volume:", err);
        }
    }
}

export const YoutubeMusicStore = proxyLazyWebpack(() => {
    const { Store } = Flux;

    class YoutubeMusicStore extends Store {
        public mPosition = 0;
        public start = 0;

        public song: Song | null = null;
        public isPlaying = false;
        public isShuffled = false;
        public repeat: Repeat = "NONE";
        public volume = 0;
        public muted = false;

        public isSettingPosition = false;
        public isSettingVolume = false;
        private justChangedSong = false;
        private volumeInitialized = false;

        constructor(dispatcher: any) {
            super(dispatcher);
            this.loadSavedVolume();
        }

        private async loadSavedVolume() {
            try {
                const savedVolume = await DataStore.get(YTM_VOLUME_KEY);
                if (savedVolume != null && typeof savedVolume === "number") {
                    this.volume = savedVolume;
                    this.volumeInitialized = true;
                    this.emitChange();
                }
            } catch (err) {
                logger.error("Failed to load saved volume:", err);
            }
        }

        public socket = new YoutubeMusicSocket((message: PlayerState) => {
            const now = Date.now();

            if (message.song) {
                const isNewSong = store.song?.videoId !== message.song.videoId;
                store.song = message.song;
                store.isPlaying = !(message.song?.isPaused ?? false);
                if (isNewSong && message.position != null) {
                    store.mPosition = message.position * 1000;
                    store.start = now;
                } else if (isNewSong) {
                    store.mPosition = 0;
                    store.start = now;
                    store.justChangedSong = true;
                }
            }

            if (message.isPlaying != null && !message.song)
                store.isPlaying = message.isPlaying;
            if (message.shuffle != null) store.isShuffled = message.shuffle;

            if (message.position != null && !message.song) {
                const newPos = message.position * 1000;
                if (
                    store.isSettingPosition ||
                    store.justChangedSong ||
                    Math.abs(newPos - store.mPosition) > 1000
                ) {
                    store.mPosition = newPos;
                    store.start = now;
                    store.justChangedSong = false;
                }
            }

            if (
                message.volume != null &&
                !store.isSettingVolume &&
                !store.volumeInitialized
            ) {
                store.volume = message.volume;
            }
            if (message.repeat) store.repeat = message.repeat;
            if (message.muted != null) store.muted = message.muted;

            store.isSettingPosition = false;
            store.isSettingVolume = false;
            store.emitChange();
        });

        public openExternal(path: string) {
            const videoId = path.match(/watch\?v=([\w-]+)/);

            const url =
                Vencord.Plugins.isPluginEnabled("OpenInApp") && videoId
                    ? encodeURI("youtubemusic://openVideo " + videoId[1])
                    : "https://music.youtube.com" + path;

            logger.info("Open", url);

            // https://music.youtube.com/watch?v=BSHYPb15W-Y
            VencordNative.native.openExternal(url);
        }

        set position(p: number) {
            this.mPosition = p * 1000;
            this.start = Date.now();
        }

        get position(): number {
            let pos = this.mPosition;
            if (this.isPlaying) {
                pos += Date.now() - this.start;
            }
            return pos;
        }

        prev() {
            this.req("post", "/api/v1/previous");
        }
        next() {
            this.req("post", "/api/v1/next");
        }
        setVolume(percent: number) {
            const volume = Math.floor(percent);
            DataStore.set(YTM_VOLUME_KEY, volume).catch(err =>
                logger.error("Failed to save volume:", err),
            );
            this.isSettingVolume = true;
            this.volume = volume;
            this.emitChange();
            this.req("post", "/api/v1/volume", {
                body: { volume },
            });
        }
        setPlaying(playing: boolean) {
            if (playing) {
                this.req("post", "/api/v1/play");
            } else {
                this.req("post", "/api/v1/pause");
            }
        }
        switchRepeat() {
            this.req("post", "/api/v1/switch-repeat", {
                body: {
                    iteration: 1,
                },
            });
        }
        shuffle() {
            this.req("post", "/api/v1/shuffle");
        }
        seek(ms: number) {
            this.isSettingPosition = true;
            this.mPosition = ms;
            this.start = Date.now();
            this.req("post", "/api/v1/seek-to", {
                body: {
                    seconds: Math.round(ms / 1000),
                },
            });
            this.emitChange();
        }
        toggleMute() {
            this.req("post", "/api/v1/toggle-mute");
        }

        public req(
            method: "post" | "get" | "put",
            route: string,
            data: any = {},
        ) {
            const apiServerUrl =
                Settings.plugins.MusicControls.YoutubeMusicApiUrl;
            if (apiServerUrl === "") return;
            const url = apiServerUrl + route;

            fetch(url, {
                method,
                ...data,
                ...(data.body && {
                    body: JSON.stringify(data.body),
                    headers: { "Content-Type": "application/json" },
                }),
            });
        }
    }

    const store = new YoutubeMusicStore(FluxDispatcher);

    return store;
});
