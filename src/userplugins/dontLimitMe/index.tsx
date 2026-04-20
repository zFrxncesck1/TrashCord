/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "DontLimitMe",
    description: "removes the limit on message sending. spam away!",
    authors: [{ name: "Death", id: 1003477997728313405n }],
    tags: ["Utility", "Chat"],
 enabledByDefault: false,
    patches: [
        {
            find: "cancelQueueMetricTimers",
            replacement: {
                match: /this\.maxSize=\w+/,
                replace: "this.maxSize=Number.MAX_SAFE_INTEGER"
            }
        }
    ]
});
