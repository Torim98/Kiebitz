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
        // Rolldown schneidet die Seiten selbst zu; ausgelagert wird nur, was
        // über Veröffentlichungen hinweg gleich bleibt. React ändert sich
        // seltener als Kiebitz, und ein eigener Chunk bleibt dem Browser
        // deshalb über ein Update hinweg im Zwischenspeicher.
        //
        // Bewusst keine Gruppen für react-chessboard oder chess.js: Beide
        // hängen ausschließlich an nachgeladenen Seiten. Eine eigene Gruppe
        // machte aus ihnen einen Chunk, den das Startbündel statisch einbindet
        // · genau das, was die Aufteilung verhindern soll.
        advancedChunks: {
          groups: [
            {
              name: "react",
              test: (id: string) => {
                const path = id.replaceAll("\\", "/");
                return (
                  path.includes("/node_modules/react/") ||
                  path.includes("/node_modules/react-dom/") ||
                  path.includes("/node_modules/scheduler/")
                );
              },
            },
          ],
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
