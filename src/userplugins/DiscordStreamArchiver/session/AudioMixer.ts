// Web Audio graph with one persistent MediaStreamDestination.
// Sources (per-user voice, per-stream audio, own mic) connect/disconnect
// without breaking the destination track.
//
// A MediaStreamAudioDestinationNode with zero connected sources does NOT
// reliably emit silent samples in Chromium — it emits nothing. That starves
// MediaRecorder (it waits for audio data that never arrives and never
// transitions to "recording" state). We fix this by always having a
// ConstantSourceNode with offset=0 connected to the destination: it emits
// a continuous stream of zero-valued samples so the destination is always
// "live" with real audio data flowing.
//
// Tests inject a fake AudioContext via the constructor.

export class AudioMixer {
    private sources = new Map<string, MediaStreamAudioSourceNode>();
    private destination: MediaStreamAudioDestinationNode;
    private silenceSource: AudioScheduledSourceNode | null = null;

    constructor(private readonly ctx: AudioContext) {
        this.destination = ctx.createMediaStreamDestination();

        // Prime the destination with a permanent silence source so MediaRecorder
        // always sees audio samples even when no user/stream tracks are mixed in.
        if (typeof (ctx as any).createConstantSource === "function") {
            const silence = (ctx as any).createConstantSource();
            silence.offset.value = 0;
            silence.connect(this.destination);
            silence.start();
            this.silenceSource = silence;
        }
    }

    addTrack(id: string, stream: MediaStream): void {
        const existing = this.sources.get(id);
        if (existing) {
            try { existing.disconnect(); } catch { /* ignore */ }
            this.sources.delete(id);
        }
        const source = this.ctx.createMediaStreamSource(stream);
        source.connect(this.destination);
        this.sources.set(id, source);
    }

    removeTrack(id: string): void {
        const source = this.sources.get(id);
        if (!source) return;
        try { source.disconnect(); } catch { /* ignore */ }
        this.sources.delete(id);
    }

    get destinationTrack(): MediaStreamTrack {
        return this.destination.stream.getAudioTracks()[0];
    }

    get destinationStream(): MediaStream {
        return this.destination.stream;
    }

    async resume(): Promise<void> {
        if (this.ctx.state === "suspended") await this.ctx.resume();
    }

    async close(): Promise<void> {
        for (const id of Array.from(this.sources.keys())) this.removeTrack(id);
        if (this.silenceSource) {
            try { this.silenceSource.stop(); } catch { /* ignore */ }
            try { this.silenceSource.disconnect(); } catch { /* ignore */ }
            this.silenceSource = null;
        }
        await this.ctx.close();
    }
}
