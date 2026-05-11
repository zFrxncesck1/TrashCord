import { React, useStateFromStores } from "@webpack/common";
import { gradientStore } from "./pluginState";
import type { GradientConfig } from "./types";

interface Props {
    userId: string;
    children: React.ReactNode;
}

export function GradientName({ userId, children }: Props) {
    const cfg = useStateFromStores([gradientStore as any], () => gradientStore.get(userId));
    if (!cfg) return <>{children}</>;
    return <span style={gradientStyle(cfg)}>{children}</span>;
}

function gradientStyle(cfg: GradientConfig): React.CSSProperties {
    const colors = cfg.stops.map(s => s.color);
    const list = colors.length === 1 ? [colors[0], colors[0]] : colors;
    const needsScroll = cfg.anim === "slide" || cfg.anim === "wave";
    const speed = (cfg as any).speed ?? 6;
    const durSec = 11 - speed;
    const hasHueStop = cfg.stops.some(s => s.hueAnim);
    const animations: string[] = [];
    const main = animationCss(cfg.anim, durSec, cfg.slideDir);
    if (main) animations.push(main);
    if (hasHueStop) animations.push(`gradname-hue ${durSec}s linear infinite`);
    const base: React.CSSProperties = {
        background: `linear-gradient(90deg, ${list.join(", ")})`,
        backgroundSize: needsScroll ? "200% 100%" : undefined,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
        animation: animations.length > 0 ? animations.join(", ") : undefined,
        fontFamily: cfg.font ? `"${cfg.font}", inherit` : undefined,
    };
    return base;
}

function animationCss(anim: GradientConfig["anim"], dur: number, slideDir?: "left" | "right"): string | undefined {
    switch (anim) {
        case "hue": return `gradname-hue ${dur}s linear infinite`;
        case "slide": return `gradname-slide-${slideDir === "right" ? "r" : "l"} ${dur}s linear infinite`;
        case "pulse": return `gradname-pulse ${Math.max(0.5, dur / 3)}s ease-in-out infinite`;
        case "wave": return `gradname-wave ${dur}s linear infinite`;
        default: return undefined;
    }
}

export const KEYFRAMES_CSS = `
@keyframes gradname-hue {
    0% { filter: hue-rotate(0deg); }
    100% { filter: hue-rotate(360deg); }
}
@keyframes gradname-slide-l {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
}
@keyframes gradname-slide-r {
    0% { background-position: 200% 50%; }
    100% { background-position: 0% 50%; }
}
@keyframes gradname-slide-u {
    0% { background-position-y: 100%; }
    100% { background-position-y: -100%; }
}
@keyframes gradname-slide-d {
    0% { background-position-y: -100%; }
    100% { background-position-y: 100%; }
}
@keyframes gradname-pulse {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.4); }
}
@keyframes gradname-wave {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
}
@keyframes gn-swatch-hue {
    0% { filter: hue-rotate(0deg); }
    100% { filter: hue-rotate(360deg); }
}
@property --gn-glow-x {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
}
@property --gn-glow-y {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
}
@property --gn-glow-strength {
    syntax: '<number>';
    inherits: false;
    initial-value: 1;
}
@keyframes gn-glow-orbit {
    0%   { --gn-glow-x: 0px;  --gn-glow-y: -3px; --gn-glow-strength: 1; }
    25%  { --gn-glow-x: 3px;  --gn-glow-y: 0px;  --gn-glow-strength: 1; }
    50%  { --gn-glow-x: 0px;  --gn-glow-y: 3px;  --gn-glow-strength: 1; }
    75%  { --gn-glow-x: -3px; --gn-glow-y: 0px;  --gn-glow-strength: 1; }
    100% { --gn-glow-x: 0px;  --gn-glow-y: -3px; --gn-glow-strength: 1; }
}
@keyframes gn-glow-pulse {
    0%, 100% { --gn-glow-strength: 0.6; }
    50%      { --gn-glow-strength: 1.5; }
}
@keyframes gn-glow-wave {
    0%   { --gn-glow-x: -4px; --gn-glow-y: 0px; --gn-glow-strength: 1; }
    50%  { --gn-glow-x: 4px;  --gn-glow-y: 0px; --gn-glow-strength: 1; }
    100% { --gn-glow-x: -4px; --gn-glow-y: 0px; --gn-glow-strength: 1; }
}
@keyframes gn-glow-flicker {
    0%, 18%, 22%, 25%, 53%, 57%, 100% { --gn-glow-strength: 1.4; }
    20%, 24%, 55%                     { --gn-glow-strength: 0.3; }
}
@keyframes gn-glow-bounce {
    0%, 100% { --gn-glow-y: 0px; --gn-glow-strength: 1; }
    50%      { --gn-glow-y: -4px; --gn-glow-strength: 1.2; }
}
@keyframes gn-glow-spin-fast {
    0%   { --gn-glow-x: 0px;  --gn-glow-y: -2px; }
    25%  { --gn-glow-x: 2px;  --gn-glow-y: 0px; }
    50%  { --gn-glow-x: 0px;  --gn-glow-y: 2px; }
    75%  { --gn-glow-x: -2px; --gn-glow-y: 0px; }
    100% { --gn-glow-x: 0px;  --gn-glow-y: -2px; }
}
/* Custom-font overlay: original element keeps Discord-font text (invisible)
 * so its layout box stays Discord-sized — adjacent icons don't reflow.
 * The pseudo overlay renders the same text in the custom font, absolutely
 * positioned on top, so the visible glyphs match the user's choice. */
[data-gn-overlay]::after {
    content: attr(data-gn-text);
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    white-space: nowrap;
    pointer-events: none;
    font-family: var(--gn-font);
    background-image: var(--gn-bg);
    background-size: var(--gn-bg-size, auto);
    background-position: var(--gn-bg-pos, 0% 50%);
    background-repeat: var(--gn-bg-repeat, no-repeat);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    animation: var(--gn-anim, none);
}
`;
