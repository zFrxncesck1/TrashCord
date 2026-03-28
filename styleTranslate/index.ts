/*
 * Vencord, a Discord client mod
 * StyleTranslate - Translate messages into fun styles via AnythingTranslate or Claude
 * Copyright (c) 2026 Nyarc
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";

// ── Native bridge ──────────────────────────────────────────────
const Native = VencordNative.pluginHelpers.StyleTranslate as {
    translateWithClaude(style: string, text: string): Promise<string>;
    translateWithAnythingTranslate(style: string, text: string): Promise<string>;
};

// ── All styles (superset — AT has more, Claude covers all with prompts) ────
// Order: most fun first
const ALL_STYLES: { name: string; displayName: string }[] = [
    // ── Standard ─────────────────────────────────────────────
    { name: "pirate",              displayName: "Pirate" },
    { name: "shakespeare",         displayName: "Shakespeare" },
    { name: "yoda",                displayName: "Yoda" },
    { name: "gollum",              displayName: "Gollum" },
    { name: "uwu",                 displayName: "UwU" },
    { name: "caveman",             displayName: "Caveman" },
    { name: "medieval",            displayName: "Medieval English" },
    { name: "old-english",         displayName: "Old English" },
    { name: "formal",              displayName: "Formal English" },
    { name: "gen-z",               displayName: "Gen Z" },
    { name: "valley-girl",         displayName: "Valley Girl" },
    // ── Verbose ──────────────────────────────────────────────
    { name: "verbose-posh",        displayName: "Verbose: Posh" },
    { name: "verbose-shakespeare", displayName: "Verbose: Shakespeare" },
    { name: "verbose-medieval",    displayName: "Verbose: Medieval" },
    { name: "verbose-english",     displayName: "Verbose: English" },
    { name: "verbose-fancy",       displayName: "Verbose: Fancy English" },
    { name: "verbose-mega",        displayName: "Verbose: MEGA" },
    { name: "verbose-5yo",         displayName: "Verbose: 5 Year Old" },
    { name: "verbose-stupendous",  displayName: "Verbose: Stupendously" },
];

// ── Claude prompts for every style ────────────────────────────
const CLAUDE_PROMPTS: Record<string, string> = {
    shakespeare:
        "Rewrite the following text in elaborate Shakespearean / Early Modern English. " +
        "Use thee/thou/thy, archaic verb forms (-eth, -est), and flowery metaphors. " +
        "Keep the original meaning. Output ONLY the translated text, nothing else.",
    pirate:
        "Rewrite the following text as a stereotypical pirate would say it. " +
        "Use 'arr', 'ye', 'matey', nautical terms. " +
        "Output ONLY the translated text, nothing else.",
    yoda:
        "Rewrite the following text in the speech pattern of Yoda from Star Wars. " +
        "Invert sentence structure. Output ONLY the translated text, nothing else.",
    gollum:
        "Rewrite the following text as Gollum from Lord of the Rings would say it. " +
        "Use 'we', 'precious', 'gollum gollum', hissing speech. " +
        "Output ONLY the translated text, nothing else.",
    uwu:
        "Rewrite the following text in 'uwu' internet speak. " +
        "Replace r/l with w, add stuttering, add emoticons like OwO UwU >w<. " +
        "Output ONLY the translated text, nothing else.",
    caveman:
        "Rewrite the following text as a caveman. Short words, broken grammar, 'me', 'ug', 'fire good'. " +
        "Output ONLY the translated text, nothing else.",
    medieval:
        "Rewrite the following text in medieval style, as if spoken by a knight or noble. " +
        "Use 'prithee', 'forsooth', 'hark'. Output ONLY the translated text, nothing else.",
    "old-english":
        "Rewrite the following text in Old English (Anglo-Saxon style). " +
        "Use archaic vocabulary. Output ONLY the translated text, nothing else.",
    formal:
        "Rewrite the following text in extremely formal, diplomatic English. " +
        "Output ONLY the translated text, nothing else.",
    "gen-z":
        "Rewrite the following text in Gen Z slang. Use 'no cap', 'bussin', 'slay', 'lowkey', 'fr fr', 'it's giving'. " +
        "Output ONLY the translated text, nothing else.",
    "valley-girl":
        "Rewrite the following text as a classic Valley Girl would say it. " +
        "Use 'like', 'oh my god', 'totally', 'whatever', 'as if'. " +
        "Output ONLY the translated text, nothing else.",
    // ── Verbose styles ───────────────────────────────────────
    "verbose-posh":
        "Rewrite the following text in an overly verbose, extravagantly posh British English style. " +
        "Use unnecessarily long words, excessive politeness, and elaborate circumlocutions. " +
        "Make it absurdly long-winded. Output ONLY the translated text, nothing else.",
    "verbose-shakespeare":
        "Rewrite the following text in an extremely verbose, old-school Shakespearean style. " +
        "Use thee/thou/thy, archaic verb forms, long flowery soliloquies, and excessive metaphors. " +
        "Make it dramatically over-the-top long. Output ONLY the translated text, nothing else.",
    "verbose-medieval":
        "Rewrite the following text in a verbose medieval style with excessive formal address, " +
        "lengthy proclamations, and over-elaborate knightly language. " +
        "Output ONLY the translated text, nothing else.",
    "verbose-english":
        "Rewrite the following text in an overly verbose English style. " +
        "Use far more words than necessary, add excessive qualifiers, tangents, and unnecessary elaboration. " +
        "Output ONLY the translated text, nothing else.",
    "verbose-fancy":
        "Rewrite the following text in an excessively fancy, verbose English style. " +
        "Use the most elaborate vocabulary possible, lengthy sentences, and superfluous detail. " +
        "Output ONLY the translated text, nothing else.",
    "verbose-mega":
        "Rewrite the following text in the most extremely, absurdly, hyper-mega-ultra-verbose way imaginable. " +
        "Use every possible synonym, add excessive explanations, tangents, and make it as long as humanly possible. " +
        "Output ONLY the translated text, nothing else.",
    "verbose-5yo":
        "Rewrite the following text as an extremely verbose 5-year-old would say it — " +
        "rambling, going off on tangents, repeating things, adding 'and then', 'and also', 'because'. " +
        "Output ONLY the translated text, nothing else.",
    "verbose-stupendous":
        "Rewrite the following text in a stupendously, breathtakingly verbose manner. " +
        "Every simple concept must be explained at extraordinary length with grandiose vocabulary. " +
        "Output ONLY the translated text, nothing else.",
};

// ── Settings ───────────────────────────────────────────────────
const settings = definePluginSettings({
    backend: {
        type: OptionType.SELECT,
        description: "Translation backend",
        options: [
            { label: "AnythingTranslate (free, no setup required)", value: "anythingtranslate", default: true },
            { label: "Local Claude Code (requires Claude Code installed)", value: "claude" },
        ],
    },
    sendAsMessage: {
        type: OptionType.BOOLEAN,
        description: "Send translation as a real message visible to others (off = only you see it)",
        default: true,
    },
});

// ── Plugin ─────────────────────────────────────────────────────
export default definePlugin({
    name: "StyleTranslate",
    description: "Translate messages into fun styles via AnythingTranslate (free) or local Claude Code. Switch backend in plugin settings.",
    authors: [{ name: "Nyarc", id: 0n }],
    dependencies: ["CommandsAPI"],
    settings,

    commands: [
        {
            name: "translate",
            description: "Translate text into a fun style (switch backend in plugin settings)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "style",
                    description: "Translation style",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                    choices: ALL_STYLES.map(s => ({ name: s.name, displayName: s.displayName, value: s.name })),
                },
                {
                    name: "text",
                    description: "The text to translate",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],

            async execute(args, ctx) {
                const style = findOption<string>(args, "style", "pirate");
                const text = findOption<string>(args, "text", "");

                if (!text) return sendBotMessage(ctx.channel.id, { content: "Please provide text to translate." });

                const backend = settings.store.backend ?? "anythingtranslate";
                sendBotMessage(ctx.channel.id, { content: `🔄 Translating to **${style}** via ${backend === "claude" ? "Claude" : "AnythingTranslate"}...` });

                try {
                    let result: string;
                    if (backend === "claude") {
                        const prompt = CLAUDE_PROMPTS[style] ?? `Rewrite the following text in ${style} style. Output ONLY the translated text.`;
                        result = await Native.translateWithClaude(prompt, text);
                    } else {
                        result = await Native.translateWithAnythingTranslate(style, text);
                    }

                    const cleaned = result.trim();
                    if (settings.store.sendAsMessage) {
                        sendMessage(ctx.channel.id, { content: cleaned });
                    } else {
                        sendBotMessage(ctx.channel.id, { content: `🎭 **${style.toUpperCase()}**:\n${cleaned}` });
                    }
                } catch (e: any) {
                    sendBotMessage(ctx.channel.id, {
                        content: `❌ Translation failed: ${e?.message ?? "Unknown error"}` +
                            (backend === "claude" ? "\n\nMake sure Claude Code is installed and accessible via the `claude` command." : ""),
                    });
                }
            },
        },
    ],
});
