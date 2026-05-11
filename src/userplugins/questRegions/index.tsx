/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./styles.css?managed";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Link } from "@components/Link";
import { Paragraph } from "@components/Paragraph";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Constants, GuildStore, React, RestAPI } from "@webpack/common";

type DiscordDate = string | null | undefined;

interface RegionRestriction {
    id: string;
    regions: string[];
    is_global?: boolean;
}

interface QuestConfig {
    starts_at?: DiscordDate;
    expires_at?: DiscordDate;
}

interface QuestEntry {
    id?: string;
    config?: QuestConfig;
}

interface QuestRegionsResponse {
    quests?: RegionRestriction[];
}

type QuestListResponse = QuestEntry[];

interface QuestRegionCard {
    code: string;
    name: string;
    flagUrl: string;
    emoji: string;
    quests: RegionRestriction[];
}

interface QuestLike {
    id?: string;
    title?: string;
    config?: QuestConfig;
}

interface CommandRegion {
    code: string;
    name: string;
    emoji: string;
}

interface QuestRegionCommandEntry {
    id: string;
    regions: CommandRegion[];
}

interface UnknownQuestStore {
    quests?: unknown;
    excludedQuests?: unknown;
    getQuest?(id: string): unknown;
    isQuestExpired?(questId: string): boolean;
}

interface SupplementalEmbed {
    url?: string;
    author?: {
        name?: string;
    };
}

interface SupplementalMessage {
    id?: string;
    channel_id?: string;
    channelId?: string;
    embeds?: SupplementalEmbed[];
}

interface MessageCreatePayload {
    type: "MESSAGE_CREATE";
    channelId: string;
    guildId?: string;
    message: unknown;
}

interface MessageUpdatePayload {
    type: "MESSAGE_UPDATE";
    channelId: string;
    guildId?: string;
    message: unknown;
}

const cl = classNameFactory("vc-quest-regions-");
const QuestsStore = findByPropsLazy("getQuest") as UnknownQuestStore;

const REGION_NAMES: Record<string, string> = {
    AT: "Austria",
    AU: "Australia",
    BE: "Belgium",
    BR: "Brazil",
    CA: "Canada",
    CL: "Chile",
    CN: "China",
    DE: "Germany",
    DK: "Denmark",
    EC: "Ecuador",
    ES: "Spain",
    FI: "Finland",
    FR: "France",
    GB: "United Kingdom",
    HK: "Hong Kong",
    IE: "Ireland",
    IN: "India",
    IT: "Italy",
    JP: "Japan",
    KR: "South Korea",
    MY: "Malaysia",
    MX: "Mexico",
    NL: "Netherlands",
    NO: "Norway",
    NZ: "New Zealand",
    PE: "Peru",
    PH: "Philippines",
    PL: "Poland",
    SE: "Sweden",
    SG: "Singapore",
    TH: "Thailand",
    UK: "United Kingdom",
    US: "United States",
    VN: "Vietnam",
};

const REGION_FLAG_CODES: Record<string, string> = {
    UK: "gb",
    GB: "gb",
};

const QUEST_DATA_GUILD_ID = "1317512377876480060";
const QUEST_DATA_CHANNEL_ID = "1454122889820241994";
const QUEST_DATA_INVITE_URL = "https://discord.gg/Fmdj3kFXWS";
const DISCORD_QUEST_URL_RE = /^https:\/\/discord\.com\/quests\/(\d{17,20})$/;
const SUPPLEMENTAL_FETCH_PAGES = 5;
const SUPPLEMENTAL_MESSAGES_PER_PAGE = 100;
const SUPPLEMENTAL_GLOBAL_REGION_NAMES = new Set(["global", "global 🌏"]);
const SUPPLEMENTAL_REGION_NAME_ALIASES: Record<string, string> = {
    "Hong Kong SAR China": "HK",
    "South Korea": "KR",
    "United Kingdom": "UK",
};
const QUEST_REGION_OVERRIDES: Record<string, string[]> = {
    "1499245042534060192": ["UK"],
};

const regionDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const QUEST_RESTRICTIONS_URL = new URL("https://gist.githubusercontent.com/xGustavvo/3d08b7369eb34b50834815fd43176cae/raw");
const QUEST_LIST_URL = new URL("https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/refs/heads/main/quests.json");
const REGION_CODES_BY_NAME = new Map(
    Object.entries(REGION_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);
const supplementalQuestRegions = new Map<string, Map<string, CommandRegion>>();

let regionCache: { at: number; data: QuestRegionCard[] } | null = null;
let regionPromise: Promise<QuestRegionCard[]> | null = null;
let activeQuestIds = new Set<string>();
let publicQuestRegions = new Map<string, Set<string>>();
let publicRegionQuestIds = new Map<string, Set<string>>();

const linkEmbedOption = {
    name: "embed_links",
    description: "Whether quest links should embed",
    type: ApplicationCommandOptionType.BOOLEAN,
    required: false,
};

function parseDiscordDate(value: DiscordDate): Date | null {
    if (!value) return null;
    const parsed = new Date(value.replace("Z", "+00:00"));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getFlagUrl(region: string): string {
    const code = REGION_FLAG_CODES[region] ?? region.toLowerCase();
    return `https://hatscripts.github.io/circle-flags/flags/${code}.svg`;
}

function getRegionName(region: string): string {
    return REGION_NAMES[region] ?? regionDisplayNames.of(region) ?? region;
}

function getRegionEmoji(region: string): string {
    const code = REGION_FLAG_CODES[region] ?? region.toLowerCase();
    return `:flag_${code}:`;
}

function normalizeRegion(region: string): string {
    return region.trim().toUpperCase();
}

function getAuthoritativeRegions(questId: string, regions: string[]): string[] {
    return (QUEST_REGION_OVERRIDES[questId] ?? regions).map(normalizeRegion);
}

function getRegionFromName(name: string): CommandRegion | null {
    const trimmedName = name.trim();
    if (SUPPLEMENTAL_GLOBAL_REGION_NAMES.has(trimmedName.toLowerCase())) return null;

    const code = SUPPLEMENTAL_REGION_NAME_ALIASES[trimmedName] ?? REGION_CODES_BY_NAME.get(trimmedName.toLowerCase()) ?? normalizeRegion(trimmedName);

    return {
        code,
        name: getRegionName(code),
        emoji: getRegionEmoji(code),
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getStringProperty(value: unknown, ...keys: string[]): string | null {
    if (!isObject(value)) return null;
    for (const key of keys) {
        const property = value[key];
        if (typeof property === "string") return property;
    }
    return null;
}

function getObjectProperty(value: unknown, ...keys: string[]): Record<string, unknown> | null {
    if (!isObject(value)) return null;
    for (const key of keys) {
        const property = value[key];
        if (isObject(property)) return property;
    }
    return null;
}

function isSupplementalEmbed(value: unknown): value is SupplementalEmbed {
    if (!isObject(value)) return false;

    const { author } = value;
    return (
        (typeof value.url === "undefined" || typeof value.url === "string") &&
        (typeof author === "undefined" || (isObject(author) && (typeof author.name === "undefined" || typeof author.name === "string")))
    );
}

function isSupplementalMessage(value: unknown): value is SupplementalMessage {
    if (!isObject(value)) return false;
    const { embeds } = value;

    return (
        (typeof value.id === "undefined" || typeof value.id === "string") &&
        (typeof value.channel_id === "undefined" || typeof value.channel_id === "string") &&
        (typeof value.channelId === "undefined" || typeof value.channelId === "string") &&
        (typeof embeds === "undefined" || (Array.isArray(embeds) && embeds.every(isSupplementalEmbed)))
    );
}

function cacheSupplementalMessage(message: unknown) {
    if (!isSupplementalMessage(message)) return;
    const channelId = message.channel_id ?? message.channelId;
    if (channelId !== QUEST_DATA_CHANNEL_ID) return;

    for (const embed of message.embeds ?? []) {
        if (!embed.url || !embed.author?.name) continue;

        const match = DISCORD_QUEST_URL_RE.exec(embed.url);
        if (!match) continue;

        const questId = match[1];
        const region = getRegionFromName(embed.author.name);
        if (!region) continue;

        const regions = supplementalQuestRegions.get(questId) ?? new Map<string, CommandRegion>();
        regions.set(region.code, region);
        supplementalQuestRegions.set(questId, regions);
    }
}

function canFetchSupplementalQuestData() {
    return Boolean(GuildStore.getGuild(QUEST_DATA_GUILD_ID));
}

async function fetchSupplementalQuestMessages() {
    if (!canFetchSupplementalQuestData()) return;

    let before: string | undefined;

    for (let page = 0; page < SUPPLEMENTAL_FETCH_PAGES; page++) {
        const { body }: { body: unknown; } = await RestAPI.get({
            url: Constants.Endpoints.MESSAGES(QUEST_DATA_CHANNEL_ID),
            query: {
                limit: SUPPLEMENTAL_MESSAGES_PER_PAGE,
                ...(before ? { before } : {}),
            },
            retries: 2,
        });

        if (!Array.isArray(body) || body.length === 0) return;

        let lastMessageId: string | undefined;
        for (const message of body) {
            cacheSupplementalMessage(message);
            if (isSupplementalMessage(message)) {
                lastMessageId = message.id;
            }
        }

        if (!lastMessageId || body.length < SUPPLEMENTAL_MESSAGES_PER_PAGE) return;
        before = lastMessageId;
    }
}

async function fetchJson<T>(url: URL, signal: AbortSignal): Promise<T> {
    const res = await fetch(url, { signal });
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url.toString()}: ${res.status} ${res.statusText}`);
    }
    return await res.json() as T;
}

function getQuestId(quest: unknown): string | null {
    return getStringProperty(quest, "id");
}

function getQuestConfig(quest: unknown): Record<string, unknown> | null {
    return getObjectProperty(quest, "config");
}

function getQuestUserStatus(quest: unknown): Record<string, unknown> | null {
    return getObjectProperty(quest, "userStatus", "user_status");
}

function getQuestName(quest: unknown): string {
    const config = getQuestConfig(quest);
    const messages = getObjectProperty(config, "messages");
    return getStringProperty(messages, "questName", "quest_name") ?? "Unknown Quest";
}

function getQuestExpiresAt(quest: unknown): Date | null {
    return parseDiscordDate(getStringProperty(getQuestConfig(quest), "expiresAt", "expires_at"));
}

function isQuestUnclaimed(quest: unknown): boolean {
    const id = getQuestId(quest);
    if (!id) return false;

    const userStatus = getQuestUserStatus(quest);
    if (getStringProperty(userStatus, "claimedAt", "claimed_at")) return false;

    const expiresAt = getQuestExpiresAt(quest);
    return !expiresAt || expiresAt > new Date();
}

function isQuestAvailableForCommand(questId: string): boolean {
    const quest = QuestsStore.getQuest?.(questId);
    if (activeQuestIds.size > 0 && !activeQuestIds.has(questId) && !quest) return false;
    if (QuestsStore.isQuestExpired?.(questId)) return false;
    if (quest) {
        const expiresAt = getQuestExpiresAt(quest);
        if (expiresAt && expiresAt <= new Date()) return false;
    }

    return true;
}

function isSupplementalRegionAuthoritative(questId: string, region: CommandRegion): boolean {
    const questRegions = publicQuestRegions.get(questId);
    if (questRegions && !questRegions.has(region.code)) return false;

    const regionQuestIds = publicRegionQuestIds.get(region.code);
    if (regionQuestIds && !regionQuestIds.has(questId)) return false;

    return true;
}

function getStoredQuests(): unknown[] {
    const { quests } = QuestsStore;
    if (quests instanceof Map) return Array.from(quests.values());
    if (Array.isArray(quests)) return quests;
    if (isObject(quests)) return Object.values(quests);
    return [];
}

function getQuestsFromResponseBody(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    if (!isObject(body)) return [];

    const { quests } = body;
    if (Array.isArray(quests)) return quests;
    if (isObject(quests)) return Object.values(quests);

    return [];
}

async function fetchUserQuests(): Promise<unknown[]> {
    const { body }: { body: unknown; } = await RestAPI.get({ url: "/quests/@me", retries: 3 });
    return getQuestsFromResponseBody(body);
}

async function getUnclaimedQuests(): Promise<unknown[]> {
    const fetchedQuests = await fetchUserQuests().catch(() => []);
    const quests = fetchedQuests.length ? fetchedQuests : getStoredQuests();

    return quests
        .filter(isQuestUnclaimed)
        .sort((a, b) => {
            const expiresA = getQuestExpiresAt(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const expiresB = getQuestExpiresAt(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return expiresA - expiresB || getQuestName(a).localeCompare(getQuestName(b));
        });
}

function formatUnclaimedQuestsCommand(quests: unknown[]): string {
    if (quests.length === 0) return "No unclaimed active quests were found.";

    return quests.map(quest => {
        const id = getQuestId(quest);
        const completed = Boolean(getStringProperty(getQuestUserStatus(quest), "completedAt", "completed_at"));
        const label = completed ? "completed, unclaimed" : "unclaimed";
        return `- ${getQuestName(quest)} (${label}): https://discord.com/quests/${id}`;
    }).join("\n");
}

function formatQuestLink(questId: string, embedLinks: boolean) {
    const url = `https://discord.com/quests/${questId}`;
    return embedLinks ? url : `<${url}>`;
}

function splitMessageContent(content: string): string[] {
    const chunks: string[] = [];
    let current = "";

    for (const line of content.split("\n")) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length <= 1900) {
            current = next;
            continue;
        }

        if (current) chunks.push(current);
        current = line;
    }

    if (current) chunks.push(current);
    return chunks;
}

