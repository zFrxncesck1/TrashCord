/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";

interface DomainInfo {
    domain: string;
    registrar?: string;
    registrationDate?: string;
    expirationDate?: string;
    updatedAt?: string;
    status?: string[];
    nameServers?: string[];
    dnssec?: string;
}

interface IPInfo {
    ip: string;
    city?: string;
    region?: string;
    country?: string;
    countryName?: string;
    lat?: number;
    lon?: number;
    org?: string;
    isp?: string;
    timezone?: string;
    zip?: string;
    asn?: string;
}

interface DNSRecord {
    type: string;
    name: string;
    data: string;
    ttl?: number;
}

const DNS_TYPES: Record<number, string> = {
    1: "A", 2: "NS", 5: "CNAME", 6: "SOA",
    15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 257: "CAA"
};

const settings = definePluginSettings({
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable debug logging to console",
        default: false
    },
    compactMode: {
        type: OptionType.BOOLEAN,
        description: "Show condensed embeds with fewer fields",
        default: false
    }
});

function log(...args: any[]) {
    if (settings.store.enableLogging) console.log("[OSINTToolkit]", ...args);
}

async function getDomainInfo(domain: string): Promise<DomainInfo | null> {
    try {
        const res = await fetch(`https://rdap.org/domain/${domain}`);
        if (!res.ok) return null;
        const d = await res.json();

        let registrar = "Unknown";
        if (Array.isArray(d.entities)) {
            const reg = d.entities.find((e: any) => e.roles?.includes("registrar"));
            const fn = reg?.vcardArray?.[1]?.find((p: any) => p[0] === "fn");
            if (fn?.[3]) registrar = fn[3];
        }

        return {
            domain: d.ldhName || domain,
            registrar,
            registrationDate: d.events?.find((e: any) => e.eventAction === "registration")?.eventDate,
            expirationDate: d.events?.find((e: any) => e.eventAction === "expiration")?.eventDate,
            updatedAt: d.events?.find((e: any) => e.eventAction === "last changed")?.eventDate,
            status: d.status,
            nameServers: d.nameservers?.map((ns: any) => ns.ldhName),
            dnssec: d.secureDNS?.delegationSigned ? "Signed ✅" : "Unsigned ❌"
        };
    } catch {
        return null;
    }
}

async function getIPInfo(ip: string): Promise<IPInfo | null> {
    try {
        const res = await fetch(`https://ipapi.co/${ip}/json/`);
        if (!res.ok) return null;
        const d = await res.json();
        if (d.error) return null;

        return {
            ip: d.ip,
            city: d.city,
            region: d.region,
            country: d.country_code,
            countryName: d.country_name,
            lat: d.latitude,
            lon: d.longitude,
            org: d.org,
            isp: d.org,
            timezone: d.timezone,
            zip: d.postal,
            asn: d.asn
        };
    } catch {
        return null;
    }
}

