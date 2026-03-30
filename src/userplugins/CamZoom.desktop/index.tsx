/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const STYLE_ID   = "vc-camzoom-style";
const MARK       = "vcCamzoom";
const P          = "vc-camzoom";
const HIDE_DELAY = 2000;

const settings = definePluginSettings({
    maxZoom: {
        type: OptionType.SLIDER,
        description: "Maximum zoom level",
        default: 5,
        markers: [2, 3, 4, 5, 8, 10],
    },
    zoomSpeed: {
        type: OptionType.SLIDER,
        description: "Scroll wheel sensitivity",
        default: 0.3,
        markers: [0.05, 0.1, 0.15, 0.3, 0.5],
    },
    minimapWidth: {
        type: OptionType.SLIDER,
        description: "Minimap width (px)",
        default: 200,
        markers: [100, 130, 160, 200, 240],
    },
    autoMobileCamView: {
        type: OptionType.BOOLEAN,
        description: "Automatically adapt minimap shape for portrait (mobile) cameras",
        default: true,
    },
    forceMirror: {
        type: OptionType.BOOLEAN,
        description: "Force camera to be mirrored. Leave OFF if NoMirroredCamera is enabled.",
        default: false,
    },
    doubleClickReset: {
        type: OptionType.BOOLEAN,
        description: "Double-click on video to reset zoom",
        default: false,
    },
    middleClickReset: {
        type: OptionType.BOOLEAN,
        description: "Middle-click to reset zoom",
        default: false,
    },
    smoothTransition: {
        type: OptionType.BOOLEAN,
        description: "Animate zoom transitions",
        default: false,
    },
    invertScroll: {
        type: OptionType.BOOLEAN,
        description: "Invert scroll direction",
        default: false,
    },
});

interface ZoomState {
    scale: number; panX: number; panY: number;
    dragging: boolean; lastX: number; lastY: number;
}
interface TileEntry { s: ZoomState; setZoom: (v: number) => void; kill: () => void; src: HTMLVideoElement; mobile: boolean; }

const tiles = new WeakMap<Element, TileEntry>();
let observer: MutationObserver | null = null;
let scanInterval: ReturnType<typeof setInterval> | null = null;
let observerDebounce: ReturnType<typeof setTimeout> | null = null;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampPan(wr: HTMLElement, s: ZoomState) {
    const ex = wr.offsetWidth  * (s.scale - 1) / 2;
    const ey = wr.offsetHeight * (s.scale - 1) / 2;
    s.panX = clamp(s.panX, -ex, ex);
    s.panY = clamp(s.panY, -ey, ey);
}

function shouldMirror(vid: HTMLElement): boolean {
    if (settings.store.forceMirror) return true;
    return [...vid.classList].some(c => c.startsWith("mirror"));
}

function applyTransform(vid: HTMLElement, wr: HTMLElement, s: ZoomState, entry: TileEntry) {
    const tr  = settings.store.smoothTransition ? "transform 0.1s ease-out" : "none";
    const mir = shouldMirror(vid) ? " scaleX(-1)" : "";
    vid.style.transform       = `translate(${s.panX}px,${s.panY}px) scale(${s.scale})${mir}`;
    vid.style.transformOrigin = "center center";
    vid.style.transition      = tr;
    wr.classList.toggle(`${P}-zoomed`, s.scale > 1.001);
    entry.setZoom(s.scale);
}

function updateIndicator(wr: HTMLElement, s: ZoomState, ind: HTMLElement) {
    const mm = ind.parentElement!;
    const mW = mm.clientWidth, mH = mm.clientHeight;
    if (!mW || !mH || s.scale <= 1.001) {
        ind.style.cssText = "width:100%;height:100%;left:0;top:0;";
        return;
    }
    const iW   = Math.floor(mW / s.scale);
    const iH   = Math.floor(mH / s.scale);
    const rawL = mW / 2 - iW / 2 - s.panX * mW / (wr.offsetWidth  * s.scale);
    const rawT = mH / 2 - iH / 2 - s.panY * mH / (wr.offsetHeight * s.scale);
    const left = Math.round(clamp(rawL, 0, mW - iW));
    const top  = Math.round(clamp(rawT, 0, mH - iH));
    ind.style.width  = `${iW}px`;
    ind.style.height = `${iH}px`;
    ind.style.left   = `${left}px`;
    ind.style.top    = `${top}px`;
}

