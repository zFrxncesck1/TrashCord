/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, SelectedChannelStore, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    intervalMs: {
        type: OptionType.NUMBER,
        description: "Tick interval (ms) [Default: 429 & Recommended: 429+]",
        default: 429
    }
});

const streamStart    = findByCodeLazy('dispatch({type:"STREAM_START"');
const mediaEngine    = findByPropsLazy("getMediaEngine");
const desktopSources = findByCodeLazy("desktop sources");

let interval:    ReturnType<typeof setInterval> | null = null;
let keyListener: ((e: KeyboardEvent) => void)  | null = null;
let styleEl:     HTMLStyleElement              | null = null;
let on  = false;
let src: any = null;
let uid = "";

function injectStyle() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.textContent = '[class*="activityPanel"],.vc-whos-watching-screenshare-panel{display:none!important}';
    document.head.appendChild(styleEl);
}

function removeStyle() {
    styleEl?.remove();
    styleEl = null;
}

function streamKey(guildId: string | null | undefined, channelId: string): string {
    return guildId ? `guild:${guildId}:${channelId}:${uid}` : `call:${channelId}:${uid}`;
}

function forceClose() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) return;
    const channel = ChannelStore.getChannel(channelId);
    const key = streamKey(channel.guild_id, channelId);
    FluxDispatcher.dispatch({ type: "STREAM_STOP",   streamKey: key });
    FluxDispatcher.dispatch({ type: "STREAM_DELETE", streamKey: key });
}

function tick() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) { stopSpam(); return; }
    const channel = ChannelStore.getChannel(channelId);
    if (!on) {
        streamStart(channel.guild_id, channelId, {
            pid: null, sourceId: src.id, sourceName: src.name,
            audioSourceId: null, sound: true, previewDisabled: false
        });
        on = true;
    } else {
        forceClose();
        on = false;
    }
}

function stopSpam() {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
    if (keyListener) { document.removeEventListener("keydown", keyListener); keyListener = null; }
    if (on) { forceClose(); on = false; }
    src = null;
    uid = "";
    removeStyle();
    Toasts.show({ message: "⏹ ScreenshareSpammer - Stopped", type: Toasts.Type.SUCCESS, id: Toasts.genId(), options: { duration: 1500 } });
}

async function startSpam() {
    if (interval) return;
    uid = UserStore.getCurrentUser().id;
    const engine = mediaEngine.getMediaEngine();
    src = await desktopSources(engine, ["screen"], null);
    keyListener = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "S") { e.preventDefault(); stopSpam(); }
    };
    document.addEventListener("keydown", keyListener);
    injectStyle();
    Toasts.show({ message: "📡 Spamming Started — Ctrl+Shift+S to Stop", type: Toasts.Type.MESSAGE, id: "ss-spam", options: { duration: 2500 } });
    interval = setInterval(tick, settings.store.intervalMs);
}

export default definePlugin({
    name: "ScreenshareSpammer",
    description: "Spam Screenshare Start/Stop in VC",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["Voice", "Fun", "Spam", "Shortcuts"],
    enabledByDefault: false,
    settings,
    stop() { stopSpam(); },
    contextMenus: {
        "rtc-channel"(children) {
            children.push(
                <Menu.MenuSeparator />,
                interval
                    ? <Menu.MenuItem id="ss-spam-stop" label="Stop ScreenShareSpam" action={stopSpam} />
                    : <Menu.MenuItem id="ss-spam-start" label="Start ScreenShareSpam" action={startSpam} />
            );
        }
    }
});