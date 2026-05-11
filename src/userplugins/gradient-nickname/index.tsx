import definePlugin from "@utils/types";
import settings from "./settings";
import { GradientName, KEYFRAMES_CSS } from "./render";
import {
    gradientStore, subscribeFlux, unsubscribeFlux, hydrateSelfFromStorage,
    getPrefs, hydratePrefs, subscribePrefs, SelectedGuildStore,
} from "./pluginState";
import { GradientNicknamePanel } from "./panel";
import { ensureFontLoaded, onAnyFontLoad, removeAllLoadedFontLinks } from "./fonts";
import { React, ReactDOM, createRoot, UserStore, Menu } from "@webpack/common";
import { addContextMenuPatch, removeContextMenuPatch, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { updatePrefs } from "./pluginState";
// bioWriter no longer auto-syncs to bio (would be Discord-automation rule territory).
// User pastes the encoded tag manually via the panel's "Copy bio tag" button.

let styleEl: HTMLStyleElement | null = null;
let observer: MutationObserver | null = null;
let mountNode: HTMLDivElement | null = null;
let reactRoot: any = null;
let storeUnsub: (() => void) | null = null;
let prefsUnsub: (() => void) | null = null;

const originalStyles = new WeakMap<HTMLElement, string>();

const PANEL_ID = "gradient-nickname-mounted-panel";

function mountPanelIfAppearance() {
    if (document.getElementById(PANEL_ID)) return; // already mounted
    const ANCHOR_TEXT = /apply theme to other users/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    while (walker.nextNode()) {
        const n = walker.currentNode as Text;
        if (ANCHOR_TEXT.test(n.textContent || "")) {
            textNode = n;
            break;
        }
    }
    if (!textNode) return;
    let anchor = textNode.parentElement;
    if (!anchor) return;
    console.log("[GradientNickname] anchor found:", anchor.tagName, anchor.className);
    let row: HTMLElement = anchor;
    for (let i = 0; i < 8; i++) {
        const next: HTMLElement | null = row.parentElement;
        if (!next) break;
        const nextText = (next.innerText || "").trim();
        if (nextText.length > 200 && /Default Themes|Color Themes|Sync theme/.test(nextText)) break;
        row = next;
    }
    if (!row.parentElement) return;

    const host = document.createElement("div");
    host.id = PANEL_ID;
    row.parentElement.insertBefore(host, row.nextSibling);
    mountNode = host;

    if (createRoot) {
        reactRoot = createRoot(host);
        reactRoot.render(React.createElement(GradientNicknamePanel));
    } else if ((ReactDOM as any)?.render) {
        (ReactDOM as any).render(React.createElement(GradientNicknamePanel), host);
    } else {
        console.warn("[GradientNickname] no ReactDOM available");
    }
}

function unmountPanel() {
    if (reactRoot) {
        try { reactRoot.unmount(); } catch {}
        reactRoot = null;
    }
    if (mountNode && mountNode.parentNode) {
        mountNode.parentNode.removeChild(mountNode);
    }
    mountNode = null;
}

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
        if (mountNode && !document.body.contains(mountNode)) {
            mountNode = null;
            reactRoot = null;
        }
        try { mountPanelIfAppearance(); } catch (err) { console.error("[GradientNickname] mount error", err); }
        try { paintUsernames(); } catch (err) { console.error("[GradientNickname] paint error", err); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try { mountPanelIfAppearance(); } catch (err) { console.error("[GradientNickname] mount error", err); }
    try { paintUsernames(); } catch (err) { console.error("[GradientNickname] paint error", err); }
}

function getReactFiber(el: any): any {
    for (const key in el) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) return el[key];
    }
    return null;
}

function findUserIdFromFiber(fiber: any, maxDepth = 14): string | null {
    return findContextFromFiber(fiber, maxDepth).userId;
}