function isScreenshare(tile: HTMLElement): boolean {
    if (tile.querySelector('[class*="liveIndicator"]')) return true;
    const ft = tile.querySelector('[class*="focusTarget"]');
    return !!ft?.getAttribute("aria-label")?.toLowerCase().includes("streaming");
}

function findVid(tile: HTMLElement): { vid: HTMLElement; src: HTMLVideoElement; } | null {
    for (const wr of tile.querySelectorAll<HTMLElement>('[class*="videoWrapper"]')) {
        const vid = wr.querySelector<HTMLElement>('[class*="media-engine-video"]');
        const src = vid?.querySelector<HTMLVideoElement>("video");
        if (vid && src) return { vid, src };
    }
    return null;
}

function findWrapper(tile: HTMLElement): HTMLElement | null {
    return tile.querySelector<HTMLElement>('[class*="videoWrapper"]');
}

function isMobileCam(tile: HTMLElement, src?: HTMLVideoElement): boolean {
    if (!settings.store.autoMobileCamView) return false;

    if (src && src.videoWidth > 0 && src.videoHeight > 0)
        return src.videoHeight > src.videoWidth;

    const sizer = tile.closest<HTMLElement>('[class*="videoSizer"]');
    if (sizer) {
        const ar = sizer.style.aspectRatio || sizer.style.getPropertyValue("aspect-ratio");
        if (ar && ar.trim() !== "") {
            const parts = ar.split("/");
            const w = parseFloat(parts[0].trim());
            const h = parseFloat((parts[1] ?? "1").trim());
            if (!isNaN(w) && !isNaN(h) && h > 0) return (w / h) < 1;
        }
        if (sizer.offsetWidth > 0 && sizer.offsetHeight > 0)
            return sizer.offsetHeight > sizer.offsetWidth;
    }

    const vwrap = tile.closest<HTMLElement>('[class*="videoWrapper__"]');
    if (vwrap && vwrap.offsetWidth > 0 && vwrap.offsetHeight > 0)
        return vwrap.offsetHeight > vwrap.offsetWidth;

    return false;
}

const SVG_IN  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" clip-rule="evenodd"/><path fill="currentColor" d="M11 7a1 1 0 1 0-2 0v2H7a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2V7Z"/></svg>`;
const SVG_OUT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" clip-rule="evenodd"/><path fill="currentColor" d="M6 10a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2H7a1 1 0 0 1-1-1Z"/></svg>`;

