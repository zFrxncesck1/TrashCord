import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu } from "@webpack/common";

import { settings } from "../settings";
import { triggerAutoRecordReevaluate } from "../stores/autoRecordControl";
import { sessionStore } from "../stores/sessionStore";
import { listAdd, listContains, listRemove } from "../stores/whitelistStore";

export interface StreamMenuHooks {
    startForStream: (streamKey: string, channelId: string) => void;
}

let hooks: StreamMenuHooks | null = null;
export function registerStreamMenuHooks(h: StreamMenuHooks) {
    hooks = h;
}

export const streamContextPatch: NavContextMenuPatchCallback = (children, props) => {
    const p = props as any;
    const streamKey: string | undefined = p?.streamKey;
    const user = p?.user;
    const channelId: string | undefined = p?.channelId ?? (streamKey ? streamKey.split(":")[1] : undefined);
    if (!streamKey || !user) return;

    if (children.some(c => (c as any)?.props?.id === "dsa-auto-record-user")) return;

    const userId = user.id;
    const userEnabled = listContains(settings.store.autoRecordUsers, userId);
    const sessionActive = sessionStore.get().state === "recording";

    const items: any[] = [
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="dsa-auto-record-user"
            label="Auto-record this user's streams"
            checked={userEnabled}
            action={() => {
                settings.store.autoRecordUsers = userEnabled
                    ? listRemove(settings.store.autoRecordUsers, userId)
                    : listAdd(settings.store.autoRecordUsers, userId);
                triggerAutoRecordReevaluate();
            }}
        />
    ];

    if (!sessionActive && hooks && channelId) {
        items.push(
            <Menu.MenuItem
                id="dsa-record-this-stream"
                label="Record this stream"
                action={() => hooks!.startForStream(streamKey, channelId)}
            />
        );
    }
    children.push(...items);
};
