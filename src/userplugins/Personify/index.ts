/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageSendListener, addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { Settings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";

const modalOptions = [
    { value: "gpt-4", label: "GPT-4", default: true },
    { value: "gpt-4-0125-preview", label: "GPT-4 0125 Preview" },
    { value: "gpt-4-turbo-preview", label: "GPT-4 Turbo Preview" },
    { value: "gpt-4-1106-preview", label: "GPT-4 1106 Preview" },
    { value: "gpt-4-vision-preview", label: "GPT-4 Vision Preview" },
    { value: "gpt-4-0314", label: "GPT-4 0314" },
    { value: "gpt-4-0613", label: "GPT-4 0613" },
    { value: "gpt-4-32k", label: "GPT-4 32k" },
    { value: "gpt-4-32k-0314", label: "GPT-4 32k 0314" },
    { value: "gpt-4-32k-0613", label: "GPT-4 32k 0613" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
    { value: "gpt-3.5-turbo-16k", label: "GPT-3.5 Turbo 16k" },
    { value: "gpt-3.5-turbo-0301", label: "GPT-3.5 Turbo 0301" },
    { value: "gpt-3.5-turbo-0613", label: "GPT-3.5 Turbo 0613" },
    { value: "gpt-3.5-turbo-1106", label: "GPT-3.5 Turbo 1106" },
    { value: "gpt-3.5-turbo-0125", label: "GPT-3.5 Turbo 0125" },
    { value: "gpt-3.5-turbo-16k-0613", label: "GPT-3.5 Turbo 16k 0613" }
];

const settings = definePluginSettings({
    apiKey: {
        type: OptionType.STRING,
        description: "Your OpenAI API Key",
        default: "",
        restartNeeded: false
    },
    modal:
    {
        type: OptionType.SELECT,
        description: "The GPT Modal to use. The plugin was developed and tested with base gpt-4, use any others at your own risk",
        options: modalOptions
    },
    prompt:
    {
        type: OptionType.STRING,
        description: "The character prompt to use",
        default: "As an uwu girl, use cute emoticons and act cutesy"
    }
});

const messagePatch: MessageSendListener = async (channelId, msg) => {
    msg.content = await textProcessing(msg.content);
}

export default definePlugin({
    name: "Personify",
    description: "Use AI to personify your messages",
    authors: [
        Devs.Samwich
    ],
    tags: ["Appearance", "Customisation", "Fun"],
    enabledByDefault: false,
    dependencies: ["MessageEventsAPI"],
    start()
    {
        this.preSend = addMessagePreSendListener(messagePatch);
    },
    stop()
    {
        this.preSend = removeMessagePreSendListener(messagePatch);
    },
    settings
});

async function textProcessing(input: string)
{
    if (input.length === 0) { return input; }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${settings.store.apiKey}`
        },
        body: JSON.stringify({
            model: settings.store.modal,
            messages: [
                {
                    role: "system",
                    content: `You are working for a message personifier, when messaged, respond the content of the users message, but ${settings.store.prompt}. DO NOT Modify the original sentiment of the message and never respond to the users message, only respond with the modified version. If a user sends a link, leave it alone and do not add anything to it.`
                },
                {
                    role: "user",
                    content: input
                }
            ]
        })
    });

    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content;

    if (!content) { return input; }
    if (content.includes("can't assist")) { return `${input} (AI Refused)`; }
    return content;
}