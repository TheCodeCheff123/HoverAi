import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
  },

  build: {
    // Target modern browsers — smaller, faster output
    target: 'es2020',

    // Raise the inline limit so small images become data URIs (fewer round-trips)
    assetsInlineLimit: 4096,

    // Vite 8 uses Oxc for minification (esbuild is no longer bundled)
    minify: 'oxc',

    // Split large vendor chunks so the browser can cache them independently
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires manualChunks as a function
        manualChunks: (id: string) => {
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) return 'vendor-react'
        },
        // Content-hashed filenames for long-lived caching
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',
      },
    },

    // Generate source maps for production debugging (optional — remove if bundle size is priority)
    sourcemap: false,

    // Report chunks > 500 kB
    chunkSizeWarningLimit: 500,
  },
})