function findContextFromFiber(fiber: any, maxDepth = 18): { userId: string | null; guildId: string | null } {
    let node = fiber;
    let depth = 0;
    let userId: string | null = null;
    let guildId: string | null = null;
    while (node && depth < maxDepth) {
        const props = node.memoizedProps || node.pendingProps;
        if (props) {
            if (!userId) {
                if (props.message?.author?.id) userId = String(props.message.author.id);
                else if (props.user?.id) userId = String(props.user.id);
                else if (props.userId) userId = String(props.userId);
                else if (props.author?.id) userId = String(props.author.id);
                else if (props.member?.user?.id) userId = String(props.member.user.id);
                else if (props.member?.userId) userId = String(props.member.userId);
                else if (props.participant?.user?.id) userId = String(props.participant.user.id);
                else if (props.participant?.userId) userId = String(props.participant.userId);
                else if (props.row?.user?.id) userId = String(props.row.user.id);
                else if (props.row?.member?.user?.id) userId = String(props.row.member.user.id);
                else if (props.peer?.user?.id) userId = String(props.peer.user.id);
                else if (props.peer?.id) userId = String(props.peer.id);
                else if (props.entity?.user?.id) userId = String(props.entity.user.id);
                else if (props.entity?.id && /^\d{15,21}$/.test(String(props.entity.id))) userId = String(props.entity.id);
                else if (props.relationship?.user?.id) userId = String(props.relationship.user.id);
                else if (props.relationship?.id) userId = String(props.relationship.id);
                else if (props.channel?.recipients?.length === 1 && props.channel.recipients[0]) {
                    const r = props.channel.recipients[0];
                    if (typeof r === "string") userId = r;
                    else if (r?.id) userId = String(r.id);
                }
            }
            if (!guildId) {
                if (props.channel?.guild_id) guildId = String(props.channel.guild_id);
                else if (props.message?.guild_id) guildId = String(props.message.guild_id);
                else if (props.guildId) guildId = String(props.guildId);
                else if (props.guild?.id) guildId = String(props.guild.id);
            }
            if (userId && guildId) break;
        }
        node = node.return;
        depth++;
    }
    return { userId, guildId };
}

const PAINTED_ATTR = "data-gn-painted";

const SELECTOR = [
    // Discord class hash separators: `-` (older builds) and `_` (newer builds). Match both.
    '[class*="username-"]', '[class*="username_"]',
    '[class*="nickname-"]', '[class*="nickname_"]',
    '[class*="displayName-"]', '[class*="displayName_"]',
    '[class*="globalName-"]', '[class*="globalName_"]',
    '[class*="memberUsername"]',
    // userTag wraps name + overflow button; paint the inner span only.
    '[class*="userTag-"] > span', '[class*="userTag_"] > span',
    // Bottom-left account panel: nameTag → panelTitleContainer → title_*.
    '[class*="panelTitleContainer"] [class*="title_"]',
    '[class*="nameTag-"] [class*="title_"]', '[class*="nameTag_"] [class*="title_"]',
    // Account switcher / profile customization tab: textContainer_* → lineClamp1_*.
    '[class*="textContainer-"] [class*="lineClamp"]', '[class*="textContainer_"] [class*="lineClamp"]',
    '[id^="message-username-"]',
].map(s => `${s}:not([${PAINTED_ATTR}])`).join(",");

function shouldPaintFor(userId: string, elementGuildId?: string | null): boolean {
    const prefs = getPrefs();
    if (!prefs.enabled) return false;
    if (prefs.mutedUsers.includes(userId)) return false;
    const cfg = gradientStore.get(userId);
    if (!cfg) return false;
    const selfId = UserStore?.getCurrentUser?.()?.id;
    if (userId === selfId && elementGuildId && prefs.mutedGuilds.includes(elementGuildId)) {
        return false;
    }
    // Cross-user: respect remote user's bio-encoded muted guild list.
    if (elementGuildId && cfg.mutedGuilds && cfg.mutedGuilds.includes(elementGuildId)) {
        return false;
    }
    return true;
}

// Ancestor classes that should never be painted (e.g., chiplet pills, embeds, replies, nameplates).
const EXCLUDE_ANCESTOR_RE = /(^|\s)(chiplet|chipletContainer|repliedMessage|repliedTextPreview|nameplate|boostBadge|nitroBadge|botTag|embedAuthor|embedFooter|messageAccessory|attachedThread|markup|mentioned|roleMention|pronouns|customStatus|activityName|activityText|usernamePronounsContainer|usernameAndPronouns|panelSubtext|panelSubtextContainer|subText|tag_|discriminator)/i;

