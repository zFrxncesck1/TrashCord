/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies, ImageSrc } from "@main/csp";

// Google User Content (YouTube, etc.)
CspPolicies["*.googleusercontent.com"] = ImageSrc;

// WebSocket connections for local YouTube Music instance
CspPolicies["ws://localhost:*"] = ConnectSrc;
CspPolicies["ws://127.0.0.1:*"] = ConnectSrc;
CspPolicies["wss://localhost:*"] = ConnectSrc;
CspPolicies["wss://127.0.0.1:*"] = ConnectSrc;

// Lyrics provider
CspPolicies["lrclib.net"] = ConnectSrc;
