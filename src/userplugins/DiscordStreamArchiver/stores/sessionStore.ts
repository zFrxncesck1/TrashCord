// Tiny subscribable store of current recording state.
// Shared by RecordingSession (writes) and UI (reads via useSyncExternalStore).

export type SessionTrigger = "manual" | "channel" | "user" | "stream-anchor";

export type SessionState =
    | { state: "idle" }
    | {
        state: "recording";
        handle: number;
        channelId: string;
        channelName: string;
        startedAt: number;
        anchorStreamKey: string | null;
        trigger: SessionTrigger;
      }
    | { state: "error"; message: string };

type Listener = (s: SessionState) => void;

class SessionStore {
    private current: SessionState = { state: "idle" };
    private listeners = new Set<Listener>();

    get(): SessionState {
        return this.current;
    }

    set(next: SessionState): void {
        this.current = next;
        this.listeners.forEach(l => l(next));
    }

    subscribe(l: Listener): () => void {
        this.listeners.add(l);
        return () => { this.listeners.delete(l); };
    }
}

export const sessionStore = new SessionStore();
