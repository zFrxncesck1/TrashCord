/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

module.exports = {
    STATUS: {
        online: () => "🟢 Online",
        idle: () => "🌙 Idle",
        dnd: () => "⛔ Do Not Disturb",
        streaming: () => "🟣 Streaming",
        invisible: () => "⚫ Invisible"
    },
    DEVICE: {
        desktop: () => "🖥 Desktop",
        mobile: () => "📱 Mobile",
        web: () => "🌐 Web Browser"
    },
    OS: {
        windows: "🪟 Windows",
        linux: "🐧 Linux",
        macos: "🍎 MacOS",
        android: "🤖 Android",
        ios: "🍎 iOS"
    }
};
