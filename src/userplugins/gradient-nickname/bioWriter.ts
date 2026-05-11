import { RestAPI, UserProfileStore, UserStore } from "@webpack/common";
import { BIO_STRIP_RE, encode } from "./encoding";
import type { GradientConfig } from "./types";

const BIO_LIMIT = 190;
const DEBOUNCE_MS = 5_000;

let debounceHandle: ReturnType<typeof setTimeout> | null = null;
let pendingCfg: GradientConfig | null = null;

export function scheduleSync(cfg: GradientConfig): void {
    pendingCfg = cfg;
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
        debounceHandle = null;
        const c = pendingCfg;
        pendingCfg = null;
        if (c) syncSelf(c).catch(err => console.error("[GradientNickname] bio sync failed", err));
    }, DEBOUNCE_MS);
}

async function syncSelf(cfg: GradientConfig, attempt = 1): Promise<void> {
    const selfId = UserStore.getCurrentUser()?.id;
    if (!selfId) return;
    let currentBio = "";
    try {
        const profile = UserProfileStore?.getUserProfile?.(selfId);
        currentBio = profile?.bio ?? "";
    } catch (err) {
        console.warn("[GradientNickname] could not read current bio; using empty", err);
    }

    const stripped = currentBio.replace(BIO_STRIP_RE, " ").trim();
    const tag = encode(cfg);
    const newBio = stripped.length > 0 ? `${stripped} ${tag}` : tag;

    if (newBio.length > BIO_LIMIT) {
        showToast("GradientNickname: bio too full to add tag. Trim bio first.");
        return;
    }

    try {
        if (!RestAPI?.patch) {
            console.warn("[GradientNickname] RestAPI not ready yet, skipping sync");
            return;
        }
        await RestAPI.patch({
            url: "/users/@me/profile",
            body: { bio: newBio },
        });
    } catch (err: any) {
        const status = err?.status;
        if ((status === 429 || (status >= 500 && status < 600)) && attempt < 3) {
            const retryAfter = (err?.body?.retry_after ?? 1) * 1000;
            await new Promise(r => setTimeout(r, retryAfter));
            return syncSelf(cfg, attempt + 1);
        }
        if (attempt >= 3) {
            showToast("GradientNickname: couldn't sync bio. Will retry on next change.");
        }
        throw err;
    }
}

function showToast(msg: string): void {
    try {
        // Vencord Toast API; lazy-import to avoid eager webpack lookup.
        const { Toasts } = require("@webpack/common");
        Toasts.show({
            message: msg,
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
            options: { duration: 4000, position: Toasts.Position.BOTTOM },
        });
    } catch {
        console.warn("[GradientNickname]", msg);
    }
}
