/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { ChannelStore, NavigationRouter, PresenceStore, UserStore } from "@webpack/common";

import { logStalkerEvent, settings, targets } from ".";

let lastStatuses: Statuses | undefined;

type Statuses = { [id: string]: string; };

export const init = () => {
    PresenceStore.addChangeListener(statusChange);
};

export const deinit = () => {
    PresenceStore.removeChangeListener(statusChange);
    lastStatuses = {};
};

export const statusChange = () => {
    const rawNewStatuses: Statuses = PresenceStore.getState()?.statuses;
    if (typeof rawNewStatuses !== "object") return;
    const newStatuses: Statuses = { ...rawNewStatuses };

    for (const id of targets) {
        if (!newStatuses[id]) newStatuses[id] = "offline";
    }

    if (!lastStatuses) lastStatuses = { ...newStatuses };

    for (const [id, status] of Object.entries(newStatuses)) {
        const isStalking = targets.includes(id);
        const lastStatus = lastStatuses[id] ?? "offline";

        if (isStalking && lastStatus !== status) {
            let shouldNotify = false;
            if (lastStatus === "offline" && settings.store.notifyGoOnline) shouldNotify = true;
            if (status === "dnd" && settings.store.notifyDnd) shouldNotify = true;
            if (status === "idle" && settings.store.notifyIdle) shouldNotify = true;
            if (status === "online" && settings.store.notifyOnline) shouldNotify = true;
            if (status === "offline" && settings.store.notifyOffline) shouldNotify = true;

            if (shouldNotify) {
                const user = UserStore.getUser(id);
                const color = `#${user.accentColor?.toString(16)}`;

                showNotification({
                    title: "StalkerPro",
                    body: `${user.username} is now ${status === "dnd" ? "in " : ""}${status ?? "offline"}`,
                    color,
                    icon: user.getAvatarURL(),
                    onClick: () => {
                        NavigationRouter.transitionTo(`/channels/@me/${ChannelStore.getDMFromUserId(user.id)}`);
                    },
                });

                logStalkerEvent({
                    timestamp: new Date().toISOString(),
                    userId: user.id,
                    username: user.username,
                    action: "status_change",
                    details: `Status changed from ${lastStatus} to ${status}`
                });
            }
        }
    }

    lastStatuses = { ...newStatuses };
};