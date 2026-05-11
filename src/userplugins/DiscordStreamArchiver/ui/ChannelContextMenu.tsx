import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu } from "@webpack/common";

import { settings } from "../settings";
import { triggerAutoRecordReevaluate } from "../stores/autoRecordControl";
import { listAdd, listContains, listRemove } from "../stores/whitelistStore";

export const channelContextPatch: NavContextMenuPatchCallback = (children, props) => {
    const channel = (props as any)?.channel;
    if (!channel || channel.type !== 2 /* GUILD_VOICE */) return;

    if (children.some(c => (c as any)?.props?.id === "dsa-auto-record-channel")) return;

    const channelId = channel.id;
    const enabled = listContains(settings.store.autoRecordChannels, channelId);

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="dsa-auto-record-channel"
            label="Auto-record on join"
            checked={enabled}
            action={() => {
                settings.store.autoRecordChannels = enabled
                    ? listRemove(settings.store.autoRecordChannels, channelId)
                    : listAdd(settings.store.autoRecordChannels, channelId);
                triggerAutoRecordReevaluate();
            }}
        />
    );
};
