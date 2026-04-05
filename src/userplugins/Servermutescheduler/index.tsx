import { definePluginSettings } from "@api/Settings";
import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { GuildStore, React } from "@webpack/common";

// ─── Notification constants ───────────────────────────────────────────────────
const NOTIF_MENTIONS = 1;

// ─── Settings ────────────────────────────────────────────────────────────────
const settings = definePluginSettings({
    activeStart: {
        type: OptionType.NUMBER,
        description: "UTC hour when servers UNMUTE (0–23). Default: 16 (4 PM UTC)",
        default: 16,
        restartNeeded: false,
    },
    activeEnd: {
        type: OptionType.NUMBER,
        description: "UTC hour when servers MUTE (0–23). Default: 0 (midnight UTC)",
        default: 0,
        restartNeeded: false,
    },
    excludedServers: {
        type: OptionType.STRING,
        description: "Server IDs to NEVER touch — comma separated. Right-click server icon → Copy Server ID. Example: 123456789,987654321",
        default: "",
        restartNeeded: false,
    },
    paused: {
        type: OptionType.BOOLEAN,
        description: "Pause the scheduler (can also toggle with the slider in the server list)",
        default: false,
        restartNeeded: false,
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getExcludedIds(): string[] {
    return settings.store.excludedServers
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

function shouldMuteNow(): boolean {
    if (settings.store.paused) return false;

    const start = settings.store.activeStart;
    const end   = settings.store.activeEnd;
    const hour  = new Date().getUTCHours();

    if (start > end) {
        return !(hour >= start || hour < end);
    }
    return !(hour >= start && hour < end);
}

async function applyMuteState(mute: boolean) {
    try {
        const ActionCreators = findByProps("updateGuildNotificationSettings");
        if (!ActionCreators?.updateGuildNotificationSettings) return;

        const excluded = getExcludedIds();
        const guilds   = Object.keys(GuildStore.getGuilds()).filter(id => !excluded.includes(id));

        for (const guildId of guilds) {
            if (mute) {
                ActionCreators.updateGuildNotificationSettings(guildId, {
                    muted: true,
                    mute_config: { selected_time_window: -1, end_time: null },
                });
            } else {
                ActionCreators.updateGuildNotificationSettings(guildId, {
                    muted: false,
                    mute_config: null,
                    message_notifications: NOTIF_MENTIONS,
                });
            }
        }
    } catch (e) {
        console.error("[ServerMuteScheduler] Error:", e);
    }
}

// ─── Toggle Slider Component ──────────────────────────────────────────────────
function ToggleSlider() {
    const [paused, setPaused] = React.useState(settings.store.paused);
    const isOn = !paused;

    function toggle() {
        const next = !settings.store.paused;
        settings.store.paused = next;
        setPaused(next);
        applyMuteState(next ? false : shouldMuteNow());
    }

    const title = paused
        ? "ServerMuteScheduler: OFF — click to enable"
        : "ServerMuteScheduler: ON — click to pause";

    return React.createElement(
        "div",
        {
            title,
            style: {
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                marginBottom:   "8px",
                gap:            "3px",
            },
        },
        // Label
        React.createElement(
            "span",
            {
                style: {
                    fontSize:   "9px",
                    fontWeight: "700",
                    color:      isOn ? "#23a55a" : "#ed4245",
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    userSelect: "none",
                },
            },
            isOn ? "ON" : "OFF"
        ),
        // Slider track
        React.createElement(
            "div",
            {
                onClick: toggle,
                title,
                style: {
                    width:           "36px",
                    height:          "20px",
                    borderRadius:    "10px",
                    backgroundColor: isOn ? "#23a55a" : "#ed4245",
                    cursor:          "pointer",
                    position:        "relative",
                    transition:      "background-color 0.2s ease",
                    boxShadow:       "inset 0 1px 3px rgba(0,0,0,0.3)",
                },
            },
            // Slider thumb
            React.createElement("div", {
                style: {
                    width:           "14px",
                    height:          "14px",
                    borderRadius:    "50%",
                    backgroundColor: "#fff",
                    position:        "absolute",
                    top:             "3px",
                    left:            isOn ? "19px" : "3px",
                    transition:      "left 0.2s ease",
                    boxShadow:       "0 1px 3px rgba(0,0,0,0.3)",
                },
            })
        )
    );
}

// ─── Plugin ──────────────────────────────────────────────────────────────────
let checkInterval: ReturnType<typeof setInterval> | null = null;

export default definePlugin({
    name: "ServerMuteScheduler",
    description:
        "Mutes all servers outside your active UTC hours, sets @mentions only inside active hours. " +
        "Excluded servers are never touched. Toggle with the slider in the server list.",
    authors: [{ name: "You", id: 0n }],
    settings,

    start() {
        applyMuteState(shouldMuteNow());
        checkInterval = setInterval(() => applyMuteState(shouldMuteNow()), 60_000);
        addServerListElement(ServerListRenderPosition.Above, ToggleSlider);
    },

    stop() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        removeServerListElement(ServerListRenderPosition.Above, ToggleSlider);
        applyMuteState(false);
    },
});
