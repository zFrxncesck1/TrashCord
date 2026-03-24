/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import { i18n } from "@webpack/common";

import { DEVICE, OS, STATUS } from "./constants";

const SessionsStore = findStoreLazy("SessionsStore");

interface Emoji {
    animated: boolean,
    id: string,
    name: string;
}

interface Activity {
    type: number;
    timestamps: {
        start: number;
        end: number;
    };
    state: string;
    session_id: string;
    name: string;
    id: string;
    emoji: Emoji;
    details: string;
    created_at: number;
    buttons: string[];
    url: string,
    assets: {
        small_text: string;
        small_image: string;
        large_text: string;
        large_image: string;
    };
    application_id: string;
}

interface ClientInfo {
    version: number;
    os: string;
    client: string;
}

interface Session {
    sessionId: string;
    status: string;
    activities: Activity[];
    active: boolean;
    clientInfo: ClientInfo;
}

interface SessionData {
    [sessionId: string]: Session;
}

function formatWithoutReact(i18nString, values) {
    return i18nString.message.replaceAll(/!!\{(.+?)\}!!/g, (_, name) => {
        if (values[name] === undefined) throw new Error("A value must be provided for " + name);
        return values[name];
    });
}

export default definePlugin({
    name: "ShowSessions",
    description: "Shows active sessions on your account",
    authors: [
        {
            id: 566409342161780747n,
            name: "zv_yz",
        }
    ],
    dependencies: ["CommandsAPI"],
    commands: [
        {
            name: "sessions",
            description: "Shows active sessions on your account",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: (_, ctx) => {
                const Sessions: SessionData = SessionsStore?.getSessions();
                const currentSession: Session = SessionsStore?.getSession();

                // @ts-ignore
                sendBotMessage(ctx.channel.id, {
                    author: {
                        username: "Vencord"
                    },
                    embeds: [
                        {
                            type: "rich",
                            title: Object.keys(Sessions).length > 0
                                ? "Sessions"
                                : "No Sessions",
                            description:
                                Object.keys(Sessions).length > 0
                                    ? ""
                                    : "Have you gone offline?",
                            // @ts-ignore
                            fields: Object.values(Sessions)
                                .filter(s => s.sessionId !== "all")
                                .map((session, index) => ({
                                    name: `Session #${index + 1}`,
                                    value: [
                                        `**ID:** \`${session.sessionId}\``,
                                        `**Status:** ${STATUS[session.status]()}`,
                                        `**Device:** ${DEVICE[session.clientInfo.client]() || "❓ Unknown"}`,
                                        `**OS:** ${OS[session.clientInfo.os] || "❓ Unknown"}`,
                                        session.activities.length > 0 ? `**Activities:** ${session.activities
                                            .map(activity => {
                                                switch (activity.type) {
                                                    case 0:
                                                        return `
                                                            ${activity.name}${activity.timestamps?.start ? `, since <t:${Math.floor(activity.timestamps.start / 1000)}:R>` : ""}
                                                            ${activity.timestamps?.end ? `, ends <t:${Math.floor(activity.timestamps.end / 1000)}:R>` : ""}
                                                        `;
                                                    case 1:
                                                        return `[${formatWithoutReact(
                                                            i18n.Messages.STREAMING,
                                                            { name: activity.state }
                                                        )}](${activity.url})`;
                                                    case 2:
                                                        return `${formatWithoutReact(
                                                            i18n.Messages.LISTENING_TO,
                                                            { name: activity.state }
                                                        )}`;
                                                    case 3:
                                                        return `${formatWithoutReact(
                                                            i18n.Messages.WATCHING,
                                                            { name: activity.state }
                                                        )}`;
                                                    case 4:
                                                        return `Custom Status: ${activity.emoji?.id
                                                            ? `<${activity.emoji.animated ? "a" : ""}:${activity.emoji.name}:${activity.emoji.id}>`
                                                            : `${activity.emoji?.name ?? ""} ` || ""}
                                                            ${activity.state || ""}`;
                                                    case 5:
                                                        return `${formatWithoutReact(
                                                            i18n.Messages.COMPETING,
                                                            { name: activity.state }
                                                        )}`;
                                                }
                                            })
                                            .join("\n    ")}`
                                            : false,
                                        session.sessionId === currentSession.sessionId ? "Current Session ✅" : false
                                    ]
                                        .filter(r => r)
                                        .join("\n"),
                                    inline: true
                                }))
                        }
                    ]
                });
            }
        }
    ]
});