function isExcluded(el: HTMLElement): boolean {
    let n: HTMLElement | null = el;
    for (let i = 0; i < 20 && n; i++) {
        const cls = n.className;
        if (typeof cls === "string" && EXCLUDE_ANCESTOR_RE.test(cls)) return true;
        n = n.parentElement;
    }
    return false;
}

// Only paint elements that are a single text-node leaf (real usernames). Skips badge spans
// that contain icons / nested elements (e.g., nameplate pills inside userTag).
function isTextLeaf(el: HTMLElement): boolean {
    if (el.children.length > 0) return false;
    const txt = (el.textContent || "").trim();
    return txt.length > 0;
}

const elementGuildId = new WeakMap<HTMLElement, string | null>();

function paintUsernames() {
    const candidates = document.querySelectorAll<HTMLElement>(SELECTOR);
    for (const el of Array.from(candidates)) {
        if (isExcluded(el)) continue;
        if (!isTextLeaf(el)) continue;
        const fiber = getReactFiber(el);
        if (!fiber) continue;
        const { userId, guildId } = findContextFromFiber(fiber);
        if (!userId) continue;
        if (!shouldPaintFor(userId, guildId)) continue;
        if (!originalStyles.has(el)) {
            originalStyles.set(el, el.getAttribute("style") || "");
        }
        elementGuildId.set(el, guildId);
        el.setAttribute(PAINTED_ATTR, userId);
        applyGradient(el, userId);
    }
}

