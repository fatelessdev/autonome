import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
    compatibilityDate: "2025-07-15",
    preset: "bun",
    minify: true,
    compressPublicAssets: true,
    prerender: {
        routes: ["/", "/leaderboard", "/failures", "/analytics", "/chat"],
    },

})
