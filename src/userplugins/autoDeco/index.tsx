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
import { HeadingSecondary } from "@components/Heading";
import { classes } from "@utils/misc";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { findByCodeLazy, findComponentByCodeLazy, findStoreLazy } from "@webpack";
import {
    Button, ChannelActions, ChannelRouter, ChannelStore, FluxDispatcher,
    GuildChannelStore, MediaEngineStore, Menu, PermissionsBits, PermissionStore,
    React, Toasts, UserStore, VoiceActions, VoiceStateStore,
} from "@webpack/common";
import type { PropsWithChildren, SVGProps } from "react";

const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');
const startStream = findByCodeLazy('type:"STREAM_START"');
const getDesktopSources = findByCodeLazy("desktop sources");

const WAIT_SOUND_URL = "https://raw.githubusercontent.com/Equicord/Equibored/main/sounds/waitForSlot/notification.mp3";

const OP_OPTIONS = [
    { label: "Off",       value: "off", default: true  },
    { label: "More than", value: "<",   default: false },
    { label: "Less than", value: ">",   default: false },
    { label: "Equal to",  value: "==",  default: false },
] as const;

interface VoiceState { userId: string; channelId?: string; oldChannelId?: string; }
interface BaseIconProps extends IconProps { viewBox: string; }
interface IconProps extends SVGProps<SVGSVGElement> { className?: string; height?: string | number; width?: string | number; }

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

function SectionSeparator(title: string) {
    return (
        <>
            <hr style={{ width: "100%" }} />
            <HeadingSecondary>{title}</HeadingSecondary>
            <hr style={{ width: "100%" }} />
        </>
    );
}

function getIds(): string[] { try { return JSON.parse(settings.store.targetUserIds); } catch { return []; } }
function setIds(ids: string[]) { settings.store.targetUserIds = JSON.stringify(ids); }

let waitingChannelId: string | null = null;
let waitingTriggerUsers = new Set<string>();

function cancelWait() { waitingChannelId = null; waitingTriggerUsers = new Set(); }
function startWaiting(channelId: string, userIds: string[]) { waitingChannelId = channelId; waitingTriggerUsers = new Set(userIds); }

const ops: Record<string, (a: number, b: number) => boolean> = {
    ">":  (a, b) => a < b,
    "<":  (a, b) => a > b,
    "==": (a, b) => a === b,
};

function checkOp(op: string, a: number, b: number): boolean {
    if (op === "off") return true;
    return ops[op]?.(a, b) ?? true;
}

function getRandomVoiceChannel(triggeredGuildId: string, excludeChannelId: string): string | null {
    const guildIds = [triggeredGuildId, ...settings.store.rvServers.split("/").filter(Boolean)];
    const candidates: string[] = [];
    const currentUserId = UserStore.getCurrentUser().id;

    for (const guildId of guildIds) {
        const guildChannels = GuildChannelStore.getChannels(guildId);
        const vocalEntries: any[] = guildChannels?.VOCAL ?? [];

        for (const entry of vocalEntries) {
            const ch = entry.channel ?? entry;
            if (!ch?.id || ch.id === excludeChannelId) continue;
            const excludedChannels = settings.store.rvExcludedChannels.split("/").filter(Boolean);
            if (excludedChannels.includes(ch.id)) continue;
            if (settings.store.rvAvoidStages && ch.isGuildStageVoice?.()) continue;
            if (!PermissionStore.can(PermissionsBits.CONNECT, ch)) continue;
            if (settings.store.rvAvoidAfk && !PermissionStore.can(PermissionsBits.SPEAK, ch)) continue;

            const states = VoiceStateStore.getVoiceStatesForChannel(ch.id);
            const stateValues = Object.values(states) as any[];
            const userCount = stateValues.length;
            const vcLimit = ch.userLimit === 0 ? 99 : ch.userLimit;
            const spacesLeft = vcLimit - userCount;

            if (userCount >= vcLimit) continue;
            if (Object.keys(states).includes(currentUserId)) continue;

            if (!checkOp(settings.store.rvUserAmountOperation, userCount, settings.store.rvUserAmount)) continue;
            if (!checkOp(settings.store.rvSpacesLeftOperation, spacesLeft, settings.store.rvSpacesLeft)) continue;
            if (!checkOp(settings.store.rvVcLimitOperation, vcLimit, settings.store.rvVcLimit)) continue;

            if (settings.store.rvAvoidStates && stateValues.length > 0) {
                let mismatches = 0;
                for (const s of stateValues) {
                    if (settings.store.rvFilterDeafen && s.selfDeaf) mismatches++;
                    if (settings.store.rvFilterVideo && !s.selfVideo) mismatches++;
                    if (settings.store.rvFilterStream && !s.selfStream) mismatches++;
                    if (!settings.store.rvFilterDeafen && settings.store.rvFilterMute && s.selfMute) mismatches++;
                }
                if (mismatches > 0) continue;
            }

            if (settings.store.rvIncludeStates && !settings.store.rvAvoidStates && stateValues.length > 0) {
                const anyMatch = stateValues.some(s =>
                    (!settings.store.rvFilterDeafen || s.selfDeaf) &&
                    (!settings.store.rvFilterVideo || s.selfVideo) &&
                    (!settings.store.rvFilterStream || s.selfStream) &&
                    (settings.store.rvFilterDeafen || !settings.store.rvFilterMute || s.selfMute)
                );
                if (!anyMatch) continue;
            }

            candidates.push(ch.id);
        }
    }

    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
}

