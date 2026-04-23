/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { findCssClassesLazy } from "@webpack";
import {
    React,
    useEffect,
    useState,
    useStateFromStores,
} from "@webpack/common";

import { settings } from "../../settings";
import { YoutubeMusicStore } from "../../YtmStore";
import { YoutubeMusicLrcStore } from "../store";
import { EnhancedLyric } from "../types";

export const scrollClasses = findCssClassesLazy("auto", "customTheme");

export const cl = classNameFactory("vc-ytm-lyrics-");

export function NoteSvg(className: string) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 -960 480 720"
            fill="currentColor"
            className={className}
        >
            <path d="m160,-240 q -66,0 -113,-47 -47,-47 -47,-113 0,-66 47,-113 47,-47 113,-47 23,0 42.5,5.5 19.5,5.5 37.5,16.5 v -422 h 240 v 160 H 320 v 400 q 0,66 -47,113 -47,47 -113,47 z" />
        </svg>
    );
}

const calculateIndexes = (
    lyrics: EnhancedLyric[],
    position: number,
    delay: number,
) => {
    const posInSec = position / 1000;
    const adjustedPos = posInSec - delay / 1000;

    let currentIndex = -1;
    for (let i = 0; i < lyrics.length; i++) {
        if (adjustedPos >= lyrics[i].time) {
            currentIndex = i;
        } else {
            break;
        }
    }

    const nextLyric =
        currentIndex < lyrics.length - 1 ? currentIndex + 1 : null;
    return [currentIndex, nextLyric];
};

export function useLyrics({ scroll = true }: { scroll?: boolean; } = {}) {
    const [track, storePosition, isPlaying] = useStateFromStores(
        [YoutubeMusicStore],
        () => [
            YoutubeMusicStore.song,
            YoutubeMusicStore.mPosition,
            YoutubeMusicStore.isPlaying,
        ],
    );
    const lyrics = useStateFromStores(
        [YoutubeMusicLrcStore],
        () => YoutubeMusicLrcStore.lyrics,
    );

    const { LyricDelay } = settings.use(["LyricDelay"]);

    const [currLrcIndex, setCurrLrcIndex] = useState<number | null>(null);
    const [nextLyric, setNextLyric] = useState<number | null>(null);
    const [position, setPosition] = useState(storePosition);
    const [lyricRefs, setLyricRefs] = useState<
        React.RefObject<HTMLDivElement | null>[]
    >([]);

    const currentLyrics = lyrics || null;

    useEffect(() => {
        if (currentLyrics) {
            setLyricRefs(currentLyrics.map(() => React.createRef()));
        }
    }, [currentLyrics]);

    useEffect(() => {
        setPosition(0);
        setCurrLrcIndex(null);
        setNextLyric(null);
    }, [track?.videoId]);

    useEffect(() => {
        if (currentLyrics && position != null) {
            const [currentIndex, nextLyric] = calculateIndexes(
                currentLyrics,
                position,
                LyricDelay,
            );
            setCurrLrcIndex(currentIndex);
            setNextLyric(nextLyric);
        }
    }, [currentLyrics, position, LyricDelay]);

    useEffect(() => {
        if (scroll && currLrcIndex !== null) {
            if (currLrcIndex >= 0) {
                lyricRefs[currLrcIndex].current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });
            }
            if (currLrcIndex < 0 && nextLyric !== null) {
                lyricRefs[nextLyric]?.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });
            }
        }
    }, [currLrcIndex, nextLyric, scroll]);

    useEffect(() => {
        if (isPlaying) {
            setPosition(YoutubeMusicStore.position);
            const interval = setInterval(() => {
                setPosition(p => p + 1000);
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [storePosition, isPlaying]);

    return { track, lyrics, lyricRefs, currLrcIndex, nextLyric };
}
