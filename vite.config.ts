import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const API_URL = process.env.VITE_API_URL || "http://localhost:8081";

export default defineConfig({
  plugins: [
    devtools(),
    nitro({
      preset: "vercel",
    }),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        autoSubfolderIndex: true,
        concurrency: 14,
        crawlLinks: true,
        retryCount: 2,
        retryDelay: 1000,
        maxRedirects: 5,
      },
    }),
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_URL,
        changeOrigin: true,
        bypass(req) {
          const url = new URL(req.url ?? "/", "http://localhost");
          if (url.pathname.startsWith("/api/chat")) {
            return req.url;
          }
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "react-vendor", test: /node_modules\/react/, priority: 10 },
            { name: "three-vendor", test: /node_modules\/three|@react-three/, priority: 10 },
            { name: "ui-vendor", test: /node_modules\/(@radix-ui|framer-motion|motion|lucide-react)/, priority: 10 },
            { name: "shiki-vendor", test: /node_modules\/shiki/, priority: 10 },
          ],
        },
      },
    },
  },
});
