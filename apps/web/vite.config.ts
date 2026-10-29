import path from "node:path";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Public marketing HTML stays independent of the authenticated React application.
// Rewrite clean application URLs in dev/preview just as production servers do.
function publicPages(siteUrl: string): Plugin {
  const rewrite = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((req, _res, next) => {
      const pathname = (req.url || "/").split("?")[0];
      if ((req.method === "GET" || req.method === "HEAD") && req.headers.accept?.includes("text/html") && pathname !== "/" && pathname !== "/index.html" && !pathname.includes(".") && !pathname.startsWith("/api") && !pathname.startsWith("/@")) req.url = "/app.html";
      next();
    });
  };
  return {
    name: "mixedlane-public-pages",
    configureServer: rewrite,
    configurePreviewServer: rewrite,
    transformIndexHtml: (html) => html.replaceAll("__PUBLIC_SITE_URL__", siteUrl),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}/</loc></url></urlset>\n` });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const publicUrl = new URL(env.VITE_PUBLIC_SITE_URL || "https://mixedlane.wesolves.in");
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error("VITE_PUBLIC_SITE_URL must be an HTTP(S) origin without a path, credentials, query, or fragment");
  return {
  root: __dirname,
  plugins: [publicPages(publicUrl.origin), react(), tailwindcss()],
  build: { rollupOptions: { input: { home: path.resolve(__dirname, "index.html"), app: path.resolve(__dirname, "app.html") } } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@mixedlane/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
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
  };
});
