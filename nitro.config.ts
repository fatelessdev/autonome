import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
    compatibilityDate: "2025-07-15",
    preset: "vercel",
    vercel: {
        functions: {
            runtime: "bun1.x"
        }
    },
    minify: true,
    compressPublicAssets: true,
    prerender: {
        routes: ["/", "/leaderboard", "/failures", "/analytics", "/chat"],
    },

})
