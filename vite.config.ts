import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

// Port configuration - read from env with defaults
const API_PORT = Number(process.env.PORT) || 8081;
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 5173;
const API_URL = process.env.VITE_API_URL || `http://localhost:${API_PORT}`;

// Prevent Vite from picking up the backend PORT env var (8081) which overrides `server.port`
if (process.env.PORT && normalizePort(process.env.PORT) === API_PORT) {
  delete process.env.PORT;
}

function normalizePort(val: string | number) {
  const port = parseInt(String(val), 10);
  return isNaN(port) ? val : port;
}

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
