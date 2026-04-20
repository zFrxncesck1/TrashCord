/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import definePlugin from "@utils/types";
import { findByProps } from "@webpack";
import { Menu } from "@webpack/common";

function getToken(): string | null {
    try {
        const TokenStore = findByProps("getToken");
        return TokenStore?.getToken?.() ?? null;
    } catch {
        return null;
    }
}

function copyToken() {
    const token = getToken();
    if (!token) return;
    try {
        const Clipboard = findByProps("copy", "SUPPORTS_COPY");
        Clipboard?.copy ? Clipboard.copy(token) : navigator.clipboard?.writeText(token);
    } catch { }
}

const contextMenuPatch = (children: any) => {
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            label="⚠️ Copy Token (DANGEROUS)"
            id="copy-token"
            action={copyToken}
            color="danger"
        />
    );
};

export default definePlugin({
    name: "TokenCopier",
    description: "Copy your Discord token via /token or context menu. ⚠️ NEVER share your token!",
    authors: [{ name: "Mifu", id: 1309909311618814005n }, { name: "zFrxncesck1", id: 456195985404592149n }],
    tags: ["Privacy", "Utility", "Commands"],
    enabledByDefault: false,

    commands: [
        {
            name: "token",
            description: "Copy your Discord token to clipboard",
            inputType: ApplicationCommandInputType.BUILT_IN,
            predicate: () => true,
            execute: (_, ctx) => {
                copyToken();
                sendBotMessage(ctx.channel.id, {
                    content: "⚠️ **Token copied to clipboard.**\n> **NEVER share your token with anyone!**\n> Anyone with your token has **full access** to your account."
                });
            }
        }
    ],

    start() {
        addContextMenuPatch("user-settings-cog-context", contextMenuPatch);
    },

    stop() {
        removeContextMenuPatch("user-settings-cog-context", contextMenuPatch);
    }
});