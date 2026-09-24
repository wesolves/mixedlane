import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@flowboard/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    // WEB_HOST=0.0.0.0 (or `--host`) exposes the dev server on your network; see `npm run dev:lan`.
    host: process.env.WEB_HOST || "localhost",
    port: Number(process.env.WEB_PORT) || 5173,
    // Fail instead of silently moving to another port (links, MCP configs and cookies rely on it).
    strictPort: true,
    // ws: the realtime socket (/api/socket) is proxied too.
    // /.well-known: OAuth discovery for MCP clients that sign in through the browser.
    proxy: {
      "/api": { target: `http://localhost:${process.env.API_PORT || 3001}`, ws: true },
      "/.well-known": { target: `http://localhost:${process.env.API_PORT || 3001}` },
    },
  },
});