function initTile(tile: HTMLElement) {
    if (tile.dataset[MARK] || isScreenshare(tile)) return;

    const found   = findVid(tile);
    const wrapper = findWrapper(tile);

    if (!found || !wrapper) return;

    const { vid, src } = found;

    tile.dataset[MARK]     = "1";
    wrapper.style.overflow = "hidden";
    wrapper.style.position = "relative";
    wrapper.classList.add(`${P}-host`);

    const mobile = isMobileCam(tile, src);

    const s: ZoomState = { scale: 1, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0 };
    const max = settings.store.maxZoom;
    const mmW = mobile ? Math.round(settings.store.minimapWidth * 9 / 16) : settings.store.minimapWidth;
    const mmH = mobile ? settings.store.minimapWidth : Math.round(settings.store.minimapWidth * 9 / 16);

    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let panelVisible = false;

    const showPanel = () => {
        if (!panelVisible) return;
        panel.style.opacity       = "0.999";
        panel.style.pointerEvents = "auto";
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            panel.style.opacity       = "0";
            panel.style.pointerEvents = "none";
        }, HIDE_DELAY);
    };

    const cancelHide = () => {
        if (!panelVisible) return;
        panel.style.opacity       = "0.999";
        panel.style.pointerEvents = "auto";
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    };

    const stopHideTimer = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
    };

    const minimap = document.createElement("div");
    minimap.className    = `${P}-minimap`;
    minimap.style.width  = `${mmW}px`;
    minimap.style.height = `${mmH}px`;
    if (mobile) minimap.classList.add(`${P}-minimap-portrait`);

    const mmVid = document.createElement("video");
    mmVid.autoplay = true; mmVid.muted = true; mmVid.playsInline = true;
    mmVid.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;";

    const applyMirror = () => { mmVid.style.transform = shouldMirror(vid) ? "scaleX(-1)" : ""; };
    applyMirror();

    const syncStream = () => {
        if (src.srcObject && mmVid.srcObject !== src.srcObject) {
            mmVid.srcObject = src.srcObject;
            applyMirror();
        }
    };
    src.addEventListener("loadedmetadata", syncStream);
    const syncTimer = setInterval(syncStream, 4000);
    syncStream();

    const ind = document.createElement("div");
    ind.className = `${P}-ind`;
    minimap.append(mmVid, ind);

    let mmDragging = false, mmLastX = 0, mmLastY = 0;
    let mmRafPending = false;

    minimap.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        if (s.scale <= 1) return;
        const ir  = ind.getBoundingClientRect();
        const TOL = Math.max(6, Math.min(ir.width, ir.height) * 0.25);
        if (e.clientX < ir.left - TOL || e.clientX > ir.right  + TOL ||
            e.clientY < ir.top  - TOL || e.clientY > ir.bottom + TOL) return;
        minimap.setPointerCapture(e.pointerId);
        mmDragging = true; mmLastX = e.clientX; mmLastY = e.clientY;
        minimap.classList.add(`${P}-mm-dragging`);
    });

    minimap.addEventListener("pointermove", e => {
        cancelHide();
        if (!mmDragging || mmRafPending) return;
        const cx = e.clientX, cy = e.clientY;
        mmRafPending = true;
        requestAnimationFrame(() => {
            mmRafPending = false;
            const dx = cx - mmLastX, dy = cy - mmLastY;
            mmLastX = cx; mmLastY = cy;
            s.panX -= dx * (wrapper.offsetWidth  * s.scale) / minimap.clientWidth;
            s.panY -= dy * (wrapper.offsetHeight * s.scale) / minimap.clientHeight;
            clampPan(wrapper, s); applyTransform(vid, wrapper, s, entry);
            updateIndicator(wrapper, s, ind);
        });
    });

    const stopMmDrag = (e: PointerEvent) => {
        mmDragging = false;
        minimap.classList.remove(`${P}-mm-dragging`);
        if (minimap.hasPointerCapture(e.pointerId)) minimap.releasePointerCapture(e.pointerId);
    };
    minimap.addEventListener("pointerup",     stopMmDrag);
    minimap.addEventListener("pointercancel", stopMmDrag);
    minimap.addEventListener("click", e => { e.stopImmediatePropagation(); }, true);

    const mkBtn = (svg: string, label: string) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = `${P}-btn`;
        b.setAttribute("aria-label", label);
        b.innerHTML = `<div class="${P}-btn-inner">${svg}</div>`;
        b.addEventListener("click", ev => ev.stopImmediatePropagation(), true);
        return b;
    };
    const btnMinus = mkBtn(SVG_OUT, "Zoom out");
    const btnPlus  = mkBtn(SVG_IN,  "Zoom in");

    const sliderWrap  = document.createElement("div");
    sliderWrap.className = `${P}-slider-wrap`;
    const sliderTrack = document.createElement("div");
    sliderTrack.className = `${P}-slider-track`;
    const sliderFill  = document.createElement("div");
    sliderFill.className = `${P}-slider-fill`;
    const sliderGrab  = document.createElement("div");
    sliderGrab.className = `${P}-slider-grab`;
    const tooltip = document.createElement("div");
    tooltip.className = `${P}-tooltip`;
    tooltip.textContent = "100%";

    sliderTrack.append(sliderFill, sliderGrab, tooltip);
    sliderTrack.addEventListener("click", e => e.stopImmediatePropagation(), true);
    sliderWrap.appendChild(sliderTrack);

    const row = document.createElement("div");
    row.className = `${P}-row`;
    row.addEventListener("click", e => { if (e.target === row) e.stopImmediatePropagation(); }, true);
    row.append(btnMinus, sliderWrap, btnPlus);

    const panel = document.createElement("div");
    panel.className = `${P}-panel`;
    panel.append(minimap, row);
    panel.addEventListener("pointerenter", cancelHide);
    panel.addEventListener("pointerleave", showPanel);

    wrapper.appendChild(panel);

    const updateSlider = (v: number) => {
        const pct = Math.round(((v - 1) / (max - 1)) * 1000) / 10;
        const pctStr = `${pct}%`;
        sliderFill.style.width = pctStr;
        sliderGrab.style.left  = pctStr;
        tooltip.style.left     = pctStr;
        tooltip.textContent    = `${Math.round(v * 100)}%`;
        btnMinus.disabled = v <= 1.001;
        btnPlus.disabled  = v >= max - 0.001;
    };

    const setZoom = (v: number) => {
        updateSlider(v);
        panelVisible = v > 1.001;
        if (panelVisible) {
            showPanel();
            updateIndicator(wrapper, s, ind);
        } else {
            ind.style.cssText = "width:100%;height:100%;left:0;top:0;";
            panel.style.opacity       = "0.999";
            panel.style.pointerEvents = "auto";
            stopHideTimer();
            hideTimer = setTimeout(() => {
                panel.style.opacity       = "0";
                panel.style.pointerEvents = "none";
            }, 1500);
        }
    };

    const entry: TileEntry = { s, setZoom, kill: () => {}, src, mobile };
    tiles.set(tile, entry);

    const onVideoMeta = () => {
        if (isMobileCam(tile, src) !== entry.mobile) {
            cleanupTile(tile);
            initTile(tile);
        }
    };
    src.addEventListener("loadedmetadata", onVideoMeta);

    const sliderFromPtr = (e: PointerEvent) => {
        const r = sliderTrack.getBoundingClientRect();
        return clamp(1 + ((e.clientX - r.left) / r.width) * (max - 1), 1, max);
    };

    sliderTrack.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        sliderTrack.setPointerCapture(e.pointerId);
        sliderWrap.classList.add(`${P}-sliding`);
        const lock = document.createElement("style");
        lock.id = `${P}-cursor-lock`;
        lock.textContent = `* { cursor: ew-resize !important; }`;
        document.head.appendChild(lock);
        cancelHide();
        const v = sliderFromPtr(e);
        s.scale = v; if (v <= 1) { s.panX = 0; s.panY = 0; }
        clampPan(wrapper, s); applyTransform(vid, wrapper, s, entry);
        const onMove = (ev: PointerEvent) => {
            const vv = sliderFromPtr(ev);
            s.scale = vv; if (vv <= 1) { s.panX = 0; s.panY = 0; }
            clampPan(wrapper, s); applyTransform(vid, wrapper, s, entry);
        };
        sliderTrack.addEventListener("pointermove", onMove);
        sliderTrack.addEventListener("pointerup", () => {
            sliderTrack.removeEventListener("pointermove", onMove);
            sliderWrap.classList.remove(`${P}-sliding`);
            document.getElementById(`${P}-cursor-lock`)?.remove();
        }, { once: true });
    });

    const step = () => (max - 1) / 8;

    btnMinus.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        cancelHide();
        s.scale = clamp(s.scale - step(), 1, max);
        if (s.scale <= 1) { s.panX = 0; s.panY = 0; }
        clampPan(wrapper, s); applyTransform(vid, wrapper, s, entry);
    });

    btnPlus.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        cancelHide();
        s.scale = clamp(s.scale + step(), 1, max);
        clampPan(wrapper, s); applyTransform(vid, wrapper, s, entry);
    });

    let wheelRafPending = false;
    let pendingDeltaY = 0;
    let pendingClientX = 0, pendingClientY = 0;

    const onWheel = (e: WheelEvent) => {
        if (panel.contains(e.target as Node)) return;
        e.preventDefault();
        showPanel();
        const dir = settings.store.invertScroll ? 1 : -1;
        pendingDeltaY += e.deltaY;
        pendingClientX = e.clientX;
        pendingClientY = e.clientY;
        if (wheelRafPending) return;
        wheelRafPending = true;
        requestAnimationFrame(() => {
            wheelRafPending = false;
            const delta = dir * pendingDeltaY * settings.store.zoomSpeed * 0.01;
            pendingDeltaY = 0;
            const next = clamp(s.scale * (1 + delta), 1, max);
            if (next === s.scale) return;
            const rect  = wrapper.getBoundingClientRect();
            const ratio = next / s.scale;
            s.panX  = (pendingClientX - rect.left - rect.width  / 2) * (1 - ratio) + s.panX * ratio;
            s.panY  = (pendingClientY - rect.top  - rect.height / 2) * (1 - ratio) + s.panY * ratio;
            s.scale = next;
            if (s.scale <= 1) { s.panX = 0; s.panY = 0; }
            clampPan(wrapper, s); applyTransform(vid, wrapper, s, entry);
        });
    };

    let dragDist = 0;
    const THRESH = 5;
    let dragRafPending = false;
    let pendingDX = 0, pendingDY = 0;
    let pendingCX = 0, pendingCY = 0;

    const onPointerDown = (e: PointerEvent) => {
        if (panel.contains(e.target as Node)) return;
        if (e.button === 1 && settings.store.middleClickReset) {
            e.preventDefault();
            s.scale = 1; s.panX = 0; s.panY = 0;
            applyTransform(vid, wrapper, s, entry);
            return;
        }
        if (e.button !== 0 || s.scale <= 1) return;
        e.preventDefault();
        dragDist = 0; pendingDX = 0; pendingDY = 0;
        wrapper.setPointerCapture(e.pointerId);
        s.dragging = true; s.lastX = e.clientX; s.lastY = e.clientY;
        wrapper.classList.add(`${P}-dragging`);
    };

    const onPointerMove = (e: PointerEvent) => {
        if (!s.dragging) return;
        const dx = e.clientX - s.lastX, dy = e.clientY - s.lastY;
        dragDist += Math.hypot(dx, dy);
        pendingDX += dx; pendingDY += dy;
        pendingCX = e.clientX; pendingCY = e.clientY;
        s.lastX = e.clientX; s.lastY = e.clientY;
        if (dragRafPending) return;
        dragRafPending = true;
        requestAnimationFrame(() => {
            dragRafPending = false;
            s.panX += pendingDX; s.panY += pendingDY;
            pendingDX = 0; pendingDY = 0;
            clampPan(wrapper, s); applyTransform(vid, wrapper, s, entry);
            showPanel();
        });
    };

    const onPointerUp = (e: PointerEvent) => {
        if (!s.dragging) return;
        s.dragging = false;
        wrapper.classList.remove(`${P}-dragging`);
        if (wrapper.hasPointerCapture(e.pointerId)) wrapper.releasePointerCapture(e.pointerId);
    };

    const onPointerClick = (e: MouseEvent) => {
        if (panel.contains(e.target as Node)) return;
        if (dragDist > THRESH) { e.stopImmediatePropagation(); dragDist = 0; }
    };

    const onDblClick = (e: MouseEvent) => {
        if (panel.contains(e.target as Node)) return;
        if (dragDist > THRESH) { dragDist = 0; return; }
        if (!settings.store.doubleClickReset) return;
        s.scale = 1; s.panX = 0; s.panY = 0;
        applyTransform(vid, wrapper, s, entry);
    };

    const onMouseMove = () => { if (panelVisible) showPanel(); };

    wrapper.addEventListener("wheel",         onWheel,        { passive: false });
    wrapper.addEventListener("pointerdown",   onPointerDown);
    wrapper.addEventListener("pointermove",   onPointerMove);
    wrapper.addEventListener("pointerup",     onPointerUp);
    wrapper.addEventListener("pointercancel", onPointerUp);
    wrapper.addEventListener("click",         onPointerClick, true);
    wrapper.addEventListener("dblclick",      onDblClick);
    tile.addEventListener("mousemove",        onMouseMove);

    entry.kill = () => {
        stopHideTimer();
        document.getElementById(`${P}-cursor-lock`)?.remove();
        clearInterval(syncTimer);
        src.removeEventListener("loadedmetadata", syncStream);
        src.removeEventListener("loadedmetadata", onVideoMeta);
        wrapper.removeEventListener("wheel",         onWheel);
        wrapper.removeEventListener("pointerdown",   onPointerDown);
        wrapper.removeEventListener("pointermove",   onPointerMove);
        wrapper.removeEventListener("pointerup",     onPointerUp);
        wrapper.removeEventListener("pointercancel", onPointerUp);
        wrapper.removeEventListener("click",         onPointerClick, true);
        wrapper.removeEventListener("dblclick",      onDblClick);
        tile.removeEventListener("mousemove",        onMouseMove);
        panel.remove();
        wrapper.classList.remove(`${P}-host`, `${P}-zoomed`, `${P}-dragging`);
        vid.style.transform = vid.style.transition = vid.style.transformOrigin = "";
        wrapper.style.overflow = "";
        delete tile.dataset[MARK];
        tiles.delete(tile);
    };
}

