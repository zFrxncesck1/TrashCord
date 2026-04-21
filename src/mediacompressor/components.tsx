import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { findByCodeLazy } from "@webpack";
import { useEffect, useRef, useState } from "@webpack/common";

import {
    ensureState,
    getCompletedSummary,
    queueCompression,
    setCompressionEnabled,
    subscribeToUpload,
} from "./compression";
import type { ManagedUpload } from "./types";
import {
    buildProgressLabel,
    formatSize,
    getSizeChangeDetails,
    getTintedBackground,
    isCompressibleUpload,
} from "./utils";

const cl = classNameFactory("vc-media-compressor-");
const ActionBarIcon = findByCodeLazy("Children.map", "isValidElement", "dangerous:");

const NEUTRAL_TONE = { color: "var(--text-default)", backgroundColor: getTintedBackground("var(--text-default)") };
const MUTED_TONE = { color: "var(--text-muted)", backgroundColor: getTintedBackground("var(--text-muted)") };
const ACTIVE_TONE = { color: "var(--brand-400)", backgroundColor: getTintedBackground("var(--brand-400)") };

function useTweenedNumber(targetValue?: number, duration = 220) {
    const [displayValue, setDisplayValue] = useState<number | undefined>(targetValue);
    const frameRef = useRef<number | null>(null);
    const displayedRef = useRef<number | undefined>(targetValue);

    useEffect(() => {
        displayedRef.current = displayValue;
    }, [displayValue]);

    useEffect(() => {
        if (frameRef.current != null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }

        if (targetValue == null) {
            displayedRef.current = undefined;
            setDisplayValue(undefined);
            return;
        }

        const startValue = displayedRef.current ?? targetValue;

        if (startValue === targetValue) {
            displayedRef.current = targetValue;
            setDisplayValue(targetValue);
            return;
        }

        const startTime = performance.now();

        const step = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            const nextValue = Math.round(startValue + (targetValue - startValue) * easedProgress);

            displayedRef.current = nextValue;
            setDisplayValue(nextValue);

            if (progress < 1) {
                frameRef.current = requestAnimationFrame(step);
            } else {
                frameRef.current = null;
            }
        };

        frameRef.current = requestAnimationFrame(step);

        return () => {
            if (frameRef.current != null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };
    }, [targetValue, duration]);

    return displayValue;
}

function useCompressionState(upload: ManagedUpload) {
    const [, forceRender] = useState(0);
    const compressible = isCompressibleUpload(upload);

    useEffect(() => {
        return subscribeToUpload(upload, () => {
            forceRender(value => value + 1);
        });
    }, [upload]);

    // ensureState relies on internal side-effects/WeakMap, so we keep it under the condition
    const state = compressible ? ensureState(upload) : null;

    useEffect(() => {
        if (state?.enabled && state.status === "idle" && !state.compressedFile) {
            queueCompression(upload);
        }
    }, [state, upload]);

    if (!compressible) return null;

    return state;
}

function CompressionIcon({ enabled }: { enabled: boolean; }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox={enabled ? "0 0 640 640" : "0 0 24 24"}
            style={{ color: enabled ? "var(--status-positive)" : "var(--interactive-normal)" }}
        >
            {enabled ? (
                <path fill="currentColor" d="M503.5 71c9.4-9.4 24.6-9.4 33.9 0l32 32c9.4 9.4 9.4 24.6 0 33.9l-87 87 39 39c6.9 6.9 8.9 17.2 5.2 26.2S514.2 304 504.5 304h-144c-13.3 0-24-10.7-24-24V136c0-9.7 5.8-18.5 14.8-22.2s19.3-1.7 26.2 5.2l39 39zm-367 265h144c13.3 0 24 10.7 24 24v144c0 9.7-5.8 18.5-14.8 22.2s-19.3 1.7-26.2-5.2l-39-39-87 87c-9.4 9.4-24.6 9.4-33.9 0l-32-32c-9.4-9.4-9.4-24.6 0-33.9l87-87-39-39c-6.9-6.9-8.9-17.2-5.2-26.2s12.4-14.9 22.1-14.9" />
            ) : (
                <path fill="currentColor" d="M2.883 5.36a1.25 1.25 0 0 1 0-1.767l.707-.707a1.25 1.25 0 0 1 1.768 0l15.768 15.768a1.25 1.25 0 0 1 0 1.768l-.707.707a1.25 1.25 0 0 1-1.768 0zM11.418 16.724v2.178a.9.9 0 0 1-1.538.637l-1.462-1.463-3.262 3.263a.897.897 0 0 1-1.272 0l-1.2-1.2a.896.896 0 0 1 0-1.27l3.263-3.263-1.463-1.463a.9.9 0 0 1-.194-.982.9.9 0 0 1 .828-.56h2.177zM18.88 2.664a.896.896 0 0 1 1.272 0l1.2 1.2a.897.897 0 0 1 0 1.272L18.09 8.398l1.462 1.463a.9.9 0 0 1 .196.982.9.9 0 0 1-.83.559h-2.214l-4.085-4.085V5.102a.9.9 0 0 1 1.538-.638l1.462 1.463z" />
            )}
        </svg>
    );
}