function applyGradient(el: HTMLElement, userId: string) {
    const guildId = elementGuildId.get(el) ?? null;
    if (!shouldPaintFor(userId, guildId)) {
        clearGradient(el);
        return;
    }
    const cfg = gradientStore.get(userId);
    if (!cfg) {
        clearGradient(el);
        return;
    }
    const colors = cfg.stops.map(s => s.color);
    const baseList = colors.length === 1 ? [colors[0], colors[0]] : colors;
    const speed = (cfg as any).speed ?? 6;
    const durSec = 11 - speed;
    const needsScroll = cfg.anim === "slide" || cfg.anim === "wave";
    const slideDir = cfg.slideDir ?? "left";
    const slideVertical = needsScroll && (slideDir === "up" || slideDir === "down");
    // Seamless slide/wave: append first stop at end so gradient tile wraps without seam.
    const gradList = needsScroll ? [...baseList, baseList[0]] : baseList;
    const gradAngle = slideVertical ? "180deg" : "90deg";
    const gradValue = `linear-gradient(${gradAngle}, ${gradList.join(", ")})`;
    el.style.setProperty("background-image", gradValue, "important");
    let bgSizeValue: string | null = null;
    let bgPosValue: string | null = null;
    if (needsScroll) {
        bgSizeValue = slideVertical ? "100% 200%" : "200% 100%";
        el.style.setProperty("background-size", bgSizeValue, "important");
        el.style.setProperty("background-repeat", "repeat", "important");
        if (slideVertical) {
            el.style.setProperty("background-position-x", "50%", "important");
            el.style.removeProperty("background-position-y");
            el.style.removeProperty("background-position");
        } else {
            el.style.removeProperty("background-position");
            el.style.removeProperty("background-position-x");
            el.style.removeProperty("background-position-y");
        }
    } else {
        const fit = measureTextFit(el);
        if (fit) {
            bgSizeValue = `${fit.sizePct}% 100%`;
            bgPosValue = `${fit.posPct}% 50%`;
            el.style.setProperty("background-size", bgSizeValue, "important");
            el.style.setProperty("background-position", bgPosValue, "important");
            el.style.setProperty("background-repeat", "no-repeat", "important");
        } else {
            el.style.removeProperty("background-size");
            el.style.removeProperty("background-position");
            el.style.removeProperty("background-repeat");
        }
    }
    el.style.setProperty("-webkit-background-clip", "text", "important");
    el.style.setProperty("background-clip", "text", "important");
    el.style.setProperty("color", "transparent", "important");
    el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    // Glow temporarily disabled — upcoming feature, gated off regardless of cfg.glow.
    const GLOW_ENABLED = false;
    if (GLOW_ENABLED && cfg.glow) {
        const glowList = (cfg.glowStops && cfg.glowStops.length > 0
            ? cfg.glowStops.map(s => s.color)
            : baseList);
        const intensity = Math.max(1, Math.min(10, (cfg.glowIntensity ?? 6)));
        const tsLayers: string[] = [];
        const dsLayers: string[] = [];
        // Tight, subtle halo. Position animated via --gn-glow-x/y for 360° orbit around name.
        for (let i = 0; i < glowList.length; i++) {
            const c = glowList[i];
            const r1 = (0.5 + intensity * 0.2).toFixed(1);
            const r2 = (1 + intensity * 0.4 + i * 0.2).toFixed(1);
            tsLayers.push(`0 0 ${r1}px ${c}`, `0 0 ${r2}px ${c}`);
            dsLayers.push(
                `drop-shadow(var(--gn-glow-x, 0px) var(--gn-glow-y, 0px) calc(${r1}px * var(--gn-glow-strength, 1)) ${c})`,
                `drop-shadow(var(--gn-glow-x, 0px) var(--gn-glow-y, 0px) calc(${r2}px * var(--gn-glow-strength, 1)) ${c})`,
            );
        }
        el.style.setProperty("text-shadow", tsLayers.join(", "), "important");
        if (cfg.anim !== "hue" && cfg.anim !== "pulse" && !cfg.stops.some(s => s.hueAnim)) {
            el.style.setProperty("filter", dsLayers.join(" "), "important");
        } else {
            el.style.removeProperty("filter");
        }
    } else {
        el.style.removeProperty("text-shadow");
        el.style.removeProperty("filter");
    }
    if (cfg.font) {
        ensureFontLoaded(cfg.font);
    }
    // Don't apply font-family directly: different glyph metrics would shift the
    // element's width and reflow adjacent icons (mute badge, status, etc.).
    // Instead use a pseudo `::after` overlay that renders text in the custom font
    // absolutely-positioned on top — original layout box preserved.
    el.style.removeProperty("font-family");
    let anim = "";
    if (cfg.anim === "slide") {
        // Note: u/d suffix flipped vs naive guess — perceived scroll direction is opposite
        // of bg-position-y motion. Panel SVG preview uses translate which has the inverse
        // semantics, so this mapping keeps DOM paint matching the preview.
        const suffix = slideDir === "right" ? "r" : slideDir === "up" ? "d" : slideDir === "down" ? "u" : "l";
        anim = `gradname-slide-${suffix} ${durSec}s linear infinite`;
    }
    else if (cfg.anim === "wave") anim = `gradname-wave ${durSec}s linear infinite`;
    else if (cfg.anim === "pulse") anim = `gradname-pulse ${Math.max(0.5, durSec / 3)}s ease-in-out infinite`;
    if (cfg.stops.some(s => s.hueAnim)) anim = (anim ? anim + ", " : "") + `gradname-hue ${durSec}s linear infinite`;
    if (GLOW_ENABLED && cfg.glow) {
        const ga = cfg.glowAnim ?? "orbit";
        if (ga !== "none") {
            const fast = ga === "spin-fast";
            const dur = fast ? Math.max(0.6, durSec / 3) : Math.max(2, durSec);
            const easing = (ga === "pulse" || ga === "bounce") ? "ease-in-out" : "linear";
            anim = (anim ? anim + ", " : "") + `gn-glow-${ga} ${dur}s ${easing} infinite`;
        }
    }
    if (anim) el.style.setProperty("animation", anim, "important");
    else el.style.removeProperty("animation");

    // Custom-font overlay (avoids layout shift). Only when a font is selected.
    if (cfg.font) {
        const family = cfg.font.startsWith("var(")
            ? `${cfg.font}, var(--font-primary), sans-serif`
            : `"${cfg.font}", var(--font-primary), sans-serif`;
        el.dataset.gnText = el.textContent ?? "";
        el.dataset.gnOverlay = "1";
        el.style.setProperty("position", "relative", "important");
        el.style.setProperty("--gn-font", family);
        el.style.setProperty("--gn-bg", gradValue);
        if (bgSizeValue) el.style.setProperty("--gn-bg-size", bgSizeValue);
        else el.style.removeProperty("--gn-bg-size");
        if (bgPosValue) el.style.setProperty("--gn-bg-pos", bgPosValue);
        else el.style.removeProperty("--gn-bg-pos");
        el.style.setProperty("--gn-bg-repeat", needsScroll ? "repeat" : "no-repeat");
        if (anim) el.style.setProperty("--gn-anim", anim);
        else el.style.removeProperty("--gn-anim");
    } else {
        delete el.dataset.gnText;
        delete el.dataset.gnOverlay;
        el.style.removeProperty("--gn-font");
        el.style.removeProperty("--gn-bg");
        el.style.removeProperty("--gn-bg-size");
        el.style.removeProperty("--gn-bg-pos");
        el.style.removeProperty("--gn-bg-repeat");
        el.style.removeProperty("--gn-anim");
    }
}

