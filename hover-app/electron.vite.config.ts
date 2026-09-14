import { resolve } from 'path'
import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Load .env so VITE_* vars are available to all three processes
  const env = loadEnv(mode, process.cwd(), '')

  const apiBase = env['VITE_API_BASE'] ?? 'http://localhost:8000/api/v1'

  return {
    main: {
      // Expose VITE_API_BASE to main process as a compile-time constant.
      // Never put secrets here — this value ends up in the built JS bundle.
      define: {
        'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
      },
    },
    preload: {},
    renderer: {
      server: {
        allowedHosts: [],
      },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
        },
      },
      plugins: [react(), tailwindcss()],
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html'),
            overlay: resolve('src/renderer/overlay.html'),
            settings: resolve('src/renderer/settings.html'),
          },
        },
      },
    },
  }
})
