import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { config } from "./config";

/** Hashes of the inline <script> blocks in index.html (the pre-paint theme snippet), for the CSP. */
function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
}

/**
 * Security headers. When the web app is served from here it gets a strict Content-Security-Policy:
 * scripts only from this origin (plus the hashed inline theme snippet), no plugins, no framing.
 */
export function securityHeaders(app: INestApplication, indexHtml?: string) {
  const csp = indexHtml
    ? {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...inlineScriptHashes(indexHtml)],
          // React style props and the editor set inline styles.
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      }
    : false;
  app.use(
    helmet({
      contentSecurityPolicy: csp,
      crossOriginResourcePolicy: { policy: "same-site" },
      // Uploaded media is served with cookies from the same site; no cross-origin isolation needed.
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config().APP_URL.startsWith("https://") ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );
}

/** The built SPA directory to serve, if configured and present. */
export function webDist(): string | null {
  const dir = config().WEB_DIST;
  if (!dir) return null;
  const abs = resolve(dir);
  return existsSync(join(abs, "index.html")) ? abs : null;
}

/**
 * Serves the SPA: hashed assets are cached forever, everything else that isn't /api falls back to
 * index.html (never cached, so deploys take effect immediately).
 */
export function serveWeb(app: INestApplication, dir: string) {
  const express = app as NestExpressApplication;
  express.useStaticAssets(dir, {
    index: false,
    setHeaders: (res, path) => {
      res.setHeader("cache-control", path.includes(`${join("assets", "")}`) ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    },
  });
  const index = readFileSync(join(dir, "index.html"), "utf8");
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/") || req.path === "/api" || req.path.startsWith("/.well-known/")) return next();
    res.setHeader("cache-control", "no-cache");
    res.type("html").send(index);
  });
  return index;
}
