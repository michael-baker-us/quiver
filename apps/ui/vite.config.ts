import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The server package hosts the built UI; quiver ui serves this directory.
    outDir: "../../packages/server/public",
    emptyOutDir: true,
  },
  server: {
    // In dev, run `quiver ui <dir> --no-open` on 4123 and `npm -w @quiver/ui run dev`.
    proxy: { "/api": "http://127.0.0.1:4123" },
  },
});