function cleanupTile(tile: HTMLElement) { tiles.get(tile)?.kill(); }

function scanAllTiles() {
    document.querySelectorAll<HTMLElement>("[data-selenium-video-tile]").forEach(tile => {
        if (tile.dataset[MARK]) {
            const entry = tiles.get(tile);
            const mobileNow = isMobileCam(tile, entry?.src);
            if (isScreenshare(tile) || !entry?.src.isConnected ||
                (settings.store.autoMobileCamView && entry && entry.mobile !== mobileNow)) {
                cleanupTile(tile);
                if (!isScreenshare(tile)) initTile(tile);
            }
        } else {
            initTile(tile);
        }
    });
}

const CSS = `
.${P}-host { user-select: none; cursor: default; }
.${P}-host.${P}-dragging { cursor: grabbing !important; }
.${P}-host [class*="media-engine-video"] { will-change: transform; }

.${P}-panel {
    position: absolute;
    bottom: 10px; right: 10px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    border-radius: 6px;
    overflow: visible;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    z-index: 25;
}

.${P}-minimap {
    position: relative;
    background: #000;
    border-radius: 6px 6px 0 0;
    overflow: hidden;
    flex-shrink: 0;
    cursor: default;
    border: 1px solid rgba(255,255,255,0.15);
    border-bottom: none;
}
.${P}-minimap.${P}-mm-dragging { cursor: grabbing; }

.${P}-minimap-portrait {
    border-radius: 6px 6px 0 0;
}

.${P}-ind {
    position: absolute;
    border: 2px solid #5865F2;
    background: rgba(88,101,242,0.15);
    box-sizing: border-box;
    border-radius: 2px;
    cursor: grab;
    pointer-events: auto;
    transition: left 0.08s ease-out, top 0.08s ease-out,
                width 0.08s ease-out, height 0.08s ease-out;
}
.${P}-mm-dragging .${P}-ind { cursor: grabbing; }

.${P}-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0,0,0,0.75);
    backdrop-filter: blur(8px);
    padding: 7px 10px;
    border-radius: 0 0 6px 6px;
    cursor: default;
}

.${P}-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    color: #fff;
    width: 26px; height: 26px;
    padding: 0;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s;
}
.${P}-btn:hover:not(:disabled) { background: rgba(255,255,255,0.22); }
.${P}-btn:disabled { opacity: 0.3; cursor: default; pointer-events: none; }
.${P}-btn-inner { display: flex; align-items: center; justify-content: center; }
.${P}-btn svg   { pointer-events: none; display: block; }

.${P}-slider-wrap { flex: 1; position: relative; }

.${P}-slider-track {
    width: 100%;
    height: 4px;
    background: rgba(88,101,242,0.3);
    border-radius: 2px;
    position: relative;
    cursor: ew-resize;
}

.${P}-slider-fill {
    height: 100%;
    background: #5865F2;
    border-radius: 2px;
    pointer-events: none;
}

.${P}-slider-grab {
    position: absolute;
    top: 50%; transform: translate(-50%, -50%);
    width: 12px; height: 12px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid #5865F2;
    box-shadow: 0 0 0 3px rgba(88,101,242,0.25);
    pointer-events: none;
}

.${P}-tooltip {
    position: absolute;
    bottom: calc(100% + 15px);
    transform: translateX(-50%);
    background: #131416;
    color: #fff;
    font-size: 13px;
    letter-spacing: 0.02em;
    padding: 5px 10px;
    border-radius: 5px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s;
    font-family: var(--font-primary, sans-serif);
    box-shadow: 0 2px 10px rgba(0,0,0,0.8);
    z-index: 30;
}
.${P}-tooltip::after {
    content: "";
    position: absolute;
    top: 100%; left: 50%; transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: #0d0d0d;
}
.${P}-slider-wrap.${P}-sliding .${P}-slider-track { cursor: grabbing; }
.${P}-slider-wrap.${P}-sliding { cursor: grabbing; }
.${P}-slider-wrap:hover .${P}-tooltip,
.${P}-slider-wrap.${P}-sliding .${P}-tooltip { opacity: 1; }
`;

export default definePlugin({
    name: "CamZoom",
    description: "Scroll-to-zoom & drag-to-pan on webcam tiles. Real-time PiP overlay. Auto portrait minimap for mobile cameras. Compatible with NoMirroredCamera. Screenshares excluded.",
    authors: [{ name: "zFrxncesck1", id: 456195985404592149n }],
    settings,

    start() {
        const style = document.createElement("style");
        style.id = STYLE_ID; style.textContent = CSS;
        document.head.appendChild(style);

        scanAllTiles();

        observer = new MutationObserver(() => {
            if (observerDebounce) return;
            observerDebounce = setTimeout(() => {
                observerDebounce = null;
                scanAllTiles();
            }, 150);
        });
        observer.observe(document.body, { childList: true, subtree: true });

        scanInterval = setInterval(scanAllTiles, 5000);
    },

    stop() {
        if (observerDebounce) { clearTimeout(observerDebounce); observerDebounce = null; }
        document.querySelectorAll<HTMLElement>("[data-selenium-video-tile]").forEach(cleanupTile);
        observer?.disconnect();
        observer = null;
        if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
        document.getElementById(STYLE_ID)?.remove();
    },
});
