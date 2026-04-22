/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    disableNowPlaying: {
        type: OptionType.BOOLEAN,
        description: "Disables NowPlayingStore - stops game tracking and clears the detected games list, reducing background CPU usage.",
        default: true,
        restartNeeded: true,
    },
    optimizeDispatch: {
        type: OptionType.BOOLEAN,
        description: "Optimizes the READY event dispatcher - skips unnecessary operations on startup and reconnect.",
        default: true,
        restartNeeded: true,
    },
    disableQuests: {
        type: OptionType.BOOLEAN,
        description: "Removes the Quest bar above the user panel - skips rendering entirely, saving CPU and RAM.",
        default: true,
        restartNeeded: true,
    },
});

export default definePlugin({
    name: "perf",
    description: "Collection of small performance improvements",
    authors: [
        { id: 579731384868798464n, name: "void" },
        { id: 456195985404592149n, name: "zFrxncesck1" },
    ],
    tags: ["Developers", "Utility"],
    enabledByDefault: false,
    settings,
    patches: [
        {
            find: "=\"NowPlayingStore\"",
            predicate: () => settings.store.disableNowPlaying,
            replacement: [
                { match: /get games\(\)\{return \w+?\}/, replace: "get games(){return []}" },
                { match: /(\.gameId;return null!=\w\[\w\]&&\().+?,(.+?,)\w={\.\.\.\w\},/, replace: (_, a, b) => a + b },
            ],
        },
        {
            find: "getDispatchHandler needs to be passed in first!",
            predicate: () => settings.store.optimizeDispatch,
            replacement: { match: /(\.flush\(\w,\w\),"READY"===\w\)\{).+?;(.+?\)),.+?\}/, replace: (_, a, b) => a + b + "}" },
        },
        {
            find: "questEnrollmentBlockedUntil",
            predicate: () => settings.store.disableQuests,
            replacement: {
                match: /\d+==\w+\.\w+(?=\?function\(\)\{)/,
                replace: "0==1",
            },
        },
    ],
});