async function autoStream() {
    const mediaEngine = MediaEngineStore.getMediaEngine();
    const selected = SelectedChannelStore.getVoiceChannelId();
    if (!selected) return;
    const ch = ChannelStore.getChannel(selected);
    const sources = await getDesktopSources(mediaEngine, ["screen"], null);
    if (!sources?.length || ch?.type === 13 || !PermissionStore.can(PermissionsBits.STREAM, ch)) return;
    startStream(ch.guild_id, selected, { pid: null, sourceId: sources[0].id, sourceName: sources[0].name, audioSourceId: null, sound: true, previewDisabled: false });
}

function autoCamera() {
    const check = setInterval(() => {
        if (document.querySelector('[aria-label="Turn off Camera" i]')) { clearInterval(check); return; }
        const on = document.querySelector('[aria-label="Turn on Camera" i]') as HTMLButtonElement | null;
        if (on) { clearInterval(check); on.click(); }
    }, 50);
}

function joinVoiceChannel(channelId: string) {
    const ch = ChannelStore.getChannel(channelId);
    ChannelActions.selectVoiceChannel(channelId);
    if (settings.store.rvAutoNavigate) ChannelRouter.transitionToChannel(channelId);
    if (ch && settings.store.rvAutoCamera && PermissionStore.can(PermissionsBits.STREAM, ch)) autoCamera();
    if (ch && settings.store.rvAutoStream && PermissionStore.can(PermissionsBits.STREAM, ch)) autoStream();
    if (settings.store.rvSelfMute && !MediaEngineStore.isSelfMute() && SelectedChannelStore.getVoiceChannelId()) VoiceActions.toggleSelfMute();
    if (settings.store.rvSelfDeafen && !MediaEngineStore.isSelfDeaf() && SelectedChannelStore.getVoiceChannelId()) VoiceActions.toggleSelfDeaf();
}