async function getDNSRecords(domain: string, type: string): Promise<DNSRecord[] | null> {
    try {
        const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`);
        if (!res.ok) return null;
        const d = await res.json();
        if (!d.Answer && !d.Authority) return [];

        return (d.Answer || d.Authority || []).map((r: any) => ({
            type: DNS_TYPES[r.type] || String(r.type),
            name: r.name,
            data: r.data,
            ttl: r.TTL
        }));
    } catch {
        return null;
    }
}

async function getMyIP(): Promise<string | null> {
    try {
        const res = await fetch("https://api.ipify.org?format=json");
        if (!res.ok) return null;
        const d = await res.json();
        return d.ip || null;
    } catch {
        return null;
    }
}

function calcDomainAge(regDate: string): string {
    const diff = Date.now() - new Date(regDate).getTime();
    const days = Math.floor(diff / 86400000);
    return `${Math.floor(days / 365)}y ${Math.floor((days % 365) / 30)}m ${(days % 365) % 30}d`;
}

function fmtDate(iso?: string): string {
    if (!iso) return "N/A";
    try { return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
    catch { return iso; }
}

function domainEmbed(info: DomainInfo) {
    const age = info.registrationDate ? calcDomainAge(info.registrationDate) : "Unknown";
    const compact = settings.store.compactMode;

    const lines: string[] = [
        `📅 **Registered:** ${fmtDate(info.registrationDate)}`,
        `⏰ **Age:** ${age}`,
        `🗓️ **Expires:** ${fmtDate(info.expirationDate)}`,
        `🔄 **Updated:** ${fmtDate(info.updatedAt)}`,
        `🏢 **Registrar:** ${info.registrar || "Unknown"}`,
        `🔒 **DNSSEC:** ${info.dnssec || "N/A"}`,
    ];

    if (!compact) {
        if (info.status?.length)
            lines.push(`📊 **Status:** ${info.status.slice(0, 3).join(", ")}`);
        if (info.nameServers?.length)
            lines.push(`🌐 **Nameservers:**\n${info.nameServers.slice(0, 4).map(ns => `> ${ns}`).join("\n")}`);
    }

    return {
        content: "",
        embeds: [{
            title: `🔍 Domain: ${info.domain}`,
            description: lines.join("\n"),
            color: 0x5865F2,
            footer: { text: "OSINTToolkit • rdap.org", icon_url: "https://cdn.discordapp.com/embed/avatars/0.png" },
            timestamp: new Date().toISOString()
        }] as any
    };
}

function ipEmbed(info: IPInfo) {
    const mapUrl = `https://www.openstreetmap.org/?mlat=${info.lat}&mlon=${info.lon}&zoom=10`;
    const flag = info.country ? `https://flagcdn.com/w80/${info.country.toLowerCase()}.png` : undefined;
    const location = [info.city, info.region, info.countryName].filter(Boolean).join(", ") || "Unknown";

    const lines: (string | null)[] = [
        `📍 **Location:** ${location}`,
        `🕐 **Timezone:** ${info.timezone || "Unknown"}`,
        `📮 **ZIP:** ${info.zip || "N/A"}`,
        `🌐 **Org / ISP:** ${info.org || "Unknown"}`,
        info.asn ? `🔢 **ASN:** ${info.asn}` : null,
        (info.lat && info.lon) ? `🗺️ **Coords:** [${info.lat}, ${info.lon}](${mapUrl})` : null,
    ];

    return {
        content: "",
        embeds: [{
            title: `🌐 IP: ${info.ip}`,
            description: lines.filter(Boolean).join("\n"),
            color: 0x57F287,
            thumbnail: flag ? { url: flag } : undefined,
            footer: { text: "OSINTToolkit • ipapi.co", icon_url: "https://cdn.discordapp.com/embed/avatars/0.png" },
            timestamp: new Date().toISOString()
        }] as any
    };
}

function dnsEmbed(domain: string, type: string, records: DNSRecord[]) {
    const compact = settings.store.compactMode;

    if (!records.length) {
        return {
            content: "",
            embeds: [{
                title: `📡 DNS: ${domain} [${type}]`,
                description: "No records found.",
                color: 0xFEE75C,
                footer: { text: "OSINTToolkit • dns.google" },
                timestamp: new Date().toISOString()
            }] as any
        };
    }

    const maxRecords = compact ? 5 : 10;
    const shown = records.slice(0, maxRecords);
    const description = shown.map(r =>
        `\`${r.type}\` **${r.name}** → \`${r.data}\`` + (r.ttl ? ` *(TTL: ${r.ttl}s)*` : "")
    ).join("\n");

    return {
        content: "",
        embeds: [{
            title: `📡 DNS: ${domain} [${type}]`,
            description: description + (records.length > maxRecords ? `\n*...and ${records.length - maxRecords} more*` : ""),
            color: 0xEB459E,
            footer: { text: "OSINTToolkit • dns.google", icon_url: "https://cdn.discordapp.com/embed/avatars/0.png" },
            timestamp: new Date().toISOString()
        }] as any
    };
}

function subnetCalc(cidr: string) {
    const [ip, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr);

    if (!ip || isNaN(prefix) || prefix < 0 || prefix > 32) return null;

    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;

    const ipInt = parts.reduce((acc, oct) => (acc << 8) | oct, 0) >>> 0;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const network = (ipInt & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const hosts = prefix >= 31 ? Math.pow(2, 32 - prefix) : Math.pow(2, 32 - prefix) - 2;

    function intToIP(n: number) {
        return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
    }

    return {
        network: intToIP(network),
        broadcast: intToIP(broadcast),
        mask: intToIP(mask),
        first: prefix < 31 ? intToIP(network + 1) : intToIP(network),
        last: prefix < 31 ? intToIP(broadcast - 1) : intToIP(broadcast),
        hosts,
        prefix
    };
}

export default definePlugin({
    name: "OSINTToolkit",
    description: "OSINT toolkit: domain info, IP geolocation, DNS lookup, subnet calc",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    commands: [
        {
            name: "domain",
            description: "Domain WHOIS / RDAP lookup — registration, registrar, nameservers",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "domain",
                    description: "Domain to lookup (e.g. google.com)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: any[], ctx: any) => {
                const raw = (args.find(a => a.name === "domain")?.value as string ?? "").toLowerCase().trim()
                    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");

                if (!raw) {
                    sendBotMessage(ctx.channel.id, { content: "❌ Please provide a valid domain name." });
                    return;
                }

                log("domain lookup:", raw);
                sendBotMessage(ctx.channel.id, { content: `🔍 Looking up \`${raw}\`...` });

                const info = await getDomainInfo(raw);
                if (!info) {
                    sendBotMessage(ctx.channel.id, { content: `❌ Lookup failed for **${raw}**.\n> Domain may not exist or the RDAP server is unavailable.` });
                    return;
                }

                sendBotMessage(ctx.channel.id, domainEmbed(info));
            }
        },
        {
            name: "iplookup",
            description: "IP geolocation — city, country, ISP, ASN, coordinates",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "ip",
                    description: "IPv4 address to lookup (e.g. 8.8.8.8)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: any[], ctx: any) => {
                const ip = (args.find(a => a.name === "ip")?.value as string ?? "").trim();

                const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
                if (!ipv4Re.test(ip) || ip.split(".").some(o => parseInt(o) > 255)) {
                    sendBotMessage(ctx.channel.id, { content: "❌ Invalid IPv4 address. Use format: `8.8.8.8`" });
                    return;
                }

                const privateRe = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|255\.)/;
                if (privateRe.test(ip)) {
                    sendBotMessage(ctx.channel.id, { content: "❌ Private/reserved IP addresses cannot be geolocated." });
                    return;
                }

                log("ip lookup:", ip);
                sendBotMessage(ctx.channel.id, { content: `🌐 Looking up \`${ip}\`...` });

                const info = await getIPInfo(ip);
                if (!info) {
                    sendBotMessage(ctx.channel.id, { content: `❌ Lookup failed for **${ip}**.\n> Rate limited (30 req/min) or invalid IP.` });
                    return;
                }

                sendBotMessage(ctx.channel.id, ipEmbed(info));
            }
        },
        {
            name: "dns",
            description: "DNS record lookup via Google DNS-over-HTTPS",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "domain",
                    description: "Domain to query (e.g. google.com)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "type",
                    description: "Record type (default: A)",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                    choices: [
                        { name: "A (IPv4)", value: "A" },
                        { name: "AAAA (IPv6)", value: "AAAA" },
                        { name: "MX (Mail)", value: "MX" },
                        { name: "TXT (Text)", value: "TXT" },
                        { name: "NS (Nameserver)", value: "NS" },
                        { name: "CNAME (Alias)", value: "CNAME" },
                        { name: "SOA (Authority)", value: "SOA" },
                        { name: "CAA (CA Auth)", value: "CAA" },
                    ]
                }
            ],
            execute: async (args: any[], ctx: any) => {
                const domain = (args.find(a => a.name === "domain")?.value as string ?? "").toLowerCase().trim()
                    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
                const type = (args.find(a => a.name === "type")?.value as string) || "A";

                if (!domain) {
                    sendBotMessage(ctx.channel.id, { content: "❌ Please provide a domain." });
                    return;
                }

                log("dns lookup:", domain, type);
                sendBotMessage(ctx.channel.id, { content: `📡 Querying \`${type}\` records for \`${domain}\`...` });

                const records = await getDNSRecords(domain, type);
                if (records === null) {
                    sendBotMessage(ctx.channel.id, { content: `❌ DNS query failed for **${domain}**.` });
                    return;
                }

                sendBotMessage(ctx.channel.id, dnsEmbed(domain, type, records));
            }
        },
        {
            name: "subnet",
            description: "Subnet calculator — network, broadcast, usable range, host count",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "cidr",
                    description: "IP in CIDR notation (e.g. 192.168.1.0/24)",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: any[], ctx: any) => {
                const cidr = (args.find(a => a.name === "cidr")?.value as string ?? "").trim();
                const result = subnetCalc(cidr);

                if (!result) {
                    sendBotMessage(ctx.channel.id, { content: "❌ Invalid CIDR. Example: `192.168.1.0/24`" });
                    return;
                }

                const lines = [
                    `🌐 **Network:** \`${result.network}/${result.prefix}\``,
                    `📢 **Broadcast:** \`${result.broadcast}\``,
                    `🎭 **Subnet Mask:** \`${result.mask}\``,
                    `🟢 **First Host:** \`${result.first}\``,
                    `🔴 **Last Host:** \`${result.last}\``,
                    `💻 **Usable Hosts:** \`${result.hosts.toLocaleString()}\``,
                ];

                sendBotMessage(ctx.channel.id, {
                    content: "",
                    embeds: [{
                        title: `🧮 Subnet: ${cidr}`,
                        description: lines.join("\n"),
                        color: 0xED4245,
                        footer: { text: "OSINTToolkit • Subnet Calc" },
                        timestamp: new Date().toISOString()
                    }] as any
                });
            }
        },
        {
            name: "myip",
            description: "Show your current public IP address",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (args: any[], ctx: any) => {
                sendBotMessage(ctx.channel.id, { content: "🔍 Fetching your public IP..." });
                const ip = await getMyIP();
                if (!ip) {
                    sendBotMessage(ctx.channel.id, { content: "❌ Could not retrieve your public IP." });
                    return;
                }
                sendBotMessage(ctx.channel.id, { content: `✅ Your public IP: \`${ip}\`` });
            }
        }
    ]
});
