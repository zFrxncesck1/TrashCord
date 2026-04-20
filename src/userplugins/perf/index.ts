/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "perf",
    description: "Collection of small performance improvements",
    tags: ["Developers", "Utility"],
    enabledByDefault: false,
    authors: [
        {
            id: 579731384868798464n,
            name: "void",
        },
    ],
    patches: [{
        find: "=\"NowPlayingStore\"",
        replacement: [{
            match: /get games\(\)\{return \w+?\}/,
            replace: "get games(){return []}",
        }, {
            match: /(\.gameId;return null!=\w\[\w\]&&\().+?,(.+?,)\w={\.\.\.\w\},/,
            replace: (_, prev1, prev2) => prev1 + prev2,
        }]
    }, {
        find: "\"SpriteCanvas-module_spriteCanvasHidden",
        replacement: {
            match: /,\w\.createElement\("canvas",{.+?\)}\)/,
            replace: "",
        }
    }, {
        find: "getDispatchHandler needs to be passed in first!",
        replacement: {
            match: /(\.flush\(\w,\w\),"READY"===\w\)\{).+?;(.+?\)),.+?\}/,
            replace: (_, pre, mid) => pre + mid + "}",
        }
    }]
});