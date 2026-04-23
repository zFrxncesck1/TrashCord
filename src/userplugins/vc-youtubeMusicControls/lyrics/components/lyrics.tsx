/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { openModal } from "@utils/modal";
import {
  ContextMenuApi,
  Tooltip,
  useEffect,
  useState,
  useStateFromStores,
} from "@webpack/common";

import { settings } from "../../settings";
import { YoutubeMusicStore } from "../../YtmStore";
import { YoutubeMusicLrcStore } from "../store";
import { YoutubeMusicLyricsContextMenu } from "./ctxMenu";
import { YoutubeMusicLyricsModal } from "./modal";
import { cl, NoteSvg, useLyrics } from "./util";

function LyricsDisplay({ scroll = true }: { scroll?: boolean }) {
  const { lyrics, lyricRefs, currLrcIndex } = useLyrics({ scroll });
  const currentLyrics = lyrics || null;
  const NoteElement = NoteSvg(cl("music-note"));

  const makeClassName = (index: number) => {
    if (currLrcIndex === null) return "";
    const diff = index - currLrcIndex;
    return cl(diff === 0 ? "current" : diff > 0 ? "next" : "prev");
  };

  if (!currentLyrics) {
    return (
      <div
        className="vc-ytm-lyrics"
        onContextMenu={(e) =>
          ContextMenuApi.openContextMenu(e, () => (
            <YoutubeMusicLyricsContextMenu />
          ))
        }
      >
        <Tooltip text="No lyrics found">
          {(props) => <div {...props}>{NoteElement}</div>}
        </Tooltip>
      </div>
    );
  }

  const handleLyricClick = (e: React.MouseEvent, time: number) => {
    e.stopPropagation();
    YoutubeMusicStore.seek(time * 1000);
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      openModal((props) => <YoutubeMusicLyricsModal rootProps={props} />);
    }
  };

  return (
    <div
      className="vc-ytm-lyrics"
      onClick={handleContainerClick}
      onContextMenu={(e) =>
        ContextMenuApi.openContextMenu(e, () => (
          <YoutubeMusicLyricsContextMenu />
        ))
      }
    >
      {currentLyrics.map((line, i) => (
        <div
          ref={lyricRefs[i]}
          key={i}
          onClick={(e) => handleLyricClick(e, line.time)}
          style={{ cursor: "pointer" }}
        >
          <BaseText
            size={currLrcIndex === i ? "sm" : "xs"}
            className={makeClassName(i)}
          >
            {line.text || NoteElement}
          </BaseText>
        </div>
      ))}
    </div>
  );
}

export function YoutubeMusicLyrics({
  scroll = true,
}: { scroll?: boolean } = {}) {
  YoutubeMusicLrcStore.init();
  const track = useStateFromStores(
    [YoutubeMusicStore],
    () => YoutubeMusicStore.song,
    null,
    (prev, next) =>
      prev?.videoId
        ? prev.videoId === next?.videoId
        : prev?.title === next?.title,
  );

  const isPlaying = useStateFromStores(
    [YoutubeMusicStore],
    () => YoutubeMusicStore.isPlaying,
  );
  const [shouldHide, setShouldHide] = useState(false);

  useEffect(() => {
    setShouldHide(false);
    if (!isPlaying) {
      const timeout = setTimeout(() => setShouldHide(true), 1000 * 60 * 5);
      return () => clearTimeout(timeout);
    }
  }, [isPlaying]);

  if (!track || shouldHide) return null;

  return <LyricsDisplay scroll={scroll} />;
}