import { GradientStore } from "./store";
import { FetchQueue } from "./fetchQueue";
import { FluxDispatcher, UserStore } from "@webpack/common";
import { decode } from "./encoding";
import { findByPropsLazy } from "@webpack";
import { loadPrefs, savePrefs, Prefs } from "./storage";

let prefsCache: Prefs = { enabled: true, mutedUsers: [], mutedGuilds: [] };
const prefsListeners = new Set<() => void>();

export function getPrefs(): Prefs { return prefsCache; }

export async function hydratePrefs(): Promise<void> {
    prefsCache = await loadPrefs();
}

export function subscribePrefs(cb: () => void): () => void {
    prefsListeners.add(cb);
    return () => prefsListeners.delete(cb);
}

export async function updatePrefs(patch: Partial<Prefs>): Promise<void> {
    prefsCache = { ...prefsCache, ...patch };
    await savePrefs(prefsCache);
    for (const cb of Array.from(prefsListeners)) cb();
}

export const SelectedGuildStore: any = findByPropsLazy("getLastSelectedGuildId", "getGuildId");

const UserProfileActions: any = findByPropsLazy("fetchProfile");
const UserProfileStore: any = findByPropsLazy("getUserProfile");

export const fetchQueue = new FetchQueue({
    maxConcurrent: 3,
    minGapMs: 200,
    backoffMs: 5 * 60_000,
    fetcher: async (userId) => {
        await UserProfileActions.fetchProfile(userId);
    },
});

export const gradientStore = new GradientStore({
    ttlMs: 60_000,
    onMiss: (userId) => fetchQueue.enqueue(userId),
});

export function onProfileFetchSuccess(payload: { userId: string }) {
    const profile = UserProfileStore.getUserProfile(payload.userId);
    const bio: string = profile?.bio ?? "";
    const selfId = UserStore.getCurrentUser()?.id;
    if (payload.userId === selfId) {
        // Diagnose: show codepoints of bio so we can see if zero-width chars survived.
        const codepoints = Array.from(bio).map(c => c.codePointAt(0)?.toString(16)).join(" ");
        console.log("[GradientNickname] self bio fetched, length=", bio.length,
            "raw=", JSON.stringify(bio), "codepoints=", codepoints);
    }
    const cfg = decode(bio);
    if (payload.userId === selfId) {
        console.log("[GradientNickname] self bio decoded =", cfg);
    }
    if (cfg) gradientStore.set(payload.userId, cfg);
    else gradientStore.setNull(payload.userId);
}

// Self bio change paths: USER_UPDATE fires when the current user edits their
// own profile (including bio). USER_PROFILE_UPDATE_SUCCESS fires after the
// profile PATCH (paste-into-About-Me triggers this once Discord saves).
function onSelfProfileChanged() {
    const selfId = UserStore.getCurrentUser()?.id;
    if (!selfId) return;
    // Re-fetch to make sure UserProfileStore has the latest bio, then decode.
    try { fetchQueue.enqueue(selfId); } catch {}
    onProfileFetchSuccess({ userId: selfId });
}

export function subscribeFlux() {
    FluxDispatcher.subscribe("USER_PROFILE_FETCH_SUCCESS", onProfileFetchSuccess);
    FluxDispatcher.subscribe("USER_UPDATE", onSelfProfileChanged);
    FluxDispatcher.subscribe("USER_PROFILE_UPDATE_SUCCESS", onSelfProfileChanged);
    FluxDispatcher.subscribe("CURRENT_USER_UPDATE", onSelfProfileChanged);
}

export function unsubscribeFlux() {
    FluxDispatcher.unsubscribe("USER_PROFILE_FETCH_SUCCESS", onProfileFetchSuccess);
    FluxDispatcher.unsubscribe("USER_UPDATE", onSelfProfileChanged);
    FluxDispatcher.unsubscribe("USER_PROFILE_UPDATE_SUCCESS", onSelfProfileChanged);
    FluxDispatcher.unsubscribe("CURRENT_USER_UPDATE", onSelfProfileChanged);
}

export async function hydrateSelfFromStorage(): Promise<void> {
    // Intentionally NO-OP for the gradient store: self's rendered gradient is
    // driven by self's bio (same as other users), not local DataStore. Local
    // config is only used for the panel's editable preview + bio-tag generation.
    // Trigger a profile fetch so the bio-decoded gradient lands in the store.
    const selfId = UserStore.getCurrentUser()?.id;
    if (selfId) {
        try { fetchQueue.enqueue(selfId); } catch {}
    }
}
