import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
// @ts-expect-error type error without @types/node package
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env so VITE_* vars are accessible in renderer at build time
  const env = loadEnv(mode, process.cwd(), "");
  const apiBase = env["VITE_API_BASE"] ?? "http://localhost:8000/api/v1";

  return {
    plugins: [react(), tailwindcss()],

    // Expose VITE_API_BASE as a compile-time constant in the renderer
    define: {
      "import.meta.env.VITE_API_BASE": JSON.stringify(apiBase),
    },

    resolve: {
      alias: {
        "@renderer": resolve("src"),
      },
    },

    // Vite options tailored for Tauri development
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },

    // Multi-page: main onboarding + overlay + settings
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
          overlay: resolve(__dirname, "overlay.html"),
          settings: resolve(__dirname, "settings.html"),
        },
      },
    },
  };
});
