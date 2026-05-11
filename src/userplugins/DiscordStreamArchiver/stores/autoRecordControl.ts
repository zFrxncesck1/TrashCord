// Tiny registry that lets UI surfaces (context menus) ask the plugin core
// to re-evaluate auto-record state right after a whitelist toggle.
//
// Why a registry: the trigger lives in `ui/*` files, but the implementation
// needs `currentSession`/`maybeAutoStart`/`stop` which are private to
// `index.tsx`. Exporting a function from index.tsx and importing it back
// from `ui/*` would create a circular module graph (index already imports
// the UI patches). The registry breaks the cycle: index.tsx registers its
// re-evaluation function on startup, the UI calls `triggerReevaluate()`
// after a toggle, no direct reference between the two modules.

let reevaluator: (() => void) | null = null;

export function setAutoRecordReevaluator(fn: () => void): void {
    reevaluator = fn;
}

export function triggerAutoRecordReevaluate(): void {
    reevaluator?.();
}
