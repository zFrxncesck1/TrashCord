/*
 * Vencord, a Discord client mod
 * Fixed by zFrxncesck1
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { Button, FluxDispatcher, Menu, React, Toasts, UserStore } from "@webpack/common";
import type { PropsWithChildren, SVGProps } from "react";

const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');

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

export default definePlugin({
    name: "AutoDeco",
    description: "Auto-disconnects you from voice when specific users join your channel. Right-click any user to track them.",
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

    contextMenus: { "user-context": UserContextMenuPatch },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!settings.store.enabled) return;
            const ids = getIds();
            if (!ids.length) return;
            const currentChannelId = SelectedChannelStore.getVoiceChannelId();
            if (!currentChannelId) return;

            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (!ids.includes(userId)) continue;
                if (!channelId || channelId !== currentChannelId || oldChannelId === currentChannelId) continue;

                const name = UserStore.getUser(userId)?.username ?? userId;

                FluxDispatcher.dispatch({ type: "VOICE_CHANNEL_SELECT", channelId: null });

                if (settings.store.showToasts)
                    Toasts.show({ message: `AutoDeco: disconnected because "${name}" joined`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });

                if (settings.store.showNotifications)
                    showNotification({ title: "AutoDeco", body: `Disconnected: "${name}" joined your voice channel` });
            }
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

    stop() { setIds([]); },
});