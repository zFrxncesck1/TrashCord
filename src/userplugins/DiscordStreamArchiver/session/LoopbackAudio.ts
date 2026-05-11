// System-audio loopback capture for Discord Desktop.
//
// Discord Desktop routes voice through a native C++ module with no JS
// MediaStream exposure, so we fall back to getDisplayMedia — it prompts the
// user once per session to select a window or screen and returns a
// MediaStream containing the captured system audio output.
//
// getDisplayMedia requires video=true on most platforms, so we ask for both
// and discard the video track immediately. The result is an audio-only
// MediaStream suitable for piping into AudioMixer.
//
// Caveats (document these to the user):
//   - On Windows 11 the picker lets you choose a specific window (e.g.
//     "Discord"); audio is then scoped to that window's output.
//   - On Windows 10 and most Linux/macOS configurations, loopback is
//     whole-system — other apps playing audio at the time (Spotify, YouTube
//     in a browser tab, game audio, etc.) will also be captured.
//   - The user's own mic is not captured this way unless they have OS-level
//     loopback on their mic, which is unusual.

import { logger } from "../utils";

export async function captureDesktopAudio(): Promise<MediaStream | null> {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
        logger.warn("getDisplayMedia not available in this runtime");
        return null;
    }
    try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                // Hints for loopback quality. Ignored by implementations that don't support them.
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            } as any
        });

        const videoTracks = displayStream.getVideoTracks();
        for (const v of videoTracks) {
            v.stop();
            displayStream.removeTrack(v);
        }

        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
            logger.warn("getDisplayMedia returned no audio tracks (user picked a source without audio loopback support)");
            return null;
        }

        const audioOnly = new MediaStream(audioTracks);
        logger.info(`loopback audio captured: ${audioTracks.length} track(s), first readyState=${audioTracks[0].readyState}`);
        return audioOnly;
    } catch (err) {
        const name = (err as any)?.name ?? "unknown";
        if (name === "NotAllowedError") {
            logger.info("loopback capture cancelled by user");
        } else {
            logger.error("loopback capture failed", err);
        }
        return null;
    }
}