function measureTextFit(el: HTMLElement): { sizePct: number; posPct: number } | null {
    try {
        const elRect = el.getBoundingClientRect();
        if (elRect.width <= 0) return null;
        const range = document.createRange();
        range.selectNodeContents(el);
        const textRects = range.getClientRects();
        if (textRects.length === 0) return null;
        let left = Infinity, right = -Infinity;
        for (const r of Array.from(textRects)) {
            if (r.width === 0) continue;
            if (r.left < left) left = r.left;
            if (r.right > right) right = r.right;
        }
        if (!isFinite(left) || !isFinite(right)) return null;
        const textWidth = right - left;
        if (textWidth <= 0 || textWidth >= elRect.width) return null;
        const sizePct = (textWidth / elRect.width) * 100;
        const posPct = elRect.width === textWidth
            ? 0
            : ((left - elRect.left) / (elRect.width - textWidth)) * 100;
        return { sizePct, posPct };
    } catch {
        return null;
    }
}


function clearGradient(el: HTMLElement) {
    delete el.dataset.gnText;
    delete el.dataset.gnOverlay;
    const orig = originalStyles.get(el);
    if (orig !== undefined) {
        if (orig) el.setAttribute("style", orig);
        else el.removeAttribute("style");
        originalStyles.delete(el);
    } else {
        el.style.removeProperty("background");
        el.style.removeProperty("background-image");
        el.style.removeProperty("background-size");
        el.style.removeProperty("background-position");
        el.style.removeProperty("background-position-x");
        el.style.removeProperty("background-position-y");
        el.style.removeProperty("background-repeat");
        el.style.removeProperty("-webkit-background-clip");
        el.style.removeProperty("background-clip");
        el.style.removeProperty("color");
        el.style.removeProperty("-webkit-text-fill-color");
        el.style.removeProperty("font-family");
        el.style.removeProperty("animation");
        el.style.removeProperty("text-shadow");
        el.style.removeProperty("filter");
    }
    el.removeAttribute(PAINTED_ATTR);
}

function repaintAll() {
    const painted = document.querySelectorAll<HTMLElement>("[data-gn-painted]");
    for (const el of Array.from(painted)) {
        const userId = el.getAttribute(PAINTED_ATTR);
        if (userId) applyGradient(el, userId);
    }
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    unmountPanel();
}

