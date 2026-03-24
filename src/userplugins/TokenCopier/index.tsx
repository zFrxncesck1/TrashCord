/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { findByProps } from "@webpack";
import { UserStore, Menu } from "@webpack/common";

function getToken(): string | null {
    try {
        // Try to get from UserStore or token store
        const UserTokenStore = findByProps("getToken");
        if (UserTokenStore?.getToken) {
            return UserTokenStore.getToken();
        }

        return null;
    } catch (error) {
        console.error("[TokenCopier] Failed to get token:", error);
        return null;
    }
}

function copyToken() {
    const token = getToken();
    
    if (!token) {
        console.error("[TokenCopier] Failed to retrieve token");
        return;
    }

    try {
        const Clipboard = findByProps("copy", "SUPPORTS_COPY");
        if (Clipboard?.copy) {
            Clipboard.copy(token);
        } else {
            navigator.clipboard?.writeText(token);
        }

        console.log("[TokenCopier] Token copied to clipboard");
        console.warn("[TokenCopier] ⚠️ WARNING: NEVER share your token with anyone! Anyone with your token has FULL access to your account.");
    } catch (error) {
        console.error("[TokenCopier] Failed to copy token:", error);
    }
}

const contextMenuPatch = (children: any, props: any) => {
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
    description: "Copy your Discord token from the context menu. ⚠️ NEVER share your token!",
    authors: [
        {
            name: "Mifu",
            id: 1309909311618814005n
        }
    ],

    start() {
        console.log("[TokenCopier] Plugin started");
        console.warn("[TokenCopier] ⚠️ WARNING: This plugin allows copying your Discord token. NEVER share your token with anyone!");
        
        addContextMenuPatch("user-settings-cog-context", contextMenuPatch);
    },

    stop() {
        console.log("[TokenCopier] Plugin stopped");
        removeContextMenuPatch("user-settings-cog-context", contextMenuPatch);
    },

    commands: [
        {
            name: "token",
            description: "Copy your Discord token (⚠️ DANGEROUS - NEVER share with anyone)",
            execute: () => {
                copyToken();
                return {
                    content: "⚠️ Token copied to clipboard. **NEVER SHARE YOUR TOKEN WITH ANYONE!** Anyone with your token can access your account completely."
                };
            }
        }
    ]
});