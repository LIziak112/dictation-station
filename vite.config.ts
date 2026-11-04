import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/web",
  base: "./",
  plugins: [react()],
  publicDir: resolve("public/assets"),
  build: { outDir: resolve("dist/web"), emptyOutDir: false },
  server: {
    port: 5198,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8083", "/audio": "http://127.0.0.1:8083" },
  },
});
