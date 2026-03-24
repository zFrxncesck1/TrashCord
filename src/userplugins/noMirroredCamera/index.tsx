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
        // Voice channel / group call - updated pattern for recent Discord
        {
            find: '"mirror":',
            replacement: {
                match: /"mirror":(\w+)/,
                replace: '"mirror":false'
            }
        },
        // Popout camera
        {
            find: "mirror:!0",
            replacement: {
                match: /mirror:(\w+)/,
                replace: "mirror:false"
            }
        },
        // Preview Camera/Change Video Background popup - more reliable CSS override
        {
            find: '"cameraPreview"',
            replacement: {
                match: /className:\w+\.cameraPreview,/,
                replace: 'className:$self.cameraPreview,style:{transform:"scaleX(1)"},'
            }
        },
        // Additional patch for video elements in preview (fallback)
        {
            find: 'type:"video"',
            replacement: {
                match: /style:{[^}]*transform:\w+/,
                replace: 'style:{...$self,transform:"scaleX(1)"}'
            }
        }
    ]
});