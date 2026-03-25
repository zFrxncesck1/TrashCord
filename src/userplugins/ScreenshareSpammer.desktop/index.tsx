import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { Menu, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    intervalMs: {
        type: OptionType.NUMBER,
        description: "Tick interval (ms) [Default: 429 & Recommended: 429+]",
        default: 429
    }
});

let interval: ReturnType<typeof setInterval> | null = null;
let keyListener: ((e: KeyboardEvent) => void) | null = null;
let observer: MutationObserver | null = null;
let on = false;
let src: any = null;

function hidePanels() {
    document.querySelectorAll<HTMLElement>('[class*="activityPanel"]').forEach(el => {
        el.style.display = "none";
    });
}

function showPanels() {
    document.querySelectorAll<HTMLElement>('[class*="activityPanel"]').forEach(el => {
        el.style.display = "";
    });
}

function startObserver() {
    hidePanels();
    observer = new MutationObserver(hidePanels);
    observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
    observer?.disconnect();
    observer = null;
    showPanels();
}

function streamKey(guildId: string, channelId: string): string {
    return `guild:${guildId}:${channelId}:${Vencord.Webpack.Common.UserStore.getCurrentUser().id}`;
}

function forceClose() {
    const channelId = Vencord.Webpack.Common.SelectedChannelStore.getVoiceChannelId();
    if (!channelId) return;
    const channel = Vencord.Webpack.Common.ChannelStore.getChannel(channelId);
    const key = streamKey(channel.guild_id, channelId);
    Vencord.Webpack.Common.FluxDispatcher.dispatch({ type: "STREAM_STOP", streamKey: key });
    Vencord.Webpack.Common.FluxDispatcher.dispatch({ type: "STREAM_DELETE", streamKey: key });
}

function tick() {
    const channelId = Vencord.Webpack.Common.SelectedChannelStore.getVoiceChannelId();
    if (!channelId) { stopSpam(); return; }
    const channel = Vencord.Webpack.Common.ChannelStore.getChannel(channelId);
    if (!on) {
        Vencord.Webpack.findByCode('dispatch({type:"STREAM_START"')(channel.guild_id, channelId, {
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
    stopObserver();
    Toasts.show({ message: "⏹ ScreenshareSpammer - Stopped", type: Toasts.Type.SUCCESS, id: Toasts.genId(), options: { duration: 1500 } });
}

async function startSpam() {
    if (interval) return;
    const engine = Vencord.Webpack.findByProps("getMediaEngine").getMediaEngine();
    src = await Vencord.Webpack.findByCode("desktop sources")(engine, ["screen"], null);
    keyListener = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "S") { e.preventDefault(); stopSpam(); }
    };
    document.addEventListener("keydown", keyListener);
    startObserver();
    Toasts.show({ message: "📡 Spamming Started — Ctrl+Shift+S to Stop", type: Toasts.Type.MESSAGE, id: "ss-spam", options: { duration: 2500 } });
    interval = setInterval(tick, settings.store.intervalMs);
}

export default definePlugin({
    name: "ScreenshareSpammer",
    description: "Spam Screenshare Start/Stop in VC",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
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
