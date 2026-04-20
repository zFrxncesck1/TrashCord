/*
 * Vencord/Equicord, a Discord client mod - Fixxed by zFry
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { OptionType } from "@utils/types";

const settings = definePluginSettings({
	autoCapitalization: {
		type: OptionType.BOOLEAN,
		description: "Auto Capitalization to the first letter",
	},
	autoPunctuation: {
		type: OptionType.BOOLEAN,
		description: "Auto Punctuation at the end of a sentence",
	},
	autoWordReplacement: {
		type: OptionType.BOOLEAN,
		description: "Auto Word Replacement",
	},
});

export default definePlugin({
	name: "GrammarNazi",
	description: "Automatic punctuation, capitalization, and word replacement.",
	authors: [{ name: "S€th", id: 1273447359417942128n }],
    tags: ["Chat", "Utility"],
	enabledByDefault: false,
	// Remove dependencies: ["MessageEventsAPI"], - use manual message interception instead
	settings,
	
	async start() {
		let dictionary = await fetch(
			"https://cdn.jsdelivr.net/gh/wont-stream/dictionary@main/index.min.json",
		);
		dictionary = await dictionary.json();

		// Manual message interception - Equicord/Vencord compatible
		this.listener = this.getPresend(dictionary as any);
		this.originalSend = (globalThis as any).FluxDispatcher?._dispatcher?._actionHandlers?.MESSAGE_CREATE;
		
		// Hook into message sending via FluxDispatcher or React
		if ((globalThis as any).FluxDispatcher) {
			(globalThis as any).FluxDispatcher.subscribe("MESSAGE_CREATE", this.listener);
		}
	},
	
	stop() {
		if (this.listener && (globalThis as any).FluxDispatcher) {
			(globalThis as any).FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.listener);
		}
		delete this.listener;
	},

	getPresend(dictionary: { [key: string]: string }) {
		return (_, msg: any) => {
			if (!msg?.content) return;
			
			msg.content = msg.content.trim();
			if (!msg.content.includes("```") && /\w/.test(msg.content.charAt(0))) {
				if (settings.store.autoWordReplacement) {
					const re = new RegExp(
						`(^|(?<=[^A-Z0-9]+))(${Object.keys(dictionary)
							.map((k) => k.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"))
							.join("|")})((?=[^A-Z0-9]+)|$)`,
						"gi",
					);
					msg.content = msg.content.replace(re, (match) => {
						return dictionary[match.toLowerCase()] || match;
					});
				}

				if (settings.store.autoPunctuation) {
					if (/[A-Z0-9]/i.test(msg.content.charAt(msg.content.length - 1))) {
						if (!msg.content.startsWith("http", msg.content.lastIndexOf(" ") + 1)) {
							msg.content += ".";
						}
					}
				}

				if (settings.store.autoCapitalization) {
					msg.content = msg.content.replace(/([.!?])\s*(\w)/g, (match) =>
						match + match + match.toUpperCase(),[1][2]
					);

					if (!msg.content.startsWith("http")) {
						msg.content =
							msg.content.charAt(0).toUpperCase() + msg.content.slice(1);
					}
				}
			}
		};
	},
});