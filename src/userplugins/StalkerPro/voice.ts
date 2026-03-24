/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, GenericStore, GuildStore, UserStore } from "@webpack/common";

import { logStalkerEvent, targets } from ".";

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

type VoiceStateData = {
    channelId: string;
    userId: string;
};

const VoiceStateStore: GenericStore = findStoreLazy("VoiceStateStore");

let lastVoiceState: { [userId: string]: VoiceStateData | null } = {};

export const init = () => {
    voiceStateChange();
    VoiceStateStore.addChangeListener(voiceStateChange);
};

export const deinit = () => {
    VoiceStateStore.removeChangeListener(voiceStateChange);
    lastVoiceState = {};
};

const getChannelName = (channelId: string): string => {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "Unknown Channel";

    if (channel.isGuildVoice() || channel.isGuildStageVoice()) {
        const guild = GuildStore.getGuild(channel.guild_id);
        return `${channel.name} from ${guild?.name ?? "Unknown Guild"}`;
    }
    return channel.name;
};

export const voiceStateChange = () => {
    const newVoiceState: { [userId: string]: VoiceStateData | null } = {};

    for (const id of targets) {
        const state = VoiceStateStore.getVoiceStateForUser(id);
        newVoiceState[id] = state ? { channelId: state.channelId, userId: state.userId } : null;
        const current = newVoiceState[id];
        const previous = lastVoiceState[id];

        const user = UserStore.getUser(id);
        if (!user) continue;

        if (current && !previous) {
            // Joined a voice channel
            if (settings.store.notifyCallJoin) {
                const color = `#${user.accentColor?.toString(16)}`;
                showNotification({
                    body: `${user.username} is in VC: ${getChannelName(current.channelId)}\nClick to join them.`,
                    title: "StalkerPro",
                    icon: user.getAvatarURL(),
                    color,
                    onClick: () => selectVoiceChannel(current.channelId),
                });
            }
            logStalkerEvent({
                timestamp: new Date().toISOString(),
                userId: user.id,
                username: user.username,
                action: "voice_join",
                details: `Joined voice channel: ${getChannelName(current.channelId)}`
            });
        } else if (current && previous && current.channelId !== previous.channelId) {
            // Moved to another channel
            if (settings.store.notifyCallJoin) {
                const color = `#${user.accentColor?.toString(16)}`;
                showNotification({
                    body: `${user.username} moved to VC: ${getChannelName(current.channelId)}\nClick to join them.`,
                    title: "StalkerPro",
                    icon: user.getAvatarURL(),
                    color,
                    onClick: () => selectVoiceChannel(current.channelId),
                });
            }
            logStalkerEvent({
                timestamp: new Date().toISOString(),
                userId: user.id,
                username: user.username,
                action: "voice_join",
                details: `Moved to voice channel: ${getChannelName(current.channelId)}`
            });
        } else if (!current && previous) {
            // Left voice channel
            logStalkerEvent({
                timestamp: new Date().toISOString(),
                userId: user.id,
                username: user.username,
                action: "voice_leave",
                details: `Left voice channel: ${getChannelName(previous.channelId)}`
            });
        }
    }

    lastVoiceState = newVoiceState;
};