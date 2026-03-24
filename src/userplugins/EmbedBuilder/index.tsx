/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { findByProps } from "@webpack";

const settings = definePluginSettings({
    defaultColor: {
        type: OptionType.STRING,
        description: "Default embed color (hex format, e.g., #5865F2)",
        default: "#5865F2"
    },
    autoCopy: {
        type: OptionType.BOOLEAN,
        description: "Automatically copy JSON to clipboard",
        default: true
    }
});

function hexToDecimal(hex: string): number {
    return parseInt(hex.replace("#", ""), 16);
}

function copyToClipboard(text: string) {
    try {
        const Clipboard = findByProps("copy", "SUPPORTS_COPY");
        if (Clipboard?.copy) {
            Clipboard.copy(text);
        } else {
            // Fallback
            navigator.clipboard?.writeText(text);
        }
    } catch (e) {
        console.error("[EmbedBuilder] Failed to copy to clipboard:", e);
    }
}

export default definePlugin({
    name: "EmbedBuilder",
    description: "Generate embed JSON quickly for use with webhooks or bots",
    authors: [
        {
            name: "Mifu",
            id: 1309909311618814005n
        }
    ],

    settings,

    commands: [
        {
            name: "embedbuild",
            description: "Generate embed JSON",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "title",
                    description: "Embed title",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "description",
                    description: "Embed description",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "color",
                    description: "Embed color (hex format, e.g., #FF0000)",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                },
                {
                    name: "image",
                    description: "Image URL",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                },
                {
                    name: "thumbnail",
                    description: "Thumbnail URL",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                },
                {
                    name: "footer",
                    description: "Footer text",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                const title = findOption(args, "title", "");
                const description = findOption(args, "description", "");
                const colorHex = findOption(args, "color", settings.store.defaultColor);
                const image = findOption(args, "image", "");
                const thumbnail = findOption(args, "thumbnail", "");
                const footer = findOption(args, "footer", "");

                const embed: any = {
                    title,
                    description,
                    color: hexToDecimal(colorHex),
                    timestamp: new Date().toISOString()
                };

                if (image) {
                    embed.image = { url: image };
                }

                if (thumbnail) {
                    embed.thumbnail = { url: thumbnail };
                }

                if (footer) {
                    embed.footer = { text: footer };
                }

                const payload = {
                    embeds: [embed]
                };

                const json = JSON.stringify(payload, null, 2);

                if (settings.store.autoCopy) {
                    copyToClipboard(json);
                }

                return {
                    content: `\`\`\`json\n${json}\n\`\`\`\n${settings.store.autoCopy ? "✅ Copied to clipboard! Paste into https://discohook.org/" : "Copy this JSON and paste into https://discohook.org/"}`
                };
            }
        },
        {
            name: "embedfield",
            description: "Generate embed JSON with fields",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "title",
                    description: "Embed title",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "fields",
                    description: "Fields (format: Name1:Value1|Name2:Value2)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "color",
                    description: "Embed color (hex format)",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                const title = findOption(args, "title", "");
                const fieldsInput = findOption(args, "fields", "");
                const colorHex = findOption(args, "color", settings.store.defaultColor);

                const fields = fieldsInput.split("|").map(field => {
                    const [name, value] = field.split(":");
                    return {
                        name: name?.trim() || "Field",
                        value: value?.trim() || "Value",
                        inline: false
                    };
                });

                const embed = {
                    title,
                    fields,
                    color: hexToDecimal(colorHex),
                    timestamp: new Date().toISOString()
                };

                const payload = {
                    embeds: [embed]
                };

                const json = JSON.stringify(payload, null, 2);

                if (settings.store.autoCopy) {
                    copyToClipboard(json);
                }

                return {
                    content: `\`\`\`json\n${json}\n\`\`\`\n${settings.store.autoCopy ? "✅ Copied to clipboard!" : ""}`
                };
            }
        }
    ],

    start() {
        console.log("[EmbedBuilder] Plugin started");
    },

    stop() {
        console.log("[EmbedBuilder] Plugin stopped");
    }
});