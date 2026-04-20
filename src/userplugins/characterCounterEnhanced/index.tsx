/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import managedStyle from "./style.css?managed";

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore, React } from "@webpack/common";

// ==================== INTERFACES ====================
interface TextStats {
    characters: number;
    words: number;
    sentences: number;
    paragraphs: number;
    lines: number;
    spaces: number;
    alphanumeric: number;
}

interface TypingSpeed {
    charsPerMinute: number;
    wordsPerMinute: number;
    lastUpdateTime: number;
}

// ==================== SETTINGS ====================
const settings = definePluginSettings({
    // ============ BASIC SETTINGS ============
    basicSettings: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ padding: "10px", background: "#2b2d31", borderRadius: "8px", marginBottom: "10px" }}>
                <h3 style={{ color: "#00d9ff", margin: "0 0 5px 0" }}>📊 Basic Settings</h3>
                <p style={{ color: "#b5bac1", margin: 0, fontSize: "13px" }}>
                    Core character counter configuration
                </p>
            </div>
        )
    },
    colorEffects: {
        type: OptionType.BOOLEAN,
        description: "Color effects when approaching character limit",
        default: true,
    },
    showProgressBar: {
        type: OptionType.BOOLEAN,
        description: "Show visual progress bar below counter",
        default: true,
    },
    progressBarStyle: {
        type: OptionType.SELECT,
        description: "Progress bar style",
        options: [
            { label: "Thin Line", value: "thin", default: true },
            { label: "Medium Bar", value: "medium" },
            { label: "Thick Bar", value: "thick" },
            { label: "Gradient", value: "gradient" },
            { label: "Animated", value: "animated" }
        ]
    },
    counterPosition: {
        type: OptionType.SELECT,
        description: "Counter position",
        options: [
            { label: "Bottom Right", value: "bottom-right", default: true },
            { label: "Bottom Left", value: "bottom-left" },
            { label: "Top Right", value: "top-right" },
            { label: "Top Left", value: "top-left" },
            { label: "🔓 Moveable (Drag & Drop)", value: "moveable" }
        ]
    },
    savedPosition: {
        type: OptionType.STRING,
        description: "Saved custom position (automatically managed)",
        default: "",
        hidden: true
    },

    // ============ ADVANCED STATISTICS ============
    advancedStats: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ padding: "10px", background: "#2b2d31", borderRadius: "8px", marginBottom: "10px" }}>
                <h3 style={{ color: "#00d9ff", margin: "0 0 5px 0" }}>📈 Advanced Statistics</h3>
                <p style={{ color: "#b5bac1", margin: 0, fontSize: "13px" }}>
                    Detailed text analysis and metrics
                </p>
            </div>
        )
    },
    showWordCount: {
        type: OptionType.BOOLEAN,
        description: "Show word count",
        default: true,
    },
    showSentenceCount: {
        type: OptionType.BOOLEAN,
        description: "Show sentence count",
        default: false,
    },
    showParagraphCount: {
        type: OptionType.BOOLEAN,
        description: "Show paragraph count",
        default: false,
    },
    showLineCount: {
        type: OptionType.BOOLEAN,
        description: "Show line count",
        default: false,
    },
    showTypingSpeed: {
        type: OptionType.BOOLEAN,
        description: "Show typing speed (WPM/CPM)",
        default: true,
    },
    showDetailedStats: {
        type: OptionType.BOOLEAN,
        description: "Show detailed statistics on hover",
        default: true,
    },

    // ============ ALERTS & WARNINGS ============
    alertsSettings: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ padding: "10px", background: "#2b2d31", borderRadius: "8px", marginBottom: "10px" }}>
                <h3 style={{ color: "#00d9ff", margin: "0 0 5px 0" }}>🔔 Alerts & Warnings</h3>
                <p style={{ color: "#b5bac1", margin: 0, fontSize: "13px" }}>
                    Custom alerts and notifications
                </p>
            </div>
        )
    },
    enableAlerts: {
        type: OptionType.BOOLEAN,
        description: "Enable custom character alerts",
        default: false,
    },
    alertThreshold: {
        type: OptionType.SLIDER,
        description: "Alert at X% of limit",
        default: 90,
        markers: [50, 60, 70, 80, 90, 95, 98],
    },
    alertStyle: {
        type: OptionType.SELECT,
        description: "Alert style",
        options: [
            { label: "Subtle Glow", value: "glow", default: true },
            { label: "Pulse Animation", value: "pulse" },
            { label: "Shake", value: "shake" },
            { label: "Flash", value: "flash" }
        ]
    },
    playAlertSound: {
        type: OptionType.BOOLEAN,
        description: "Play sound on alert threshold",
        default: false,
    },

    // ============ COLOR CUSTOMIZATION ============
    colorSettings: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ padding: "10px", background: "#2b2d31", borderRadius: "8px", marginBottom: "10px" }}>
                <h3 style={{ color: "#00d9ff", margin: "0 0 5px 0" }}>🎨 Color Customization</h3>
                <p style={{ color: "#b5bac1", margin: 0, fontSize: "13px" }}>
                    Customize colors for different thresholds
                </p>
            </div>
        )
    },
    customColors: {
        type: OptionType.BOOLEAN,
        description: "Use custom colors instead of defaults",
        default: false,
    },
    colorSafe: {
        type: OptionType.COMPONENT,
        description: "Color for safe range (0-50%)",
        component: () => {
            const { Forms, ColorPicker } = require("@webpack/common");
            const [color, setColor] = React.useState(parseInt(settings.store.colorSafeValue || "b5bac1", 16));
            
            return (
                <Forms.FormSection>
                    <ColorPicker
                        value={color}
                        onChange={(newColor: number) => {
                            setColor(newColor);
                            settings.store.colorSafeValue = newColor.toString(16).padStart(6, '0');
                        }}
                    />
                </Forms.FormSection>
            );
        }
    },
    colorSafeValue: {
        type: OptionType.STRING,
        description: "Safe color value (managed automatically)",
        default: "b5bac1",
        hidden: true
    },
    colorWarning: {
        type: OptionType.COMPONENT,
        description: "Color for warning range (50-75%)",
        component: () => {
            const { Forms, ColorPicker } = require("@webpack/common");
            const [color, setColor] = React.useState(parseInt(settings.store.colorWarningValue || "faa81a", 16));
            
            return (
                <Forms.FormSection>
                    <ColorPicker
                        value={color}
                        onChange={(newColor: number) => {
                            setColor(newColor);
                            settings.store.colorWarningValue = newColor.toString(16).padStart(6, '0');
                        }}
                    />
                </Forms.FormSection>
            );
        }
    },
    colorWarningValue: {
        type: OptionType.STRING,
        description: "Warning color value (managed automatically)",
        default: "faa81a",
        hidden: true
    },
    colorCaution: {
        type: OptionType.COMPONENT,
        description: "Color for caution range (75-90%)",
        component: () => {
            const { Forms, ColorPicker } = require("@webpack/common");
            const [color, setColor] = React.useState(parseInt(settings.store.colorCautionValue || "f26522", 16));
            
            return (
                <Forms.FormSection>
                    <ColorPicker
                        value={color}
                        onChange={(newColor: number) => {
                            setColor(newColor);
                            settings.store.colorCautionValue = newColor.toString(16).padStart(6, '0');
                        }}
                    />
                </Forms.FormSection>
            );
        }
    },
    colorCautionValue: {
        type: OptionType.STRING,
        description: "Caution color value (managed automatically)",
        default: "f26522",
        hidden: true
    },
    colorDanger: {
        type: OptionType.COMPONENT,
        description: "Color for danger range (90-100%)",
        component: () => {
            const { Forms, ColorPicker } = require("@webpack/common");
            const [color, setColor] = React.useState(parseInt(settings.store.colorDangerValue || "f23f43", 16));
            
            return (
                <Forms.FormSection>
                    <ColorPicker
                        value={color}
                        onChange={(newColor: number) => {
                            setColor(newColor);
                            settings.store.colorDangerValue = newColor.toString(16).padStart(6, '0');
                        }}
                    />
                </Forms.FormSection>
            );
        }
    },
    colorDangerValue: {
        type: OptionType.STRING,
        description: "Danger color value (managed automatically)",
        default: "f23f43",
        hidden: true
    },

    // ============ FORMATTING & DETECTION ============
    formatSettings: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ padding: "10px", background: "#2b2d31", borderRadius: "8px", marginBottom: "10px" }}>
                <h3 style={{ color: "#00d9ff", margin: "0 0 5px 0" }}>📝 Format Detection</h3>
                <p style={{ color: "#b5bac1", margin: 0, fontSize: "13px" }}>
                    Detect and display message format info
                </p>
            </div>
        )
    },
    detectCodeBlocks: {
        type: OptionType.BOOLEAN,
        description: "Show code block indicator",
        default: true,
    },
    detectMarkdown: {
        type: OptionType.BOOLEAN,
        description: "Show markdown formatting indicator",
        default: true,
    },
    detectLinks: {
        type: OptionType.BOOLEAN,
        description: "Show link count",
        default: false,
    },
    detectEmojis: {
        type: OptionType.BOOLEAN,
        description: "Show emoji count",
        default: false,
    },

    // ============ PERFORMANCE & MISC ============
    miscSettings: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <div style={{ padding: "10px", background: "#2b2d31", borderRadius: "8px", marginBottom: "10px" }}>
                <h3 style={{ color: "#00d9ff", margin: "0 0 5px 0" }}>⚙️ Miscellaneous</h3>
                <p style={{ color: "#b5bac1", margin: 0, fontSize: "13px" }}>
                    Additional settings and tweaks
                </p>
            </div>
        )
    },
    compactMode: {
        type: OptionType.BOOLEAN,
        description: "Compact display (smaller text)",
        default: false,
    },
    hideWhenEmpty: {
        type: OptionType.BOOLEAN,
        description: "Hide counter when message is empty",
        default: false,
    },
    fadeOnFocus: {
        type: OptionType.BOOLEAN,
        description: "Fade counter when not focused",
        default: false,
    },
    enableAnimations: {
        type: OptionType.BOOLEAN,
        description: "Enable smooth animations",
        default: true,
    },
    fontSize: {
        type: OptionType.SLIDER,
        description: "Font size (px)",
        default: 12,
        markers: [10, 11, 12, 13, 14, 15, 16, 18, 20],
    }
});

