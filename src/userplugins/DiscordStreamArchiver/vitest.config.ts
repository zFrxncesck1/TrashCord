import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
    test: {
        environment: "jsdom",
        globals: true,
        include: ["tests/**/*.test.ts"],
    },
    resolve: {
        alias: {
            "@plugin": path.resolve(__dirname, "."),
        },
    },
});
