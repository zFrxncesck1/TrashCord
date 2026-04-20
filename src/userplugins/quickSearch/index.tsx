import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { getCurrentChannel } from "@utils/discord";
import definePlugin from "@utils/types";
import { filters, findAll, findByPropsLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, PermissionsBits, PermissionStore, React, UserStore } from "@webpack/common";
import { useState } from "@webpack/common";

const EDITOR_STATE_STORE = findByPropsLazy("createEmptyEditorState");
const DECORATORS = findByPropsLazy("generateDecorators");
const EDITOR_STATE = findByPropsLazy("getFilterAutocompletions");
const QUERY_STORE = findByPropsLazy("tokenizeQuery");

interface QueryOptions {
    offset?: number;
    channel_id?: string;
    author_id?: string;
    mentions?: string[];
    max_id?: string;
    min_id?: string;
    pinned?: boolean[];
    include_nsfw?: boolean;
    content?: string;
}

function getUsername(userId: string) {
    const user = UserStore.getUser(userId);
    if (!user) return userId;
    return user.username + (user.discriminator !== "0" ? `#${user.discriminator}` : "");
}

function getChannelName(channelId: string) {
    return ChannelStore.getChannel(channelId ?? "")?.name ?? "";
}

function getQueryString(query: QueryOptions) {
    const FROM = EDITOR_STATE.default.FILTER_FROM.key;
    const IN = EDITOR_STATE.default.FILTER_IN.key;
    const MENTIONS = EDITOR_STATE.default.FILTER_MENTIONS.key;

    return (
        (!query.author_id ? "" : `${FROM} ${getUsername(query.author_id)} `) +
        (!query.channel_id ? "" : `${IN} ${getChannelName(query.channel_id)} `) +
        (!query.mentions?.length ? "" : `${MENTIONS} ${getUsername(query.mentions[0])} `) +
        (!query.content ? "" : query.content.replace(/\n/g, ""))
    );
}

function runSearch(query: QueryOptions, searchId: string) {
    const nonTokens = findAll(filters.byProps("NON_TOKEN_TYPE"));
    const NON_TOKEN_FILTER = nonTokens[nonTokens.length - 1];

    const getEmpty = () => EDITOR_STATE_STORE.createEmptyEditorState(
        DECORATORS.generateDecorators(EDITOR_STATE.default)
    );

    let editorState = getEmpty();
    editorState = EDITOR_STATE_STORE.updateContent(getQueryString(query), editorState);
    editorState = EDITOR_STATE_STORE.truncateContent(editorState, 512);

    const tokens = QUERY_STORE.tokenizeQuery(
        EDITOR_STATE_STORE.getFirstTextBlock(editorState)
    ).filter((e: any) => e.type !== NON_TOKEN_FILTER.NON_TOKEN_TYPE);

    editorState = EDITOR_STATE_STORE.applyTokensAsEntities(tokens, editorState, getEmpty());

    FluxDispatcher.dispatch({ type: "SEARCH_EDITOR_STATE_CHANGE", searchId, editorState });
    FluxDispatcher.dispatch({
        type: "SEARCH_START",
        query,
        searchId,
        queryString: getQueryString(query),
        searchEverywhere: false,
    });
}

function QuickSearchMenu({ channelId, userId, content, searchId }: {
    channelId?: string;
    userId?: string;
    content?: string;
    searchId: string;
}) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const toggle = (name: string) => setChecked(prev => ({ ...prev, [name]: !prev[name] }));

    const items = [
        { name: "channel", label: "Search within channel", present: !!channelId, queryName: "channel_id" as keyof QueryOptions, value: channelId },
        { name: "author", label: "Search from user", present: !!userId, queryName: "author_id" as keyof QueryOptions, value: userId },
        { name: "mentions", label: "Search mentioning user", present: !!userId, queryName: "mentions" as keyof QueryOptions, value: userId ? [userId] : undefined },
        { name: "content", label: "Search message content", present: !!content, queryName: "content" as keyof QueryOptions, value: content ?? "" },
    ];

    const hasSelection = items.some(f => checked[f.name]);

    return (
        <>
            {items.map(f => f.present && (
                <Menu.MenuCheckboxItem
                    key={f.name}
                    id={`quick-search-${f.name}`}
                    label={f.label}
                    checked={!!checked[f.name]}
                    action={() => toggle(f.name)}
                />
            ))}
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="quick-search-start"
                label="🔍 Search"
                disabled={!hasSelection}
                action={() => {
                    const query: QueryOptions = { include_nsfw: true };
                    for (const f of items) {
                        if (checked[f.name] && f.value !== undefined)
                            (query as any)[f.queryName] = f.value;
                    }
                    runSearch(query, searchId);
                }}
            />
        </>
    );
}

const contextMenuPath: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;
    if (props?.channel && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, props.channel)) return;

    const channelId: string | undefined = props?.message?.channel_id ?? props?.channel?.id;
    const guildId: string | undefined = props?.guild?.id ?? getCurrentChannel()?.guild_id;
    const searchId = guildId ?? channelId;
    if (!searchId) return;

    const userId: string | undefined = props?.message?.author?.id ?? props?.user?.id;
    const content: string | undefined = props?.message?.content;

    if (children.some((c: any) => c?.props?.id === "quick-search")) return;

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem id="quick-search" label="Quick Search">
            <QuickSearchMenu
                channelId={channelId}
                userId={userId}
                content={content}
                searchId={searchId}
            />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "QuickSearch",
    authors: [{ name: "x2b", id: 0n }],
    description: "Adds a context menu to quickly search within Discord",
    tags: ["Shortcuts", "Utility"],
    enabledByDefault: false,

    start() {
        addContextMenuPatch("message", contextMenuPath);
        addContextMenuPatch("channel-context", contextMenuPath);
        addContextMenuPatch("user-context", contextMenuPath);
    },

    stop() {
        removeContextMenuPatch("message", contextMenuPath);
        removeContextMenuPatch("channel-context", contextMenuPath);
        removeContextMenuPatch("user-context", contextMenuPath);
    },
});