// Discord's menu API rejects function components as children — only Menu.* elements allowed.
// Solution: call hooks INSIDE the patch callback (it runs in the menu's render context, so
// hooks track to that menu's React fiber). Push only direct Menu.* JSX into children.
const userContextPatch: NavContextMenuPatchCallback = (children, props: any) => {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    React.useEffect(() => {
        const u = subscribePrefs(() => force());
        return () => { u(); };
    }, []);

    const user = props?.user;
    if (!user?.id) return;
    const userId = String(user.id);
    const selfId = UserStore?.getCurrentUser?.()?.id ? String(UserStore.getCurrentUser().id) : null;
    const isSelf = selfId !== null && userId === selfId;

    if (isSelf) {
        // Self-toggle = master enable/disable (synced with Appearance panel).
        const enabled = getPrefs().enabled;
        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuCheckboxItem
                id="gn-toggle-self"
                label="Show GradientNickname (global)"
                checked={enabled}
                action={() => updatePrefs({ enabled: !enabled })}
            />,
        );
    } else {
        const muted = getPrefs().mutedUsers.includes(userId);
        const hasOverride = !!gradientStore.get(userId);
        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuCheckboxItem
                id="gn-toggle-user"
                label="Show GradientNickname (global)"
                checked={!muted}
                action={() => {
                    const cur = getPrefs().mutedUsers;
                    updatePrefs({
                        mutedUsers: muted ? cur.filter(u => u !== userId) : [...cur, userId],
                    });
                }}
            />,
            <Menu.MenuItem
                id="gn-debug-apply"
                label="Apply my gradient to this user (debug)"
                action={() => {
                    const selfCfg = selfId ? gradientStore.get(selfId) : null;
                    if (selfCfg) gradientStore.set(userId, selfCfg);
                }}
            />,
            hasOverride ? (
                <Menu.MenuItem
                    id="gn-debug-clear"
                    label="Clear debug gradient"
                    color="danger"
                    action={() => gradientStore.setNull(userId)}
                />
            ) : null,
        );
    }
};

const guildContextPatch: NavContextMenuPatchCallback = (children, props: any) => {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    React.useEffect(() => {
        const u = subscribePrefs(() => force());
        return () => { u(); };
    }, []);

    const guild = props?.guild;
    if (!guild?.id) return;
    const guildId = String(guild.id);
    const muted = getPrefs().mutedGuilds.includes(guildId);
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="gn-toggle-guild"
            label="My GradientNickname here"
            checked={!muted}
            action={() => {
                const cur = getPrefs().mutedGuilds;
                updatePrefs({
                    mutedGuilds: muted ? cur.filter(g => g !== guildId) : [...cur, guildId],
                });
            }}
        />,
    );
};

export default definePlugin({
    name: "GradientNickname",
    description: "Gradient nicknames mimicking Discord's boost role-color effect. Configure in User Settings → Appearance.",
    authors: [{ name: "redak", id: 0n }],
    tags: ["Appearance", "Customisation"],
    enabledByDefault: false,
    settings,

    patches: [
        // Per-username-surface render patches (Task 10) added separately when Discord anchors found.
    ],

    GradientName,
    GradientNicknamePanel,

    async start() {
        console.log("[GradientNickname] start");
        injectStyles();
        subscribeFlux();
        await hydratePrefs();
        await hydrateSelfFromStorage();
        const refresh = () => {
            try { repaintAll(); } catch {}
            try { paintUsernames(); } catch {}
        };
        storeUnsub = gradientStore.subscribe(refresh);
        prefsUnsub = subscribePrefs(refresh);
        const fontUnsub = onAnyFontLoad(refresh);
        const prevPrefsUnsub = prefsUnsub;
        prefsUnsub = () => { prevPrefsUnsub?.(); fontUnsub(); };
        addContextMenuPatch("user-context", userContextPatch);
        addContextMenuPatch("user-profile-actions", userContextPatch);
        addContextMenuPatch("user-profile-overflow-menu", userContextPatch);
        addContextMenuPatch("guild-context", guildContextPatch);
        startObserver();
        console.log("[GradientNickname] ready (DOM observer mode)");
    },

    stop() {
        unsubscribeFlux();
        removeContextMenuPatch("user-context", userContextPatch);
        removeContextMenuPatch("user-profile-actions", userContextPatch);
        removeContextMenuPatch("user-profile-overflow-menu", userContextPatch);
        removeContextMenuPatch("guild-context", guildContextPatch);
        if (storeUnsub) { storeUnsub(); storeUnsub = null; }
        if (prefsUnsub) { prefsUnsub(); prefsUnsub = null; }
        // Restore all painted elements before unmount.
        const painted = document.querySelectorAll<HTMLElement>(`[${PAINTED_ATTR}]`);
        for (const el of Array.from(painted)) clearGradient(el);
        stopObserver();
        if (styleEl) {
            styleEl.remove();
            styleEl = null;
        }
        removeAllLoadedFontLinks();
    },
});

function injectStyles() {
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "gradient-nickname-keyframes";
        styleEl.textContent = KEYFRAMES_CSS;
        document.head.appendChild(styleEl);
    }
}
