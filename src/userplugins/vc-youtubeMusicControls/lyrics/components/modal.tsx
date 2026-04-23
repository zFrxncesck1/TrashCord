/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { ModalContent, ModalHeader, ModalProps, ModalRoot } from "@utils/modal";

import { settings } from "../../settings";
import { Song, YoutubeMusicStore } from "../../YtmStore";
import { cl, NoteSvg, scrollClasses, useLyrics } from "./util";

const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

function ModalHeaderContent({ track }: { track: Song; }) {
    return (
        <ModalHeader>
            <div className={cl("header-content")}>
                {track?.imageSrc && (
                    <img
                        src={track.imageSrc}
                        alt={track.album || track.title}
                        className={cl("album-image")}
                    />
                )}
                <div>
                    <BaseText size="sm" weight="semibold">{track.title}</BaseText>
                    <BaseText size="sm">by {track.artist}</BaseText>
                    {track.album && <BaseText size="sm">on {track.album}</BaseText>}
                </div>
            </div>
        </ModalHeader>
    );
}

export function YoutubeMusicLyricsModal({ rootProps }: { rootProps: ModalProps; }) {
    const { track, lyrics, currLrcIndex } = useLyrics({ scroll: false });
    const currentLyrics = lyrics || null;
    const delay = settings.store.LyricDelay / 1000;

    return (
        <ModalRoot {...rootProps}>
            {track && <ModalHeaderContent track={track} />}
            <ModalContent>
                <div className={cl("lyrics-modal-container") + ` ${scrollClasses.auto}`}>
                    {currentLyrics ? (
                        currentLyrics.map((line, i) => (
                            <BaseText
                                key={i}
                                size={currLrcIndex === i ? "md" : "sm"}
                                weight={currLrcIndex === i ? "semibold" : "normal"}
                                className={currLrcIndex === i ? cl("modal-line-current") : cl("modal-line")}
                            >
                                <span className={cl("modal-timestamp")}
                                    onClick={() => YoutubeMusicStore.seek((line.time + delay) * 1000)}
                                >
                                    {formatTime(line.time + delay)}
                                </span>
                                {line.text || NoteSvg(cl("modal-note"))}
                            </BaseText>
                        ))
                    ) : (
                        <BaseText size="sm" className={cl("modal-no-lyrics")}>No lyrics available :(</BaseText>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}
