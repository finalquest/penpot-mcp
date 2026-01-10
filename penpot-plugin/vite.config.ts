import { defineConfig } from "vite";
import livePreview from "vite-live-preview";

export default defineConfig({
    plugins: [
        livePreview({
            reload: true,
            config: {
                build: {
                    sourcemap: true,
                },
            },
        }),
    ],
    build: {
        rollupOptions: {
            input: {
                plugin: "src/plugin.ts",
                index: "./index.html",
            },
            output: {
                entryFileNames: "[name].js",
            },
        },
    },
    preview: {
        port: 4400,
        cors: true,
        allowedHosts: process.env.VITE_ALLOWED_HOSTS
            ? process.env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim())
            : ["localhost", "0.0.0.0"],
    },
});
