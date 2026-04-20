import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const searchEngineChoices = [
    { name: "Google", value: "https://google.com/search?q=", label: "Google" },
    { name: "Bing", value: "https://bing.com/search?q=", label: "Bing" },
    { name: "DuckDuckGo", value: "https://duckduckgo.com/?q=", label: "DuckDuckGo" },
    { name: "searX", value: "https://searx.thegpm.org/?q=", label: "searX" },
    { name: "StartPage", value: "https://startpage.com/search?q=", label: "StartPage" },
    { name: "Yandex", value: "https://yandex.com/search/?q=", label: "Yandex" },
    { name: "Custom", value: "custom", label: "Custom" },
];

const settings = definePluginSettings({
    customSearchEngine: {
        type: OptionType.STRING,
        description: "Full base URL for custom search engine (must support ?q= parameter)",
        default: "https://google.com/search?q=",
        restartNeeded: false,
    },
});

export default definePlugin({
    name: "Search",
    authors: [{ name: "x2b", id: 0n }],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    settings,
    description: "Generates search links for various search engines.",
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "search",
        description: "Generates a search link for the selected engine.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                type: ApplicationCommandOptionType.STRING,
                name: "engine",
                description: "Which search engine do you want to use?",
                required: true,
                choices: searchEngineChoices,
            },
            {
                type: ApplicationCommandOptionType.STRING,
                name: "query",
                description: "What do you want to search?",
                required: true,
            },
        ],
        execute(args, ctx) {
            const engine = args[0].value as string;
            const query = encodeURIComponent(args[1].value as string);
            const base = engine === "custom" ? settings.store.customSearchEngine : engine;
            sendBotMessage(ctx.channel.id, { content: `${base}${query}` });
        },
    }],
});