function CompressionSpinner() {
    return (
        <svg className={cl("spinner")} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity="0.325" />
            <path fill="currentColor" d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z">
                <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12" />
            </path>
        </svg>
    );
}

export const UploadButton = ErrorBoundary.wrap(({ upload }: { upload: ManagedUpload; }) => {
    const state = useCompressionState(upload);
    if (!state) return null;

    const tooltip = state.enabled ? "Compression Enabled" : "Compression Disabled";

    return (
        <ActionBarIcon
            tooltip={tooltip}
            onClick={() => setCompressionEnabled(upload, !state.enabled)}
        >
            <CompressionIcon enabled={state.enabled} />
        </ActionBarIcon>
    );
}, { noop: true });

export const UploadStatus = ErrorBoundary.wrap(({ upload }: { upload: ManagedUpload; }) => {
    const state = useCompressionState(upload);
    if (!state) return null;

    const isActiveCompression = state.status === "preparing" || state.status === "compressing";
    const progressVisible = isActiveCompression;
    const progressPercent = Math.max(4, Math.round(state.progress * 100));
    const completedSummary = state.status === "done" ? getCompletedSummary(state) : null;

    const displayedSizeBytes = useTweenedNumber(
        state.status === "done"
            ? state.compressedFile?.size ?? state.latestPassBytes ?? state.originalFile.size
            : state.latestPassBytes ?? state.originalFile.size
    );

    let animatedCompletedSummary = completedSummary;
    if (completedSummary && displayedSizeBytes != null) {
        const change = getSizeChangeDetails(state.originalFile.size, displayedSizeBytes);
        animatedCompletedSummary = {
            originalSize: formatSize(state.originalFile.size),
            compressedSize: change.text,
            color: change.color,
            backgroundColor: change.backgroundColor,
        };
    }

    const displayedRightTone = animatedCompletedSummary
        ? { color: animatedCompletedSummary.color, backgroundColor: animatedCompletedSummary.backgroundColor }
        : ACTIVE_TONE;

    const rightPillText = animatedCompletedSummary
        ? animatedCompletedSummary.compressedSize
        : formatSize(displayedSizeBytes ?? state.originalFile.size);

    const activePass = state.currentPass ?? 1;

    const renderPill = (text: string, tone: { color: string; backgroundColor: string; }, withSpinner = false) => (
        <div className={cl("pill")} style={{ color: tone.color, backgroundColor: tone.backgroundColor }}>
            {withSpinner && <CompressionSpinner />}
            {text}
        </div>
    );

    if (!state.enabled && state.status !== "failed") return null;

    return (
        <div className={cl("status")}>
            {progressVisible && (
                <div className={cl("progress-track")}>
                    <div
                        className={classes(cl("progress-fill"), state.status === "failed" && cl("progress-fill-failed"))}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            )}
            {animatedCompletedSummary ? (
                <div className={cl("info-grid")}>
                    <div className={cl("label")}>Initial size</div>
                    <div className={classes(cl("label"), cl("label-right"))}>Compressed size</div>
                    <div className={cl("grid-cell")}>
                        {renderPill(animatedCompletedSummary.originalSize, NEUTRAL_TONE)}
                    </div>
                    <div className={cl("grid-end")}>
                        {renderPill(rightPillText, displayedRightTone)}
                    </div>
                </div>
            ) : state.status === "failed" ? (
                <div className={cl("error")}>
                    {buildProgressLabel(state)}
                </div>
            ) : (
                <div className={cl("info-grid")}>
                    <div className={cl("label")}>
                        {state.status === "compressing"
                            ? `Compressing... ${progressPercent}%`
                            : "Preparing..."}
                    </div>
                    <div className={classes(cl("label"), cl("label-right"))}>Final size</div>
                    <div className={cl("grid-cell")}>
                        {renderPill(`Pass #${activePass}`, MUTED_TONE)}
                    </div>
                    <div className={cl("grid-end")}>
                        {renderPill(rightPillText, displayedRightTone, true)}
                    </div>
                </div>
            )}
        </div>
    );
}, { noop: true });