// ==================== UTILITY FUNCTIONS ====================
let typingStartTime = 0;
let initialCharCount = 0;
let lastCharCount = 0;
let typingSpeedCache: TypingSpeed = {
    charsPerMinute: 0,
    wordsPerMinute: 0,
    lastUpdateTime: 0
};

// ==================== DRAG & DROP STATE ====================
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let currentX = 0;
let currentY = 0;

function calculateTextStats(text: string): TextStats {
    const characters = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const sentences = text ? (text.match(/[.!?]+/g) || []).length : 0;
    const paragraphs = text ? text.split(/\n\n+/).filter(p => p.trim()).length : 0;
    const lines = text ? text.split(/\n/).length : 0;
    const spaces = (text.match(/\s/g) || []).length;
    const alphanumeric = (text.match(/[a-zA-Z0-9]/g) || []).length;

    return {
        characters,
        words,
        sentences,
        paragraphs,
        lines,
        spaces,
        alphanumeric
    };
}

function calculateTypingSpeed(currentCharCount: number): TypingSpeed {
    const now = Date.now();
    
    // Initialize typing session
    if (typingStartTime === 0 || currentCharCount < lastCharCount) {
        typingStartTime = now;
        initialCharCount = currentCharCount;
        lastCharCount = currentCharCount;
        return typingSpeedCache;
    }

    // Update every second
    if (now - typingSpeedCache.lastUpdateTime < 1000) {
        return typingSpeedCache;
    }

    const elapsedMinutes = (now - typingStartTime) / 60000;
    const charsDiff = currentCharCount - initialCharCount;
    const wordsDiff = Math.floor(charsDiff / 5); // Average word length

    if (elapsedMinutes > 0) {
        typingSpeedCache = {
            charsPerMinute: Math.round(charsDiff / elapsedMinutes),
            wordsPerMinute: Math.round(wordsDiff / elapsedMinutes),
            lastUpdateTime: now
        };
    }

    lastCharCount = currentCharCount;
    return typingSpeedCache;
}

