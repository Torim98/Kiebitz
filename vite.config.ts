/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        // Große, selten geänderte Bibliotheken erhalten eigene Cache- und
        // Download-Chunks; Seiten und optionale Sprachen werden dynamisch geladen.
        manualChunks(id) {
          const path = id.replaceAll("\\", "/");
          if (!path.includes("/node_modules/")) return;
          if (
            path.includes("/recharts/") ||
            path.includes("/victory-vendor/") ||
            /\/d3-[^/]+\//.test(path)
          ) {
            return "charts";
          }
          if (path.includes("/react-chessboard/") || path.includes("/chess.js/")) {
            return "chess";
          }
          if (
            path.includes("/react/") ||
            path.includes("/react-dom/") ||
            path.includes("/scheduler/")
          ) {
            return "react";
          }
          if (path.includes("/@tauri-apps/")) return "tauri";
          return "vendor";
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
