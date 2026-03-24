/*
 * Plexcord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 * Copyright (c) 2025 MutanPlex
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Fixxed by zFry
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoMirroredCamera",
    description: "Prevents the camera from being mirrored on your screen",
    authors: [Devs.nyx, "MutanPlex"],
    patches: [
        {
            find: '"mirror":',
            replacement: {
                match: /"mirror":(\w+)/,
                replace: '"mirror":false'
            }
        },
        {
            find: "mirror:!0",
            replacement: {
                match: /mirror:(\w+)/,
                replace: "mirror:false"
            }
        },
        {
            find: '"cameraPreview"',
            replacement: {
                match: /className:\w+\.cameraPreview,/,
                replace: 'className:$self.cameraPreview,style:{transform:"scaleX(1)"},'
            }
        }
    ]
});
