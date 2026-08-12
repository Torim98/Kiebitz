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
        // Nur Abhängigkeiten trennen, die sowohl groß als auch fachlich klar
        // abgegrenzt sind. Ein allgemeiner `vendor`-Chunk würde Abhängigkeiten
        // lazy geladener Seiten wieder in den App-Start ziehen.
        manualChunks(id) {
          const path = id.replaceAll("\\", "/");
          if (!path.includes("/node_modules/")) return;
          if (path.includes("/react-chessboard/")) return "chessboard";
          if (path.includes("/chess.js/")) return "chess-core";
          if (
            path.includes("/react/") ||
            path.includes("/react-dom/") ||
            path.includes("/scheduler/")
          ) {
            return "react";
          }
          if (path.includes("/@tauri-apps/")) return "tauri";
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