export const settings = definePluginSettings({
    targetUserIds: {
        type: OptionType.STRING,
        description: "Tracked user IDs (managed automatically)",
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
        restartNeeded: false,
        hidden: true,
        default: "[]",
    },

    _sepAutoDeco: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => SectionSeparator("⚡ AutoDeco"),
    },
    enabled: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Enable AutoDeco — auto-disconnect when tracked users join your channel",
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

    _sepRandomVoice: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => SectionSeparator("🎲 RandomVoice"),
    },
    randomVoice: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Move to a random voice channel instead of disconnecting",
    },
    rvShowInContextMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show RandomVoice toggle in the voice context menu",
    },
    rvDelay: {
        type: OptionType.NUMBER,
        default: 0,
        description: "Delay in milliseconds before moving to a random channel (0 = instant)",
    },
    rvServers: {
        type: OptionType.STRING,
        default: "",
        description: "Extra server IDs to include when searching (slash-separated). The disconnected server is always included automatically.",
    },
    rvExcludedChannels: {
        type: OptionType.STRING,
        default: "",
        description: "Channel IDs to never join when RandomVoice picks a random channel (slash-separated, e.g. 123456789/987654321).",
    },

    _sepRvFilters: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => SectionSeparator("🔢 RandomVoice — Channel Filters"),
    },
    rvUserAmountOperation: {
        type: OptionType.SELECT,
        description: "User amount filter operation — set to Off to ignore this filter",
        options: [...OP_OPTIONS],
    },
    rvUserAmount: {
        type: OptionType.SLIDER,
        description: "Target user amount in candidate channels (ignored when operation is Off)",
        markers: makeRange(0, 15, 1),
        default: 3,
        stickToMarkers: true,
    },
    rvSpacesLeftOperation: {
        type: OptionType.SELECT,
        description: "Spaces left filter operation — set to Off to ignore this filter",
        options: [...OP_OPTIONS],
    },
    rvSpacesLeft: {
        type: OptionType.SLIDER,
        description: "Target spaces left in candidate channels (ignored when operation is Off)",
        markers: makeRange(0, 15, 1),
        default: 3,
        stickToMarkers: true,
    },
    rvVcLimitOperation: {
        type: OptionType.SELECT,
        description: "Voice channel limit filter operation — set to Off to ignore this filter",
        options: [...OP_OPTIONS],
    },
    rvVcLimit: {
        type: OptionType.SLIDER,
        description: "Target voice channel user limit for candidate channels (ignored when operation is Off)",
        markers: makeRange(1, 15, 1),
        default: 5,
        stickToMarkers: true,
    },

    _sepRvBehavior: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => SectionSeparator("⚙️ RandomVoice — Behavior"),
    },
    rvAutoNavigate: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically navigate to the random voice channel in the UI",
    },
    rvAutoCamera: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically turn on camera when joining a random channel",
    },
    rvAutoStream: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically start screen stream when joining a random channel",
    },
    rvSelfMute: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically self-mute when joining a random channel",
    },
    rvSelfDeafen: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically self-deafen when joining a random channel",
    },
    rvLeaveEmpty: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Find another random channel when the current one becomes empty (requires RandomVoice enabled)",
    },
    rvAvoidStages: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Avoid joining stage channels",
    },
    rvAvoidAfk: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Avoid joining AFK channels",
    },

    _sepRvStates: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => SectionSeparator("🎭 RandomVoice — State Filters"),
    },
    rvFilterVideo: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Filter channels by users with camera on",
    },
    rvFilterStream: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Filter channels by users who are streaming",
    },
    rvFilterMute: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Filter channels by users who are muted",
    },
    rvFilterDeafen: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Filter channels by users who are deafened",
    },
    rvIncludeStates: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Include only channels matching the selected state filters",
    },
    rvAvoidStates: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Avoid channels matching the selected state filters",
    },

    _sepWaitForSlot: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => SectionSeparator("⏳ WaitForSlot"),
    },
    waitForSlot: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Rejoin the original channel when the tracked user leaves it",
    },
    wfsShowInContextMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show WaitForSlot toggle in the voice context menu",
    },
    waitAutoJoin: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically rejoin without showing a notice",
    },
    waitNotificationSound: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Play a sound when the original channel slot becomes available",
    },
});

