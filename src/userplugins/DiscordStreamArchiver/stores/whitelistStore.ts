// Pure helpers: parse / serialize / mutate comma-separated ID lists.
// No Vencord imports here — testable under vitest.

export function parseCsvIds(raw: string): string[] {
    if (!raw.trim()) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const part of raw.split(",")) {
        const id = part.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

export function serializeCsvIds(ids: string[]): string {
    return ids.join(",");
}

export function listContains(csv: string, id: string): boolean {
    return parseCsvIds(csv).includes(id);
}

export function listAdd(csv: string, id: string): string {
    const ids = parseCsvIds(csv);
    if (ids.includes(id)) return serializeCsvIds(ids);
    ids.push(id);
    return serializeCsvIds(ids);
}

export function listRemove(csv: string, id: string): string {
    const ids = parseCsvIds(csv).filter(x => x !== id);
    return serializeCsvIds(ids);
}
