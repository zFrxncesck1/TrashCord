/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BackupRestoreIcon, CopyIcon, OpenExternalIcon } from "@components/Icons";
import { copyWithToast } from "@utils/discord";
import { openModal } from "@utils/modal";
import { FluxDispatcher, Menu } from "@webpack/common";

import { settings } from "../../settings";
import { YoutubeMusicLrcStore } from "../store";
import { YoutubeMusicLyricsModal } from "./modal";
import { useLyrics } from "./util";

export function YoutubeMusicLyricsContextMenu() {
    const { lyrics, currLrcIndex } = useLyrics({ scroll: false });
    const currLyric = lyrics?.[currLrcIndex ?? NaN];

    return (
        <Menu.Menu
            navId="ytm-lyrics-menu"
            onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })}
            aria-label="YouTube Music Lyrics Menu"
        >
            <Menu.MenuItem
                key="copy-lyric"
                id="copy-lyric"
                label="Copy current lyric"
                disabled={!currLyric?.text}
                action={() => copyWithToast(currLyric!.text!, "Lyric copied!")}
                icon={CopyIcon}
            />
            <Menu.MenuItem
                key="refresh-lyrics"
                id="refresh-lyrics"
                label="Refresh lyrics"
                action={() => YoutubeMusicLrcStore.refreshLyrics()}
                icon={BackupRestoreIcon}
            />
            <Menu.MenuItem
                key="open-lyrics-modal"
                id="open-lyrics-modal"
                label="Open lyrics modal"
                action={() => openModal(props => <YoutubeMusicLyricsModal rootProps={props} />)}
                icon={OpenExternalIcon}
            />
            <Menu.MenuSeparator />
            <Menu.MenuControlItem
                id="lyric-delay"
                label={`Lyric Delay: ${settings.store.LyricDelay}ms`}
                control={(props, ref) => (
                    <Menu.MenuSliderControl
                        {...props}
                        ref={ref}
                        minValue={-2500}
                        maxValue={2500}
                        value={settings.store.LyricDelay}
                        onChange={(value: number) => {
                            settings.store.LyricDelay = Math.round(value / 250) * 250;
                        }}
                        renderValue={(value: number) => `${Math.round(value / 250) * 250}ms`}
                    />
                )}
            />
        </Menu.Menu>
    );
}
