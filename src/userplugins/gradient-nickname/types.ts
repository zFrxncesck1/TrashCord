export type AnimationType = "none" | "hue" | "slide" | "pulse" | "wave";

export type GlowAnimationType = "none" | "orbit" | "pulse" | "wave" | "flicker" | "bounce" | "spin-fast";

export type SlideDirection = "left" | "right" | "up" | "down";
export type WaveDirection = "out" | "in";

export interface ColorStop {
    color: string; // "#rrggbb"
    hueAnim?: boolean; // when true, this stop cycles through hues
}

export interface GradientConfig {
    stops: ColorStop[];
    anim: AnimationType;
    font?: string;
    slideDir?: SlideDirection;
    waveDir?: WaveDirection;
    glow?: boolean;
    glowStops?: ColorStop[];
    glowIntensity?: number; // 1-10, controls shadow blur radius
    glowAnim?: GlowAnimationType;
    mutedGuilds?: string[]; // guild ids where author wants their gradient hidden (cross-user)
}

export interface StoreEntry {
    cfg: GradientConfig | null;
    fetchedAt: number;
}
