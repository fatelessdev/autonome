import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { workflow } from "workflow/vite";

// Port configuration - read from env with defaults
// NOTE: We use API_PORT (not PORT) to avoid collision with Vite/Nitro's built-in PORT handling.
const API_PORT = Number(process.env.API_PORT) || 8081;
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 5173;
const API_URL = process.env.VITE_API_URL || `http://localhost:${API_PORT}`;

export default defineConfig({
  plugins: [
    devtools(),
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
    nitro(),
    workflow(),
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
  // Nitro configuration for Vercel deployment
  nitro: {
    preset: "vercel",
  },
  server: {
    port: FRONTEND_PORT,
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
