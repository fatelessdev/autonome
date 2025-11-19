import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
// standard import name is 'react'
import react from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin'

const config = defineConfig({
  plugins: [
    devtools(),
    nitroV2Plugin(),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        concurrency: 14,
        crawlLinks: true,
        retryCount: 2,
        retryDelay: 1000,
        maxRedirects: 5,
        onSuccess: ({ page }) => {
          console.log(`Rendered ${page.path}!`)
        },
      }
    }),
    // We use the standard 'react' plugin here, but we pass options to it.
    // This single instance handles Fast Refresh, JSX, AND your Babel compiler.
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
  // Force bundling of srvx to fix "Cannot find package 'srvx'" error
  ssr: {
    noExternal: ['srvx'],
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