function TrackedUsersList() {
    const { plugins: { AutoDeco: { targetUserIds } } } = useSettings(["plugins.AutoDeco.targetUserIds"]);
    let ids: string[] = [];
    try { ids = JSON.parse(targetUserIds); } catch { }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ color: "var(--text-brand)", fontWeight: 700, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Tracked Users {ids.length > 0 ? `(${ids.length})` : ""}
            </span>
            {ids.length === 0
                ? <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>No users tracked. Right-click a user to add them.</span>
                : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{
                            display: "flex", flexDirection: "column", gap: "4px",
                            maxHeight: "220px", overflowY: "auto",
                            paddingRight: "4px",
                        }}>
                            {ids.map(id => {
                                const user = UserStore.getUser(id);
                                return (
                                    <div key={id} style={{
                                        display: "flex", alignItems: "center", justifyContent: "space-between",
                                        background: "var(--background-tertiary)", borderRadius: "6px", padding: "6px 10px",
                                        border: "1px solid var(--background-modifier-accent)",
                                        flexShrink: 0,
                                    }}>
                                        <div style={{ display: "flex", flexDirection: "column" }}>
                                            <span style={{ color: "var(--text-link)", fontSize: "14px", fontWeight: 700 }}>
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
                                        >Remove</Button>
                                    </div>
                                );
                            })}
                        </div>
                        <Button
                            style={{ marginTop: "4px" }}
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.RED}
                            onClick={() => {
                                setIds([]);
                                Toasts.show({ message: "AutoDeco: all users cleared", id: Toasts.genId(), type: Toasts.Type.FAILURE });
                            }}
                        >Clear All</Button>
                    </div>
                )}
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
    const showRV = settings.store.rvShowInContextMenu;
    const showWFS = settings.store.wfsShowInContextMenu;
    if (!showRV && !showWFS) return;
    children.push(
        <Menu.MenuGroup key="autodeco-rtc-group">
            {showRV && (
                <Menu.MenuCheckboxItem
                    id="autodeco-randomvoice-toggle"
                    label="AutoDeco: RandomVoice"
                    checked={settings.store.randomVoice}
                    action={() => {
                        settings.store.randomVoice = !settings.store.randomVoice;
                        Toasts.show({ message: `RandomVoice ${settings.store.randomVoice ? "enabled" : "disabled"}`, id: Toasts.genId(), type: settings.store.randomVoice ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE });
                    }}
                />
            )}
            {showWFS && (
                <Menu.MenuCheckboxItem
                    id="autodeco-waitforslot-toggle"
                    label="AutoDeco: WaitForSlot"
                    checked={settings.store.waitForSlot}
                    action={() => {
                        settings.store.waitForSlot = !settings.store.waitForSlot;
                        if (!settings.store.waitForSlot) cancelWait();
                        Toasts.show({ message: `WaitForSlot ${settings.store.waitForSlot ? "enabled" : "disabled"}`, id: Toasts.genId(), type: settings.store.waitForSlot ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE });
                    }}
                />
            )}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "AutoDeco",
    description: "Auto-disconnects you from voice when specific users join your channel. Includes RandomVoice (move to a filtered random channel) and WaitForSlot (rejoin when they leave).",
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
            if (waitingChannelId) {
                for (const { userId, channelId, oldChannelId } of voiceStates) {
                    if (!waitingTriggerUsers.has(userId)) continue;
                    if (oldChannelId !== waitingChannelId || channelId === waitingChannelId) continue;

                    const target = waitingChannelId;
                    cancelWait();

                    if (settings.store.waitNotificationSound) playAudio(WAIT_SOUND_URL);

                    if (settings.store.waitAutoJoin) {
                        joinVoiceChannel(target);
                        if (settings.store.showToasts)
                            Toasts.show({ message: "WaitForSlot: slot available, rejoining!", id: Toasts.genId(), type: Toasts.Type.SUCCESS });
                    } else {
                        const ch = ChannelStore.getChannel(target);
                        showNotice(`A spot opened in #${ch?.name ?? target}!`, "Rejoin", () => {
                            popNotice();
                            joinVoiceChannel(target);
                        });
                    }
                    break;
                }
            }

            if (settings.store.rvLeaveEmpty && settings.store.randomVoice) {
                const currentUserId = UserStore.getCurrentUser().id;
                const myChannelId = VoiceStateStore.getVoiceStateForUser(currentUserId)?.channelId;
                if (myChannelId) {
                    const others = Object.values(VoiceStateStore.getVoiceStates() as Record<string, any>)
                        .filter(vs => vs.channelId === myChannelId && vs.userId !== currentUserId);
                    if (others.length === 0) {
                        const guildId = ChannelStore.getChannel(myChannelId)?.guild_id;
                        if (guildId) {
                            const next = getRandomVoiceChannel(guildId, myChannelId);
                            if (next) joinVoiceChannel(next);
                        }
                    }
                }
            }

            if (!settings.store.enabled) return;
            const ids = getIds();
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
            const guildId = ChannelStore.getChannel(disconnectedFrom)?.guild_id;

            const doAction = () => {
                if (settings.store.randomVoice && guildId) {
                    const randomId = getRandomVoiceChannel(guildId, disconnectedFrom);
                    if (randomId) {
                        joinVoiceChannel(randomId);
                        if (settings.store.showToasts)
                            Toasts.show({ message: `AutoDeco: moved to random channel ("${name}" joined)`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
                    } else {
                        FluxDispatcher.dispatch({ type: "VOICE_CHANNEL_SELECT", channelId: null });
                        if (settings.store.showToasts)
                            Toasts.show({ message: `AutoDeco: no suitable channel found, disconnected ("${name}" joined)`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
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
            };

            const delay = settings.store.randomVoice ? settings.store.rvDelay : 0;
            if (delay > 0) setTimeout(doAction, delay);
            else doAction();
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