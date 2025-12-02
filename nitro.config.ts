import { defineNitroConfig } from "nitro/config";

export default defineNitroConfig({
    compatibilityDate: "2024-05-07",
    preset: "netlify",
    minify: true,
    compressPublicAssets: true,
    prerender: {
        routes: ["/", "/leaderboard", "/failures", "/analytics", "/chat"],
    },
})