function detectFormat(text: string): { hasCode: boolean; hasMarkdown: boolean; linkCount: number; emojiCount: number } {
    const hasCode = /```[\s\S]*?```|`[^`]+`/.test(text);
    const hasMarkdown = /(\*\*|__|~~|`|\|\|)/.test(text);
    const linkCount = (text.match(/https?:\/\/[^\s]+/g) || []).length;
    const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu) || []).length;

    return { hasCode, hasMarkdown, linkCount, emojiCount };
}

function getColorForPercentage(percentage: number): string {
    if (!settings.store.colorEffects) return "var(--text-muted)";

    if (settings.store.customColors) {
        if (percentage < 50) return `#${settings.store.colorSafeValue}`;
        if (percentage < 75) return `#${settings.store.colorWarningValue}`;
        if (percentage < 90) return `#${settings.store.colorCautionValue}`;
        return `#${settings.store.colorDangerValue}`;
    }

    // Default colors
    if (percentage < 50) return "var(--text-muted)";
    if (percentage < 75) return "var(--yellow-330)";
    if (percentage < 90) return "var(--orange-330)";
    return "var(--red-360)";
}

// ==================== DRAG & DROP FUNCTIONS ====================
function loadSavedPosition(): { x: number; y: number } | null {
    const saved = settings.store.savedPosition;
    if (!saved) return null;
    
    try {
        const parsed = JSON.parse(saved);
        return { x: parsed.x || 0, y: parsed.y || 0 };
    } catch {
        return null;
    }
}

