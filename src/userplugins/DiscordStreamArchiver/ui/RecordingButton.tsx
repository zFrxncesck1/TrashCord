import {
    SelectedChannelStore,
    useEffect,
    useState,
    useStateFromStores
} from "@webpack/common";

import { sessionStore, type SessionState } from "../stores/sessionStore";
import { formatDuration } from "../utils";

function RecordIcon({ recording, disabled }: { recording: boolean; disabled: boolean }) {
    const color = disabled ? "var(--interactive-muted)" : "var(--status-danger)";
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <circle
                cx="12"
                cy="12"
                r="6"
                fill={recording ? color : "none"}
                stroke={color}
                strokeWidth="2"
            />
        </svg>
    );
}

export interface RecordingPanelButtonProps {
    nameplate?: any;
}

export interface RecordingButtonHooks {
    start: (channelId: string) => void;
    stop: () => void;
}

let hooks: RecordingButtonHooks | null = null;
export function registerRecordingButtonHooks(h: RecordingButtonHooks) { hooks = h; }

function useSessionState(): SessionState {
    const [state, setState] = useState<SessionState>(() => sessionStore.get());
    useEffect(() => sessionStore.subscribe(setState), []);
    return state;
}

const BTN_STYLE = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    padding: 0,
    margin: "0 2px",
    background: "transparent",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    color: "var(--interactive-normal, #b9bbbe)",
    // Flex parent (account panel) has limited space; keep button compact.
    flex: "0 0 auto"
} as const;

export function RecordingPanelButton(_props: RecordingPanelButtonProps) {
    const state = useSessionState();

    const voiceChannelId = useStateFromStores(
        [SelectedChannelStore],
        () => (SelectedChannelStore as any).getVoiceChannelId?.() ?? null
    ) as string | null;

    const recording = state.state === "recording";
    const inVC = !!voiceChannelId;
    const disabled = !recording && !inVC;

    const now = useTick(recording);
    const elapsedMs = recording && state.state === "recording" ? now - state.startedAt : 0;

    let tooltip: string;
    if (recording) tooltip = `Stop recording (${formatDuration(elapsedMs)})`;
    else if (inVC) tooltip = "Start recording this call";
    else tooltip = "Join a voice channel to record";

    const onClick = () => {
        if (!hooks) return;
        if (recording) hooks.stop();
        else if (inVC && voiceChannelId) hooks.start(voiceChannelId);
    };

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={tooltip}
            title={tooltip}
            aria-disabled={disabled}
            style={{
                ...BTN_STYLE,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.5 : 1,
                boxShadow: recording ? "0 0 8px var(--status-danger)" : "none"
            }}
        >
            <RecordIcon recording={recording} disabled={disabled} />
        </button>
    );
}

function useTick(active: boolean): number {
    const [ts, setTs] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const id = setInterval(() => setTs(Date.now()), 1000);
        return () => clearInterval(id);
    }, [active]);
    return ts;
}
