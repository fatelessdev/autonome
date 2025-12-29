import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
// standard import name is 'react'
import react from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

// API server URL for development proxy
const API_URL = process.env.VITE_API_URL || 'http://localhost:8080'

const config = defineConfig({
  plugins: [
    devtools(),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        // enabled: true,
        autoSubfolderIndex: true,
        concurrency: 14,
        crawlLinks: true,
        retryCount: 2,
        retryDelay: 1000,
        maxRedirects: 5,
        onSuccess: ({ page }) => {
          console.log(`Rendered ${page.path}!`)
        },
      },
      sitemap: {
        enabled: true,
        host: 'https://goon.fast',
      },
    }),
    // We use the standard 'react' plugin here, but we pass options to it.
    // This single instance handles Fast Refresh, JSX, AND your Babel compiler.
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
  // Development proxy to API server
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
        // Let TanStack route /api/chat locally (serverless) instead of proxying to Hono
        bypass(req) {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (url.pathname.startsWith('/api/chat')) {
            return req.url;
          }
        },
      },
    },
  },
  // Fixes "Some chunks are larger than 500 kB" warning
  build: {
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules\/react/,
              priority: 10,
            },
            {
              name: 'three-vendor',
              test: /node_modules\/three|@react-three/,
              priority: 10,
            },
            {
              name: 'ui-vendor',
              test: /node_modules\/(@radix-ui|framer-motion|motion|lucide-react)/,
              priority: 10,
            },
            {
              name: 'shiki-vendor',
              test: /node_modules\/shiki/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})

export default config