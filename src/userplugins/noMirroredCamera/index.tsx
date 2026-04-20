/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Fixxed by zFrxncesck1
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "NoMirroredCamera",
    description: "Prevents the camera from being mirrored on your screen",
    authors: [Devs.nyx],
    tags: ["Voice", "Utility"],
    enabledByDefault: false,

    start() {
        const style = document.createElement("style");
        style.id = "no-mirrored-camera-fix";
        style.textContent = `[class*="cameraPreview"] [class*="camera"] { transform: scaleX(1) !important; }`;
        document.head.appendChild(style);
    },

    stop() {
        document.getElementById("no-mirrored-camera-fix")?.remove();
    },

    patches: [
        // When focused on voice channel or group chat voice call
        {
            find: /\i\?#{intl::SELF_VIDEO}/,
            replacement: {
                match: /mirror:\i/,
                replace: "mirror:!1"
            }
        },
        // Popout camera when not focused on voice channel
        {
            find: ".mirror]:",
            replacement: {
                match: /\[(\i).mirror]:\i/,
                replace: "[$1.mirror]:!1"
            }
        }
    ]
});