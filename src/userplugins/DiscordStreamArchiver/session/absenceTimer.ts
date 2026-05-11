import type { SessionTrigger } from "../stores/sessionStore";

export interface AbsenceInput {
    trigger: SessionTrigger;
    sessionChannelId: string;
    channelWhitelistContains: (channelId: string) => boolean;
    anyWhitelistedUserInChannel: (channelId: string) => boolean;
    absenceTimeoutSeconds: number;
}

// Pure predicate: should the absence timer be armed for this session right now?
// Channel-whitelist sessions never arm (they run until the user leaves the
// channel). User-whitelist sessions arm only when no whitelisted user is
// currently in the channel and the timeout is non-zero.
export function shouldArmAbsenceTimer(input: AbsenceInput): boolean {
    if (input.trigger !== "user") return false;
    if (input.channelWhitelistContains(input.sessionChannelId)) return false;
    if (input.absenceTimeoutSeconds <= 0) return false;
    if (input.anyWhitelistedUserInChannel(input.sessionChannelId)) return false;
    return true;
}