function savePosition(x: number, y: number) {
    settings.store.savedPosition = JSON.stringify({ x, y });
}

function handleMouseDown(e: React.MouseEvent) {
    if (settings.store.counterPosition !== "moveable") return;
    
    isDragging = true;
    const savedPos = loadSavedPosition();
    dragStartX = e.clientX - (savedPos?.x || 0);
    dragStartY = e.clientY - (savedPos?.y || 0);
    
    e.preventDefault();
    e.stopPropagation();
}

function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    
    currentX = e.clientX - dragStartX;
    currentY = e.clientY - dragStartY;
    
    // Update position in real-time
    const counter = document.querySelector('.vc-char-counter-enhanced') as HTMLElement;
    if (counter) {
        counter.style.transform = `translate(${currentX}px, ${currentY}px)`;
    }
}

function handleMouseUp() {
    if (!isDragging) return;
    
    isDragging = false;
    savePosition(currentX, currentY);
}

// Setup drag listeners
if (typeof window !== "undefined") {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
}

// ==================== MAIN PLUGIN ====================
export default definePlugin({
    name: "CharacterCounterEnhanced",
    description: "Advanced character counter with statistics, typing speed, alerts, and customization",
    authors: [{ name: "Equicord Team", id: 123n }, Devs.Panniku, Devs.thororen, Devs.Mifu],
    tags: ["Chat", "Utility"],
    enabledByDefault: false,
    settings,
    managedStyle,

    patches: [
        {
            find: ".CREATE_FORUM_POST||",
            replacement: {
                match: /(textValue:.{0,50}channelId:\i\.id\}\)),\i/,
                replace: "$1,$self.getCharCounter(arguments[0].textValue)"
            }
        },
        {
            find: "#{intl::PREMIUM_MESSAGE_LENGTH_UPSELL_TOOLTIP}",
            replacement: {
                match: /return \i\?\i\(\):\i\(\)/,
                replace: "return null"
            }
        }
    ],

    getCharCounter(text: string) {
        const premiumType = (UserStore.getCurrentUser().premiumType ?? 0);
        const charMax = premiumType === 2 ? 4000 : 2000;
        const stats = calculateTextStats(text);
        const percentage = (stats.characters / charMax) * 100;
        const color = getColorForPercentage(percentage);
        const format = detectFormat(text);
        const typingSpeed = settings.store.showTypingSpeed ? calculateTypingSpeed(stats.characters) : null;

        // Hide when empty if setting enabled
        if (settings.store.hideWhenEmpty && stats.characters === 0) {
            return null;
        }

        // Determine alert state
        const shouldAlert = settings.store.enableAlerts && percentage >= settings.store.alertThreshold;
        const alertClass = shouldAlert ? `vc-char-alert-${settings.store.alertStyle}` : "";

        // Position class and style
        const isMoveable = settings.store.counterPosition === "moveable";
        const positionClass = isMoveable ? "vc-char-position-moveable" : `vc-char-position-${settings.store.counterPosition}`;
        
        // Load saved position for moveable mode
        const savedPos = isMoveable ? loadSavedPosition() : null;
        const transformStyle = isMoveable && savedPos 
            ? { transform: `translate(${savedPos.x}px, ${savedPos.y}px)` }
            : {};

        // Build display components
        const mainDisplay = (
            <div className="vc-char-main-display">
                <span className="vc-char-count">{stats.characters}</span>
                <span className="vc-char-separator">/</span>
                <span className="vc-char-max">{charMax}</span>
                {percentage > 0 && (
                    <span className="vc-char-percentage"> ({percentage.toFixed(0)}%)</span>
                )}
            </div>
        );

        const additionalStats = (
            <div className="vc-char-additional-stats">
                {settings.store.showWordCount && (
                    <span className="vc-stat-item">
                        <span className="vc-stat-icon">📝</span>
                        {stats.words}w
                    </span>
                )}
                {settings.store.showSentenceCount && stats.sentences > 0 && (
                    <span className="vc-stat-item">
                        <span className="vc-stat-icon">📄</span>
                        {stats.sentences}s
                    </span>
                )}
                {settings.store.showLineCount && stats.lines > 1 && (
                    <span className="vc-stat-item">
                        <span className="vc-stat-icon">📋</span>
                        {stats.lines}l
                    </span>
                )}
                {settings.store.showTypingSpeed && typingSpeed && typingSpeed.wordsPerMinute > 0 && (
                    <span className="vc-stat-item vc-typing-speed">
                        <span className="vc-stat-icon">⚡</span>
                        {typingSpeed.wordsPerMinute} WPM
                    </span>
                )}
            </div>
        );

        const formatIndicators = (
            <div className="vc-char-format-indicators">
                {settings.store.detectCodeBlocks && format.hasCode && (
                    <span className="vc-format-badge vc-format-code" title="Contains code">💻</span>
                )}
                {settings.store.detectMarkdown && format.hasMarkdown && (
                    <span className="vc-format-badge vc-format-markdown" title="Contains markdown">✍️</span>
                )}
                {settings.store.detectLinks && format.linkCount > 0 && (
                    <span className="vc-format-badge vc-format-link" title={`${format.linkCount} link(s)`}>
                        🔗 {format.linkCount}
                    </span>
                )}
                {settings.store.detectEmojis && format.emojiCount > 0 && (
                    <span className="vc-format-badge vc-format-emoji" title={`${format.emojiCount} emoji(s)`}>
                        😀 {format.emojiCount}
                    </span>
                )}
            </div>
        );

        const detailedTooltip = settings.store.showDetailedStats && (
            <div className="vc-char-tooltip">
                <div className="vc-tooltip-row">
                    <strong>Characters:</strong> {stats.characters} / {charMax}
                </div>
                <div className="vc-tooltip-row">
                    <strong>Words:</strong> {stats.words}
                </div>
                {stats.sentences > 0 && (
                    <div className="vc-tooltip-row">
                        <strong>Sentences:</strong> {stats.sentences}
                    </div>
                )}
                {stats.paragraphs > 1 && (
                    <div className="vc-tooltip-row">
                        <strong>Paragraphs:</strong> {stats.paragraphs}
                    </div>
                )}
                {stats.lines > 1 && (
                    <div className="vc-tooltip-row">
                        <strong>Lines:</strong> {stats.lines}
                    </div>
                )}
                <div className="vc-tooltip-row">
                    <strong>Spaces:</strong> {stats.spaces}
                </div>
                <div className="vc-tooltip-row">
                    <strong>Alphanumeric:</strong> {stats.alphanumeric}
                </div>
                {typingSpeed && typingSpeed.charsPerMinute > 0 && (
                    <>
                        <div className="vc-tooltip-divider"></div>
                        <div className="vc-tooltip-row">
                            <strong>Typing Speed:</strong>
                        </div>
                        <div className="vc-tooltip-row vc-tooltip-indent">
                            {typingSpeed.charsPerMinute} CPM
                        </div>
                        <div className="vc-tooltip-row vc-tooltip-indent">
                            {typingSpeed.wordsPerMinute} WPM
                        </div>
                    </>
                )}
            </div>
        );

        const progressBar = settings.store.showProgressBar && (
            <div className={`vc-char-progress-container vc-progress-${settings.store.progressBarStyle}`}>
                <div 
                    className="vc-char-progress-bar"
                    style={{
                        width: `${Math.min(percentage, 100)}%`,
                        backgroundColor: color
                    }}
                />
            </div>
        );

        return (
            <div 
                className={`
                    vc-char-counter-enhanced 
                    ${positionClass}
                    ${alertClass}
                    ${settings.store.compactMode ? "vc-char-compact" : ""}
                    ${settings.store.fadeOnFocus ? "vc-char-fade" : ""}
                    ${!settings.store.enableAnimations ? "vc-char-no-animations" : ""}
                    ${isMoveable ? "vc-char-draggable" : ""}
                `}
                style={{ 
                    color,
                    fontSize: `${settings.store.fontSize}px`,
                    ...transformStyle
                }}
                onMouseDown={isMoveable ? handleMouseDown : undefined}
                title={isMoveable ? "🔓 Drag to move" : undefined}
            >
                {mainDisplay}
                {(settings.store.showWordCount || settings.store.showSentenceCount || 
                  settings.store.showLineCount || settings.store.showTypingSpeed) && additionalStats}
                {(settings.store.detectCodeBlocks || settings.store.detectMarkdown || 
                  settings.store.detectLinks || settings.store.detectEmojis) && formatIndicators}
                {progressBar}
                {settings.store.showDetailedStats && detailedTooltip}
            </div>
        );
    }
});