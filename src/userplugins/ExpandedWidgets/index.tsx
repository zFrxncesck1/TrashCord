/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ExpandedWidgets",
    description: "Enables setting multiple of the same tags for a game in your profile, Author: sadie but they aint in devs so i have to replace w myself to complete gh checks.",
    authors: [
        Devs.x2b
    ],
    tags: ["Chat", "Appearance"],
    enabledByDefault: false,
    patches: [
        {
            find: "BETTER_THAN_YOU]:{",
            replacement: {
                match: /(type:)"radio"/,
                replace: "$1\"checkbox\""
            }
        }
    ]
});