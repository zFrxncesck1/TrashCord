/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { makeRange, OptionType } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import hoverOnlyStyle from "./hoverOnly.css?managed";

const sliderOptions = {
  markers: makeRange(-2500, 2500, 250),
  stickToMarkers: true,
};

export function toggleHoverControls(value: boolean) {
  (value ? enableStyle : disableStyle)(hoverOnlyStyle);
}

export const settings = definePluginSettings({
  hoverControls: {
    description: "Show controls on hover",
    type: OptionType.BOOLEAN,
    default: false,
    onChange: (v) => toggleHoverControls(v),
  },
  LyricsPosition: {
    description: "Position of the lyrics",
    type: OptionType.SELECT,
    options: [
      { value: "above", label: "Above Player" },
      { value: "below", label: "Below Player", default: true },
    ],
  },
  LyricDelay: {
    description: "",
    type: OptionType.SLIDER,
    default: 0,
    ...sliderOptions,
  },
  ShowFailedToasts: {
    description: "Show toasts when lyrics fail to fetch",
    type: OptionType.BOOLEAN,
    default: true,
  },
  showYoutubeMusicLyrics: {
    description: "Show YouTube Music Lyrics",
    type: OptionType.BOOLEAN,
    default: false,
  },
  YoutubeMusicApiUrl: {
    description: "Custom URL for the Api Server plugin",
    type: OptionType.STRING,
    default: "http://localhost:26538",
    placeholder: "http://localhost:26538",
    onChange: (value: string) => {
      if (URL.canParse(value)) {
        settings.store.YoutubeMusicApiUrl = value;
      } else {
        showToast(
          "Invalid URL format for Custom Api Server URL: " + value,
          Toasts.Type.FAILURE,
        );
        settings.store.YoutubeMusicApiUrl =
          settings.def.YoutubeMusicApiUrl.default;
      }
    },
  },
});
