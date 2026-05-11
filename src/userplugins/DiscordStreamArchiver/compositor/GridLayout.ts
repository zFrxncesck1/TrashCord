import type { Rect } from "../types";

export function layout(count: number, container: Rect): Rect[] {
    if (count <= 0) return [];
    if (count === 1) return [{ ...container }];

    if (count === 2) {
        const w = container.width / 2;
        return [
            { x: container.x, y: container.y, width: w, height: container.height },
            { x: container.x + w, y: container.y, width: w, height: container.height }
        ];
    }

    if (count === 3) {
        const w = container.width / 2;
        const h = container.height / 2;
        return [
            { x: container.x, y: container.y, width: w, height: h },
            { x: container.x + w, y: container.y, width: w, height: h },
            { x: container.x + w / 2, y: container.y + h, width: w, height: h }
        ];
    }

    if (count === 4) return grid(container, 2, 2);
    if (count <= 6) return grid(container, 3, 2).slice(0, count);
    if (count <= 9) return grid(container, 3, 3).slice(0, count);

    // 10+ clamped to 9 for MVP (overflow indicator deferred).
    return grid(container, 3, 3);
}

function grid(c: Rect, cols: number, rows: number): Rect[] {
    const w = c.width / cols;
    const h = c.height / rows;
    const out: Rect[] = [];
    for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
            out.push({ x: c.x + col * w, y: c.y + r * h, width: w, height: h });
        }
    }
    return out;
}
