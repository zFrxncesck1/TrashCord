/*
 * Vencord, a Discord client mod
 * Fixed by zFrxncesck1
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { playAudio } from "@api/AudioPlayer";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { popNotice, showNotice } from "@api/Notices";
import { showNotification } from "@api/Notifications";
import { definePluginSettings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { Button, ChannelActions, ChannelStore, FluxDispatcher, Menu, React, Toasts, UserStore } from "@webpack/common";
import type { PropsWithChildren, SVGProps } from "react";

const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const GuildChannelStore = findStoreLazy("GuildChannelStore");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');

const WAIT_SOUND_URL = "https://raw.githubusercontent.com/Equicord/Equibored/main/sounds/waitForSlot/notification.mp3";

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
}

interface BaseIconProps extends IconProps { viewBox: string; }
interface IconProps extends SVGProps<SVGSVGElement> {
    className?: string;
    height?: string | number;
    width?: string | number;
}

function Icon({ height = 24, width = 24, className, children, viewBox, ...svgProps }: PropsWithChildren<BaseIconProps>) {
    return (
        <svg className={classes(className, "vc-icon")} role="img" width={width} height={height} viewBox={viewBox} {...svgProps}>
            {children}
        </svg>
    );
}

function AutoDecoIcon(props: IconProps) {
    return (
        <Icon {...props} className={classes(props.className, "vc-autodeco-icon")} viewBox="0 -960 960 960">
            <path fill="currentColor" d="M792-56 56-792l56-56 736 736-56 56ZM480-80q-17 0-28.5-11.5T440-120v-80h-80q-33 0-56.5-23.5T280-280v-80H160v-80q0-83 50-149.5T341-681l-84-84q48-35 104.5-55T480-840q134 0 227 93t93 227q0 57-20 113.5T725-302L56-792zM600-280v-28L326-582q-28 26-47 61t-19 61v100h120v80h80v80h140Z" />
        </Icon>
    );
}

function getIds(): string[] {
    try { return JSON.parse(settings.store.targetUserIds); } catch { return []; }
}
function setIds(ids: string[]) { settings.store.targetUserIds = JSON.stringify(ids); }

let waitingChannelId: string | null = null;
let waitingTriggerUsers: Set<string> = new Set();

function cancelWait() {
    waitingChannelId = null;
    waitingTriggerUsers = new Set();
}

function startWaiting(channelId: string, triggerUserIds: string[]) {
    waitingChannelId = channelId;
    waitingTriggerUsers = new Set(triggerUserIds);
}

function getRandomVoiceChannel(guildId: string, excludeChannelId: string): string | null {
    const channels = GuildChannelStore.getChannels(guildId);
    const vocal: any[] = channels?.VOCAL ?? [];
    const available = vocal
        .map((entry: any) => entry.channel ?? entry)
        .filter((ch: any) => ch.id !== excludeChannelId && ch.type === ChannelType.GUILD_VOICE);
    if (!available.length) return null;
    return available[Math.floor(Math.random() * available.length)].id;
}

export const settings = definePluginSettings({
    targetUserIds: {
        type: OptionType.STRING,
        description: "Tracked user IDs (managed automatically)",
        restartNeeded: false,
        hidden: true,
        default: "[]",
    },
    enabled: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Enable AutoDeco",
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show a toast notification when auto-disconnected",
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Show a desktop notification when auto-disconnected",
    },
    randomVoice: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Move to a random voice channel instead of disconnecting (RandomVoice)",
    },
    waitForSlot: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Rejoin original channel when the tracked user leaves it (WaitForSlot)",
    },
    waitAutoJoin: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Auto-join the original channel when available, without prompting (WaitForSlot)",
    },
    waitNotificationSound: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Play a sound when the original channel slot becomes available (WaitForSlot)",
    },
});

function TrackedUsersList() {
    const { plugins: { AutoDeco: { targetUserIds } } } = useSettings(["plugins.AutoDeco.targetUserIds"]);
    let ids: string[] = [];
    try { ids = JSON.parse(targetUserIds); } catch { }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ color: "var(--text-normal)", fontWeight: 700, fontSize: "14px" }}>
                Tracked Users {ids.length > 0 ? `(${ids.length})` : ""}
            </div>
            {ids.length === 0
                ? <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No users tracked. Right-click a user to add them.</div>
                : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {ids.map(id => {
                            const user = UserStore.getUser(id);
                            return (
                                <div key={id} style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    background: "var(--background-tertiary)", borderRadius: "6px", padding: "6px 10px",
                                }}>
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                        <span style={{ color: "var(--text-normal)", fontSize: "14px", fontWeight: 600 }}>
                                            {user?.username ?? "Unknown User"}
                                        </span>
                                        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{id}</span>
                                    </div>
                                    <Button
                                        size={Button.Sizes.SMALL}
                                        color={Button.Colors.RED}
                                        onClick={() => {
                                            setIds(ids.filter(i => i !== id));
                                            Toasts.show({ message: `AutoDeco: removed ${user?.username ?? id}`, id: Toasts.genId(), type: Toasts.Type.FAILURE });
                                        }}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            );
                        })}
                        <Button
                            style={{ marginTop: "4px" }}
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.RED}
                            onClick={() => {
                                setIds([]);
                                Toasts.show({ message: "AutoDeco: all users cleared", id: Toasts.genId(), type: Toasts.Type.FAILURE });
                            }}
                        >
                            Clear All
                        </Button>
                    </div>
                )
            }
        </div>
    );
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    const ids = getIds();
    const isActive = ids.includes(user.id);
    children.splice(-1, 0, (
        <Menu.MenuGroup key="autodeco-group">
            <Menu.MenuItem
                id="autodeco-toggle"
                label={isActive ? "Remove from AutoDeco" : "Add to AutoDeco"}
                icon={AutoDecoIcon}
                action={() => {
                    setIds(isActive ? ids.filter(id => id !== user.id) : [...ids, user.id]);
                    Toasts.show({
                        message: isActive ? `AutoDeco: removed ${user.username}` : `AutoDeco: now tracking ${user.username}`,
                        id: Toasts.genId(),
                        type: isActive ? Toasts.Type.FAILURE : Toasts.Type.SUCCESS,
                    });
                }}
            />
        </Menu.MenuGroup>
    ));
};

const RtcChannelContextMenuPatch: NavContextMenuPatchCallback = children => {
    children.push(
        <Menu.MenuGroup key="autodeco-rtc-group">
            <Menu.MenuCheckboxItem
                id="autodeco-randomvoice-toggle"
                label="AutoDeco: RandomVoice"
                checked={settings.store.randomVoice}
                action={() => {
                    settings.store.randomVoice = !settings.store.randomVoice;
                    Toasts.show({
                        message: `RandomVoice ${settings.store.randomVoice ? "enabled" : "disabled"}`,
                        id: Toasts.genId(),
                        type: settings.store.randomVoice ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
                    });
                }}
            />
            <Menu.MenuCheckboxItem
                id="autodeco-waitforslot-toggle"
                label="AutoDeco: WaitForSlot"
                checked={settings.store.waitForSlot}
                action={() => {
                    settings.store.waitForSlot = !settings.store.waitForSlot;
                    if (!settings.store.waitForSlot) cancelWait();
                    Toasts.show({
                        message: `WaitForSlot ${settings.store.waitForSlot ? "enabled" : "disabled"}`,
                        id: Toasts.genId(),
                        type: settings.store.waitForSlot ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
                    });
                }}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "AutoDeco",
    description: "Auto-disconnects you from voice when specific users join your channel. Supports RandomVoice (join a random channel instead) and WaitForSlot (rejoin when they leave).",
    authors: [
        { name: "x2b", id: 0n },
        { name: "zFrxncesck1", id: 456195985404592149n },
    ],
    settings,
    settingsAboutComponent: TrackedUsersList,

    patches: [{
        find: "toolbar:function",
        replacement: {
            match: /(function \i\(\i\){)(.{1,200}toolbar.{1,100}mobileToolbar)/,
            replace: "$1$self.addIconToToolBar(arguments[0]);$2",
        },
    }],

    contextMenus: {
        "user-context": UserContextMenuPatch,
        "rtc-channel": RtcChannelContextMenuPatch,
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!settings.store.enabled) return;
            const ids = getIds();

            if (waitingChannelId) {
                for (const { userId, channelId, oldChannelId } of voiceStates) {
                    if (!waitingTriggerUsers.has(userId)) continue;
                    if (oldChannelId !== waitingChannelId || channelId === waitingChannelId) continue;

                    const channelToJoin = waitingChannelId;
                    cancelWait();

                    if (settings.store.waitNotificationSound) playAudio(WAIT_SOUND_URL);

                    if (settings.store.waitAutoJoin) {
                        ChannelActions.selectVoiceChannel(channelToJoin);
                        if (settings.store.showToasts)
                            Toasts.show({ message: "WaitForSlot: slot available, rejoining!", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
                    } else {
                        const ch = ChannelStore.getChannel(channelToJoin);
                        showNotice(`A spot opened up in #${ch?.name ?? channelToJoin}!`, "Rejoin", () => {
                            popNotice();
                            ChannelActions.selectVoiceChannel(channelToJoin);
                        });
                    }
                    break;
                }
            }

            if (!ids.length) return;
            const currentChannelId = SelectedChannelStore.getVoiceChannelId();
            if (!currentChannelId) return;

            const triggerUsers: string[] = [];
            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (!ids.includes(userId)) continue;
                if (!channelId || channelId !== currentChannelId || oldChannelId === currentChannelId) continue;
                triggerUsers.push(userId);
            }

            if (!triggerUsers.length) return;

            const name = triggerUsers.map(id => UserStore.getUser(id)?.username ?? id).join(", ");
            const disconnectedFrom = currentChannelId;
            const channel = ChannelStore.getChannel(disconnectedFrom);
            const guildId = channel?.guild_id;

            if (settings.store.randomVoice && guildId) {
                const randomChannelId = getRandomVoiceChannel(guildId, disconnectedFrom);
                if (randomChannelId) {
                    ChannelActions.selectVoiceChannel(randomChannelId);
                    if (settings.store.showToasts)
                        Toasts.show({ message: `AutoDeco: moved to random channel ("${name}" joined)`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
                } else {
                    FluxDispatcher.dispatch({ type: "VOICE_CHANNEL_SELECT", channelId: null });
                    if (settings.store.showToasts)
                        Toasts.show({ message: `AutoDeco: disconnected, no other channels available ("${name}" joined)`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
                }
            } else {
                FluxDispatcher.dispatch({ type: "VOICE_CHANNEL_SELECT", channelId: null });
                if (settings.store.showToasts)
                    Toasts.show({ message: `AutoDeco: disconnected because "${name}" joined`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
            }

            if (settings.store.showNotifications)
                showNotification({ title: "AutoDeco", body: `Disconnected: "${name}" joined your voice channel` });

            if (settings.store.waitForSlot)
                startWaiting(disconnectedFrom, triggerUsers);
        },
    },

    AutoDecoIndicator() {
        const { plugins: { AutoDeco: { targetUserIds } } } = useSettings(["plugins.AutoDeco.targetUserIds"]);
        let ids: string[] = [];
        try { ids = JSON.parse(targetUserIds); } catch { }
        if (!ids.length) return null;

        const names = ids.map(id => UserStore.getUser(id)?.username ?? id).join(", ");

        return (
            <HeaderBarIcon
                tooltip={`AutoDeco active: ${names} — right-click to clear all`}
                icon={AutoDecoIcon}
                onClick={() => { }}
                onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault();
                    setIds([]);
                    Toasts.show({ message: "AutoDeco: all users cleared", id: Toasts.genId(), type: Toasts.Type.FAILURE });
                }}
            />
        );
    },

    addIconToToolBar(e: { toolbar: React.ReactNode[] | React.ReactNode; }) {
        const icon = <ErrorBoundary noop key="autodeco-indicator"><this.AutoDecoIndicator /></ErrorBoundary>;
        if (Array.isArray(e.toolbar)) e.toolbar.push(icon);
        else e.toolbar = [icon, e.toolbar];
    },

    stop() {
        setIds([]);
        cancelWait();
    },
});
