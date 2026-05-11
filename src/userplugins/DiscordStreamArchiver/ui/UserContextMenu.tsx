import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu } from "@webpack/common";

import { settings } from "../settings";
import { triggerAutoRecordReevaluate } from "../stores/autoRecordControl";
import { listAdd, listContains, listRemove } from "../stores/whitelistStore";

// Mounts the "Auto-record this user's streams" toggle on the user-context
// menu so the whitelist is reachable by right-clicking a user's name/avatar
// anywhere in Discord (chat, member list, DMs). The same item also appears
// on stream-context for right-clicking a live stream preview; the
// `dsa-auto-record-user` id dedupes when both patches fire on the same menu.
export const userContextPatch: NavContextMenuPatchCallback = (children, props) => {
    const user = (props as any)?.user;
    if (!user || !user.id) return;
    if (children.some(c => (c as any)?.props?.id === "dsa-auto-record-user")) return;

    const userId = user.id;
    const enabled = listContains(settings.store.autoRecordUsers, userId);

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="dsa-auto-record-user"
            label="Auto-record when user joins"
            checked={enabled}
            action={() => {
                settings.store.autoRecordUsers = enabled
                    ? listRemove(settings.store.autoRecordUsers, userId)
                    : listAdd(settings.store.autoRecordUsers, userId);
                // Re-evaluate immediately so a toggle while the user is
                // already in the channel starts/stops the recording without
                // waiting for them to leave-and-rejoin.
                triggerAutoRecordReevaluate();
            }}
        />
    );
};