function sendBotMessageChunks(channelId: string, content: string) {
    for (const chunk of splitMessageContent(content)) {
        sendBotMessage(channelId, { content: chunk });
    }
}

async function sendUserMessageChunks(channelId: string, content: string) {
    for (const chunk of splitMessageContent(content)) {
        await sendMessage(channelId, { content: chunk });
    }
}

async function loadQuestRegions(signal: AbortSignal): Promise<QuestRegionCard[]> {
    const [restrictionData, questsData] = await Promise.all([
        fetchJson<QuestRegionsResponse>(QUEST_RESTRICTIONS_URL, signal),
        fetchJson<QuestListResponse>(QUEST_LIST_URL, signal),
    ]);

    if (!Array.isArray(restrictionData.quests) || !Array.isArray(questsData)) {
        return [];
    }

    const now = new Date();
    const questMap = new Map(
        questsData
            .filter((quest): quest is QuestEntry & { id: string; } => typeof quest.id === "string")
            .map(quest => [quest.id, quest]),
    );

    const activeRestrictions = restrictionData.quests.filter(restriction => {
        if (restriction.is_global) return false;
        if (!Array.isArray(restriction.regions) || restriction.regions.length === 0) return false;

        const quest = questMap.get(restriction.id);
        if (!quest?.config) return false;

        const startsAt = parseDiscordDate(quest.config.starts_at);
        const expiresAt = parseDiscordDate(quest.config.expires_at);

        if (startsAt && now < startsAt) return false;
        if (expiresAt && now > expiresAt) return false;

        return true;
    });

    activeQuestIds = new Set(activeRestrictions.map(restriction => restriction.id));
    publicQuestRegions = new Map();
    publicRegionQuestIds = new Map();

    const byRegion = new Map<string, RegionRestriction[]>();

    for (const restriction of activeRestrictions) {
        const authoritativeRegions = getAuthoritativeRegions(restriction.id, restriction.regions);
        publicQuestRegions.set(restriction.id, new Set(authoritativeRegions));

        for (const key of authoritativeRegions) {
            const questIds = publicRegionQuestIds.get(key) ?? new Set<string>();
            questIds.add(restriction.id);
            publicRegionQuestIds.set(key, questIds);

            const list = byRegion.get(key) ?? [];
            list.push(restriction);
            byRegion.set(key, list);
        }
    }

    return Array.from(byRegion.entries())
        .map(([code, quests]) => ({
            code,
            name: getRegionName(code),
            flagUrl: getFlagUrl(code),
            emoji: getRegionEmoji(code),
            quests,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function getQuestRegions(force = false): Promise<QuestRegionCard[]> {
    const now = Date.now();
    if (!force && regionCache && now - regionCache.at < 5 * 60 * 1000) {
        return regionCache.data;
    }

    if (!regionPromise) {
        const controller = new AbortController();
        regionPromise = loadQuestRegions(controller.signal)
            .then(data => {
                regionCache = { at: Date.now(), data };
                return data;
            })
            .finally(() => {
                regionPromise = null;
            });
    }

    return await regionPromise;
}

function getQuestRegionCommandEntries(regions: QuestRegionCard[]): QuestRegionCommandEntry[] {
    const byQuest = new Map<string, QuestRegionCommandEntry>();

    for (const region of regions) {
        for (const quest of region.quests) {
            if (!isQuestAvailableForCommand(quest.id)) continue;

            const entry = byQuest.get(quest.id) ?? { id: quest.id, regions: [] };
            if (!entry.regions.some(existingRegion => existingRegion.code === region.code)) {
                entry.regions.push(region);
            }
            byQuest.set(quest.id, entry);
        }
    }

    for (const [questId, supplementalRegions] of supplementalQuestRegions) {
        if (!isQuestAvailableForCommand(questId)) continue;

        const entry = byQuest.get(questId) ?? { id: questId, regions: [] };
        for (const region of supplementalRegions.values()) {
            if (!isSupplementalRegionAuthoritative(questId, region)) continue;

            if (!entry.regions.some(existingRegion => existingRegion.code === region.code)) {
                entry.regions.push(region);
            }
        }
        if (entry.regions.length === 0) continue;
        byQuest.set(questId, entry);
    }

    return Array.from(byQuest.values())
        .map(entry => ({
            ...entry,
            regions: entry.regions.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => {
            const firstRegionCompare = (a.regions[0]?.name ?? "").localeCompare(b.regions[0]?.name ?? "");
            return firstRegionCompare || a.id.localeCompare(b.id);
        });
}

async function formatQuestRegionsCommand(regions: QuestRegionCard[], embedLinks = true): Promise<string> {
    await fetchSupplementalQuestMessages().catch(() => null);

    const entries = getQuestRegionCommandEntries(regions);
    if (entries.length === 0) return "No active region-restricted quests were found.";

    const list = entries.map(entry => {
        const regionText = entry.regions.map(region => `${region.emoji} ${region.name}`).join(", ");
        return `- ${regionText}: ${formatQuestLink(entry.id, embedLinks)}`;
    }).join("\n");

    return list;
}

function QuestRegionBadge({ name, flagUrl }: { name: string; flagUrl: string; }) {
    return (
        <div className={cl("badge")}>
            <img className={cl("badge-flag")} src={flagUrl} alt={name} />
            <span className={cl("badge-name")}>{name}</span>
        </div>
    );
}

function QuestRegionInfo({ quest }: { quest: QuestLike; }) {
    const [regions, setRegions] = React.useState<QuestRegionCard[] | null>(null);

    React.useEffect(() => {
        let alive = true;

        void getQuestRegions().then(data => {
            if (!alive) return;
            setRegions(data.filter(entry => entry.quests.some(q => q.id === quest.id)));
        });

        return () => {
            alive = false;
        };
    }, [quest.id]);

    if (!regions?.length) return null;

    return (
        <div className={cl("quest-region")}>
            {regions.map(region => (
                <QuestRegionBadge key={region.code} name={region.name} flagUrl={region.flagUrl} />
            ))}
        </div>
    );
}

const QuestRegionsAbout = () => (
    <Paragraph>
        Join <Link href={QUEST_DATA_INVITE_URL}>{QUEST_DATA_INVITE_URL}</Link> for access to more recent region quest data.
    </Paragraph>
);

export default definePlugin({
    name: "QuestRegions",
    description: "Show active region-restricted Quests on the Quest page and copy their links.",
    authors: [EquicordDevs.omaw, EquicordDevs.justjxke],
    tags: ["Quests", "Utility"],
    managedStyle,
    commands: [
        {
            name: "quest-regions",
            description: "Copy the active region-restricted Quest list",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [linkEmbedOption],
            execute: async (_, ctx) => {
                try {
                    const embedLinks = findOption(_, "embed_links", true);
                    const regions = await getQuestRegions(true);
                    const text = await formatQuestRegionsCommand(regions, embedLinks);
                    sendBotMessageChunks(ctx.channel.id, text);
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Failed to load active region-restricted quests." });
                }
            },
        },
        {
            name: "unclaimed-quests",
            description: "Show unclaimed active quests from the Quest page",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_, ctx) => {
                try {
                    const quests = await getUnclaimedQuests();
                    sendBotMessageChunks(ctx.channel.id, formatUnclaimedQuestsCommand(quests));
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Failed to load unclaimed quests." });
                }
            },
        },
        {
            name: "send-regions",
            description: "Send the active region-restricted Quest list as your message",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [linkEmbedOption],
            execute: async (_, ctx) => {
                try {
                    const embedLinks = findOption(_, "embed_links", true);
                    const regions = await getQuestRegions(true);
                    const text = await formatQuestRegionsCommand(regions, embedLinks);
                    await sendUserMessageChunks(ctx.channel.id, text);
                } catch {
                    sendBotMessage(ctx.channel.id, { content: "Failed to send active region-restricted quests." });
                }
            },
        },
    ],
    settingsAboutComponent: QuestRegionsAbout,
    flux: {
        MESSAGE_CREATE({ message, channelId, guildId }: MessageCreatePayload) {
            if (guildId !== QUEST_DATA_GUILD_ID || channelId !== QUEST_DATA_CHANNEL_ID) return;
            cacheSupplementalMessage(message);
        },
        MESSAGE_UPDATE({ message, channelId, guildId }: MessageUpdatePayload) {
            if (guildId !== QUEST_DATA_GUILD_ID || channelId !== QUEST_DATA_CHANNEL_ID) return;
            cacheSupplementalMessage(message);
        },
    },
    patches: [
        {
            find: /questContentPosition:\i,trackGuildAndChannelMetadata:\i===\i\.\i\.QUESTS_EMBED,sourceQuestContent:\i,children:\i=>/,
            replacement: {
                match: /(children:\[)(\(0,(\i)\.jsx\)\(\i,\{quest:(\i),location:\i,isInteracting:\i,sourceQuestContent:\i\}\),)/,
                replace: "$1(0,$3.jsx)($self.QuestRegionInfo,{quest:$4}),$2",
            },
        },
        {
            find: /id:`quest-tile-\${\i\.id}`/,
            replacement: {
                match: /(onBlur:\i,children:\[)(?=\(0,(\i)\.jsx\))/,
                replace: "$1(0,$2.jsx)($self.QuestRegionInfo,{quest:arguments[0].quest}),",
            },
        },
    ],
    QuestRegionInfo,
});