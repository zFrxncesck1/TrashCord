// Lazy font loader. Google Fonts loaded on demand via <link>; system / Discord-native
// fonts are assumed always-available (no fetch).

export const GOOGLE_FONTS = new Set([
    "Inter", "Roboto", "Roboto Mono", "JetBrains Mono", "Source Code Pro",
    "Slabo 27px", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway",
    "Oswald", "Merriweather", "Playfair Display", "Bebas Neue",
]);

const loadedFonts = new Set<string>();
const onLoadCbs = new Set<() => void>();

export function onAnyFontLoad(cb: () => void): () => void {
    onLoadCbs.add(cb);
    return () => onLoadCbs.delete(cb);
}

function notify() {
    for (const cb of Array.from(onLoadCbs)) {
        try { cb(); } catch {}
    }
}

export function ensureFontLoaded(name: string): void {
    if (!name || loadedFonts.has(name)) return;
    loadedFonts.add(name);
    const fonts: any = (document as any).fonts;
    if (GOOGLE_FONTS.has(name)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;700&display=swap`;
        link.dataset.gnFont = name;
        link.onload = () => {
            if (!fonts?.load) { notify(); return; }
            Promise.all([
                fonts.load(`400 16px "${name}"`),
                fonts.load(`700 16px "${name}"`),
            ]).then(notify).catch(() => {});
        };
        link.onerror = () => console.warn("[GradientNickname] font load failed:", name);
        document.head.appendChild(link);
    } else if (fonts?.load) {
        fonts.load(`400 16px "${name}"`).then(notify).catch(() => {});
    }
}

export function removeAllLoadedFontLinks(): void {
    document.querySelectorAll("link[data-gn-font]").forEach(l => l.remove());
    loadedFonts.clear();
}
